import assert from "node:assert/strict";
import test from "node:test";

import { SqliteApprovalStore } from "../src/workflow/sqlite-approval-store.js";
import { STATUS } from "../src/workflow/status.js";

test("SqliteApprovalStore persists approval records and execution logs", () => {
  const store = new SqliteApprovalStore(":memory:");
  store.create({
    id: "req-1",
    eventId: "evt-1",
    messageId: "om-source",
    chatId: "oc-chat",
    senderId: "ou-user",
    text: "question",
    status: STATUS.RECEIVED
  });
  store.update("req-1", {
    status: STATUS.PENDING_APPROVAL,
    draftText: "draft"
  });
  store.log("req-1", "card_sent", { messageId: "om-card" });

  assert.equal(store.get("req-1").status, STATUS.PENDING_APPROVAL);
  assert.equal(store.get("req-1").draftText, "draft");
  assert.deepEqual(store.logs("req-1").at(-1), {
    requestId: "req-1",
    event: "card_sent",
    data: { messageId: "om-card" }
  });
  assert.deepEqual(store.logs("req-1").map((entry) => entry.event), [
    "created",
    "updated",
    "card_sent"
  ]);
  assert.deepEqual(
    store.recentLogs(2).map((entry) => entry.event),
    ["card_sent", "updated"]
  );
  assert.equal(store.recentRequests(1)[0].id, "req-1");
});

test("SqliteApprovalStore persists personal watch watermarks", () => {
  const store = new SqliteApprovalStore(":memory:");

  store.setWatermark("ou-target", {
    messageId: "om-1",
    createdAt: "1779811200000"
  });

  assert.deepEqual(store.getWatermark("ou-target"), {
    messageId: "om-1",
    createdAt: "1779811200000"
  });
});
