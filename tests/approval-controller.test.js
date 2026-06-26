import assert from "node:assert/strict";
import test from "node:test";

import { createApprovalController } from "../src/approval/approval-controller.js";
import { MemoryApprovalStore } from "../src/workflow/memory-approval-store.js";
import { STATUS } from "../src/workflow/status.js";

test("ApprovalController sends a pending draft with idempotency", async () => {
  const replies = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    draftText: "可以，我下午看。",
    senderId: "ou-target"
  });
  const controller = createApprovalController({
    store,
    imClient: {
      async replyText(reply) {
        replies.push(reply);
        return { message_id: "om-reply" };
      }
    },
    bridge: {},
    config: { replyAs: "user" }
  });

  const updated = await controller.send("req-1", "desktop-pet");

  assert.equal(updated.status, STATUS.SENT);
  assert.equal(updated.sentMessageId, "om-reply");
  assert.deepEqual(replies, [
    {
      as: "user",
      messageId: "om-source",
      text: "可以，我下午看。",
      idempotencyKey: "reply-req-1"
    }
  ]);
});

test("ApprovalController rewrites non-command instructions and keeps request pending", async () => {
  const handled = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    eventId: "evt-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    senderId: "ou-target",
    selfUserId: "ou-me",
    chatId: "ou-target",
    text: "这个方案我下午能看一下吗？",
    draftText: "可以，我下午看。",
    contextMessages: [{ messageId: "om-context", text: "前文", messageType: "text" }],
    contextMaxChars: 800,
    contextSummary: "对方想确认你是否能看方案。"
  });
  const controller = createApprovalController({
    store,
    imClient: {},
    bridge: {
      async handleLarkMessage(message) {
        handled.push(message);
        return { text: `改后：${message.rewriteInstruction}`, channel: "codex" };
      }
    },
    config: {}
  });

  const result = await controller.handleInstruction({
    requestId: "req-1",
    instruction: "语气软一点",
    actor: "desktop-pet"
  });

  assert.equal(result.action, "rewrite");
  assert.equal(result.request.status, STATUS.PENDING_APPROVAL);
  assert.equal(result.request.uiState, "pending");
  assert.equal(result.request.draftText, "改后：语气软一点");
  assert.equal(handled[0].previousDraftText, "可以，我下午看。");
  assert.equal(handled[0].rewriteInstruction, "语气软一点");
  assert.deepEqual(handled[0].contextMessages, [{ messageId: "om-context", text: "前文", messageType: "text" }]);
  assert.equal(handled[0].contextMaxChars, 800);
  assert.equal(handled[0].selfUserId, "ou-me");
});

test("ApprovalController refuses to send superseded requests", async () => {
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-old",
    status: STATUS.SUPERSEDED,
    messageId: "om-source",
    draftText: "旧建议"
  });
  const controller = createApprovalController({
    store,
    imClient: {
      async replyText() {
        throw new Error("should not send superseded requests");
      }
    },
    bridge: {},
    config: {}
  });

  const result = await controller.send("req-old", "desktop-pet");

  assert.equal(result.status, STATUS.SUPERSEDED);
});

test("ApprovalController marks request SEND_FAILED when reply fails", async () => {
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    draftText: "建议"
  });
  const controller = createApprovalController({
    store,
    imClient: {
      async replyText() {
        throw new Error("token expired");
      }
    },
    bridge: {},
    config: {}
  });

  await assert.rejects(() => controller.send("req-1", "desktop-pet"), /token expired/);
  assert.equal(store.get("req-1").status, STATUS.SEND_FAILED);
  assert.equal(store.get("req-1").errorMessage, "token expired");
});

test("ApprovalController treats send phrases as rewrite when direct send by instruction is disabled", async () => {
  const replies = [];
  const handled = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    eventId: "evt-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    senderId: "ou-target",
    chatId: "ou-target",
    text: "这个方案我下午能看一下吗？",
    draftText: "可以，我下午看。"
  });
  const controller = createApprovalController({
    store,
    imClient: {
      async replyText(reply) {
        replies.push(reply);
        return { message_id: "om-reply" };
      }
    },
    bridge: {
      async handleLarkMessage(message) {
        handled.push(message);
        return { text: `改后：${message.rewriteInstruction}`, channel: "codex" };
      }
    },
    config: {
      approval: {
        allowDirectSendByInstruction: false
      }
    }
  });

  const result = await controller.handleInstruction({
    requestId: "req-1",
    instruction: "发吧",
    actor: "desktop-pet"
  });

  assert.equal(result.action, "rewrite");
  assert.equal(result.request.status, STATUS.PENDING_APPROVAL);
  assert.equal(result.request.draftText, "改后：发吧");
  assert.equal(handled[0].rewriteInstruction, "发吧");
  assert.deepEqual(replies, []);
});

test("ApprovalController sends on send phrases when direct send by instruction is enabled", async () => {
  const replies = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    draftText: "可以，我下午看。"
  });
  const controller = createApprovalController({
    store,
    imClient: {
      async replyText(reply) {
        replies.push(reply);
        return { message_id: "om-reply" };
      }
    },
    bridge: {},
    config: {
      approval: {
        allowDirectSendByInstruction: true
      }
    }
  });

  const result = await controller.handleInstruction({
    requestId: "req-1",
    instruction: "发吧",
    actor: "desktop-pet"
  });

  assert.equal(result.action, "send");
  assert.equal(result.request.status, STATUS.SENT);
  assert.deepEqual(replies, [
    {
      as: "user",
      messageId: "om-source",
      text: "可以，我下午看。",
      idempotencyKey: "reply-req-1"
    }
  ]);
});

test("ApprovalController rejects empty instructions for missing requests", async () => {
  const store = new MemoryApprovalStore();
  const controller = createApprovalController({
    store,
    imClient: {},
    bridge: {},
    config: {}
  });

  await assert.rejects(
    () =>
      controller.handleInstruction({
        requestId: "req-missing",
        instruction: "",
        actor: "desktop-pet"
      }),
    /approval request not found: req-missing/
  );
});
