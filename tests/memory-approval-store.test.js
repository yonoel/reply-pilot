import assert from "node:assert/strict";
import test from "node:test";

import { MemoryApprovalStore } from "../src/workflow/memory-approval-store.js";
import { STATUS } from "../src/workflow/status.js";

test("MemoryApprovalStore lists pending approval requests newest first", () => {
  const store = new MemoryApprovalStore();
  store.create({ id: "req-old", status: STATUS.PENDING_APPROVAL, messageId: "om-1" });
  store.create({ id: "req-sent", status: STATUS.SENT, messageId: "om-2" });
  store.create({ id: "req-new", status: STATUS.PENDING_APPROVAL, messageId: "om-3" });

  assert.deepEqual(
    store.pendingRequests().map((record) => record.id),
    ["req-new", "req-old"]
  );
});

test("MemoryApprovalStore lists received drafting requests with pending approvals", () => {
  const store = new MemoryApprovalStore();
  store.create({ id: "req-pending", status: STATUS.PENDING_APPROVAL, messageId: "om-1" });
  store.create({ id: "req-drafting", status: STATUS.RECEIVED, uiState: "thinking", messageId: "om-2" });
  store.create({ id: "req-received-hidden", status: STATUS.RECEIVED, messageId: "om-3" });
  store.create({ id: "req-sent", status: STATUS.SENT, messageId: "om-4" });

  assert.deepEqual(
    store.pendingRequests().map((record) => record.id),
    ["req-drafting", "req-pending"]
  );
});
