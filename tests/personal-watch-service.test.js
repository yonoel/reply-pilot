import assert from "node:assert/strict";
import test from "node:test";

import { MemoryApprovalStore } from "../src/workflow/memory-approval-store.js";
import { STATUS } from "../src/workflow/status.js";
import { PersonalWatchService } from "../src/personal-watch/personal-watch-service.js";

test("PersonalWatchService polls configured contacts and notifies self with reply suggestion", async () => {
  const notifications = [];
  const handled = [];
  const summaries = [];
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages(request) {
        handled.push(request);
        return [
          {
            messageId: "om-target-1",
            createdAt: "1779811200000",
            senderId: "ou-target",
            messageType: "text",
            text: "这个方案明天能看一下吗"
          }
        ];
      },
      async sendMarkdown(message) {
        notifications.push(message);
        return { message_id: "om-notify" };
      }
    },
    bridge: {
      async handleLarkContextSummary(message) {
        summaries.push(message);
        return { text: "对方在问明天能不能看方案，需要确认你是否会跟进。", channel: "codex" };
      },
      async handleLarkMessage(message) {
        return { text: `建议：${message.text}`, channel: "codex" };
      }
    },
    contactClient: {
      async getDisplayName(openId) {
        assert.equal(openId, "ou-target");
        return "张三";
      }
    },
    config: {
      targetUserIds: ["ou-target"],
      selfUserId: "ou-me",
      pollIntervalSeconds: 30,
      lookbackMinutes: 10,
      quietWindowSeconds: 0,
      notifyAs: "bot",
      replyAs: "user"
    },
    now: () => new Date("2026-05-27T10:10:00+08:00")
  });

  const result = await service.pollOnce();

  assert.equal(result.processed, 1);
  assert.deepEqual(handled.slice(0, 1), [
    {
      targetUserId: "ou-target",
      start: "2026-05-27T10:00:00+08:00",
      end: "2026-05-27T10:10:00+08:00"
    }
  ]);
  assert.equal(notifications.length, 1);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].text, "这个方案明天能看一下吗");
  assert.deepEqual(
    summaries[0].contextMessages.map((message) => [message.messageId, message.text]),
    [["om-target-1", "这个方案明天能看一下吗"]]
  );
  assert.equal(notifications[0].as, "bot");
  assert.equal(notifications[0].userId, "ou-me");
  assert.match(notifications[0].markdown, /New message from 张三/);
  assert.match(notifications[0].markdown, /```[\s\S]*这个方案明天能看一下吗[\s\S]*```/);
  assert.match(notifications[0].markdown, /\*\*Context summary\*\*/);
  assert.match(notifications[0].markdown, /对方在问明天能不能看方案，需要确认你是否会跟进。/);
  assert.match(notifications[0].markdown, /\*\*Suggested reply\*\*/);
  assert.match(notifications[0].markdown, /send req-/);
  assert.match(notifications[0].markdown, /rewrite req-/);
  assert.match(notifications[0].markdown, /ignore req-/);
  assert.equal(store.getWatermark("ou-target").messageId, "om-target-1");
});

test("PersonalWatchService notifies desktop approval surface without sending bot markdown", async () => {
  const surfaceEvents = [];
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return [
          {
            messageId: "om-1",
            createdAt: "1779811200000",
            senderId: "ou-target",
            messageType: "text",
            text: "这个方案我下午能看一下吗？"
          }
        ];
      },
      async sendMarkdown() {
        throw new Error("desktop surface should not send bot markdown");
      }
    },
    bridge: {
      async handleLarkMessage() {
        return { text: "可以，我下午先看一版。", channel: "codex" };
      }
    },
    approvalSurface: {
      async notifyPending(request) {
        surfaceEvents.push(request);
        return { surface: "desktop-pet" };
      }
    },
    config: {
      targetUserIds: ["ou-target"],
      selfUserId: "ou-me",
      lookbackMinutes: 10,
      quietWindowSeconds: 0
    },
    now: () => new Date("2026-05-27T10:10:00+08:00")
  });

  await service.pollOnce();

  assert.equal(surfaceEvents.length, 1);
  assert.equal(surfaceEvents[0].draftText, "可以，我下午先看一版。");
  assert.equal(surfaceEvents[0].senderName, "ou-target");
  assert.equal(store.get(surfaceEvents[0].id).uiState, "pending");
  assert.equal(store.get(surfaceEvents[0].id).approvalSurface, "desktop-pet");
});

test("PersonalWatchService processes file messages with readable text", async () => {
  const surfaceEvents = [];
  const handled = [];
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return [
          {
            messageId: "om-file",
            createdAt: "2026-06-25 16:25",
            messagePosition: "4198",
            senderId: "ou-target",
            senderName: "温浩",
            messageType: "file",
            text: "[文件] demo.zip"
          }
        ];
      }
    },
    bridge: {
      async handleLarkMessage(message) {
        handled.push(message);
        return { text: "收到，我看下。", channel: "codex" };
      }
    },
    approvalSurface: {
      async notifyPending(request) {
        surfaceEvents.push(request);
        return { surface: "desktop-pet" };
      }
    },
    config: {
      targetListeners: [{ chatId: "oc-chat" }],
      selfUserId: "ou-me",
      lookbackMinutes: 10,
      quietWindowSeconds: 0
    },
    now: () => new Date("2026-06-25T16:30:00+08:00")
  });

  const result = await service.pollOnce();

  assert.equal(result.processed, 1);
  assert.equal(handled[0].text, "[文件] demo.zip");
  assert.equal(surfaceEvents[0].senderName, "温浩");
  assert.equal(surfaceEvents[0].text, "[文件] demo.zip");
  assert.equal(surfaceEvents[0].draftText, "收到，我看下。");
});

test("PersonalWatchService processes image messages with readable text", async () => {
  const surfaceEvents = [];
  const handled = [];
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return [
          {
            messageId: "om-image",
            createdAt: "2026-06-26 11:10",
            messagePosition: "7271",
            senderId: "ou-target",
            senderName: "陈钢",
            messageType: "image",
            text: "[图片]"
          }
        ];
      }
    },
    bridge: {
      async handleLarkMessage(message) {
        handled.push(message);
        return { text: "收到，我看下。", channel: "codex" };
      }
    },
    approvalSurface: {
      async notifyPending(request) {
        surfaceEvents.push(request);
        return { surface: "desktop-pet" };
      }
    },
    config: {
      targetListeners: [{ chatId: "oc-chat" }],
      selfUserId: "ou-me",
      lookbackMinutes: 10,
      quietWindowSeconds: 0
    },
    now: () => new Date("2026-06-26T11:15:00+08:00")
  });

  const result = await service.pollOnce();

  assert.equal(result.processed, 1);
  assert.equal(handled[0].text, "[图片]");
  assert.equal(surfaceEvents[0].senderName, "陈钢");
  assert.equal(surfaceEvents[0].text, "[图片]");
  assert.equal(surfaceEvents[0].draftText, "收到，我看下。");
});

test("PersonalWatchService keeps prior text when a batch ends with an image", async () => {
  const surfaceEvents = [];
  const handled = [];
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return [];
      }
    },
    bridge: {
      async handleLarkMessage(message) {
        handled.push(message);
        return { text: `建议：${message.text}`, channel: "codex" };
      }
    },
    approvalSurface: {
      async notifyPending(request) {
        surfaceEvents.push(request);
        return { surface: "desktop-pet" };
      }
    },
    config: {
      targetListeners: [{ chatId: "oc-chat" }],
      selfUserId: "ou-me",
      quietWindowSeconds: 0
    }
  });

  await service.queueMessage({
    listener: { chatId: "oc-chat" },
    message: {
      messageId: "om-text",
      createdAt: "2026-06-26 11:10",
      messagePosition: "7269",
      senderId: "ou-target",
      senderName: "陈钢",
      messageType: "text",
      text: "没"
    }
  });
  await service.queueMessage({
    listener: { chatId: "oc-chat" },
    message: {
      messageId: "om-image",
      createdAt: "2026-06-26 11:10",
      messagePosition: "7271",
      senderId: "ou-target",
      senderName: "陈钢",
      messageType: "image",
      text: "[图片]"
    }
  });
  await service.flushDueBatches();

  assert.equal(handled[0].text, "没\n[图片]");
  assert.equal(surfaceEvents[0].text, "没\n[图片]");
  assert.equal(surfaceEvents[0].messageId, "om-image");
  assert.equal(surfaceEvents[0].draftText, "建议：没\n[图片]");
});

test("PersonalWatchService falls back to lark bot surface when desktop surface fails", async () => {
  const fallbackEvents = [];
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return [
          {
            messageId: "om-1",
            createdAt: "1779811200000",
            senderId: "ou-target",
            messageType: "text",
            text: "这个方案我下午能看一下吗？"
          }
        ];
      }
    },
    bridge: {
      async handleLarkMessage() {
        return { text: "可以，我下午先看一版。", channel: "codex" };
      }
    },
    approvalSurface: {
      async notifyPending() {
        throw new Error("desktop unavailable");
      }
    },
    fallbackApprovalSurface: {
      async notifyPending(request) {
        fallbackEvents.push(request);
        return { surface: "lark-bot", messageId: "om-notify" };
      }
    },
    config: {
      targetUserIds: ["ou-target"],
      selfUserId: "ou-me",
      lookbackMinutes: 10,
      quietWindowSeconds: 0
    },
    now: () => new Date("2026-05-27T10:10:00+08:00")
  });

  await service.pollOnce();

  assert.equal(fallbackEvents.length, 1);
  assert.equal(store.get(fallbackEvents[0].id).approvalSurface, "lark-bot");
  assert.equal(store.get(fallbackEvents[0].id).approvalMessageId, "om-notify");
  const failure = store.entries.find((log) => log.event === "approval_surface_failed");
  assert.equal(failure.data.message, "desktop unavailable");
});

test("PersonalWatchService skips bot notification when fallback lark bot is disabled", async () => {
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return [
          {
            messageId: "om-1",
            createdAt: "1779811200000",
            senderId: "ou-target",
            messageType: "text",
            text: "这个方案我下午能看一下吗？"
          }
        ];
      },
      async sendMarkdown() {
        throw new Error("fallback lark bot is disabled");
      },
      async sendText() {
        throw new Error("fallback lark bot is disabled");
      }
    },
    bridge: {
      async handleLarkMessage() {
        return { text: "可以，我下午先看一版。", channel: "codex" };
      }
    },
    config: {
      targetUserIds: ["ou-target"],
      selfUserId: "ou-me",
      lookbackMinutes: 10,
      quietWindowSeconds: 0,
      fallbackLarkBot: false
    },
    now: () => new Date("2026-05-27T10:10:00+08:00")
  });

  await service.pollOnce();

  assert.equal(store.pendingRequests().length, 0);
  const [request] = [...store.records.values()];
  assert.equal(request.status, STATUS.IGNORED);
  assert.equal(request.approvalMessageId, undefined);
  const ignored = store.entries.find((log) => log.event === "personal_watch_notification_skipped");
  assert.equal(ignored.data.reason, "approval_surface_disabled");
});

test("PersonalWatchService supersedes pending requests restored from store after restart", async () => {
  const expired = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-old",
    status: STATUS.PENDING_APPROVAL,
    chatId: "ou-target",
    messageId: "om-old",
    draftText: "旧建议"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {},
    bridge: {},
    approvalSurface: {
      async notifyExpired(requestId, request) {
        expired.push({ requestId, request });
      }
    },
    config: {
      targetUserIds: ["ou-target"]
    }
  });

  await service.queueMessage({
    listener: { openId: "ou-target" },
    message: {
      messageId: "om-new",
      createdAt: "1779811200000",
      senderId: "ou-target",
      messageType: "text",
      text: "新消息"
    }
  });

  assert.equal(store.get("req-old").status, STATUS.SUPERSEDED);
  assert.equal(expired[0].requestId, "req-old");
});

test("PersonalWatchService uses the same chat key when listener has chatId and openId", async () => {
  const expired = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-old",
    status: STATUS.PENDING_APPROVAL,
    chatId: "ou-target",
    messageId: "om-old",
    draftText: "旧建议"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {},
    bridge: {},
    approvalSurface: {
      async notifyExpired(requestId, request) {
        expired.push({ requestId, request });
      }
    },
    config: {
      targetListeners: [{ chatId: "oc-chat", openId: "ou-target" }]
    }
  });

  await service.queueMessage({
    listener: { chatId: "oc-chat", openId: "ou-target" },
    message: {
      messageId: "om-new",
      createdAt: "1779811200000",
      senderId: "ou-target",
      messageType: "text",
      text: "新消息"
    }
  });

  assert.equal(store.get("req-old").status, STATUS.SUPERSEDED);
  assert.equal(expired[0].requestId, "req-old");
});

test("PersonalWatchService keeps processing when superseded notification fails", async () => {
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-old",
    status: STATUS.PENDING_APPROVAL,
    chatId: "oc-chat",
    messageId: "om-old",
    draftText: "旧建议"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {},
    bridge: {},
    approvalSurface: {
      async notifyExpired() {
        throw new Error("desktop unavailable");
      }
    },
    config: {
      targetListeners: [{ chatId: "oc-chat" }],
      fallbackLarkBot: false
    }
  });
  service.pendingRequestByChat.set("oc-chat", "req-old");

  await service.queueMessage({
    listener: { chatId: "oc-chat" },
    message: {
      messageId: "om-new",
      createdAt: "1779811200000",
      senderId: "ou-target",
      messageType: "text",
      text: "新消息"
    }
  });

  assert.equal(store.get("req-old").status, STATUS.SUPERSEDED);
  assert.equal(service.pendingRequestByChat.has("oc-chat"), false);
  assert.equal(service.batches.get("oc-chat").latestMessage.messageId, "om-new");
  assert.equal(store.entries.some((log) => log.event === "superseded_notification_failed"), true);
});

test("PersonalWatchService does not mark a superseded draft as failed when expiration notification fails", async () => {
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return [];
      }
    },
    bridge: {
      async handleLarkMessage() {
        return { text: "旧建议", channel: "codex" };
      }
    },
    approvalSurface: {
      async notifyExpired() {
        throw new Error("desktop unavailable");
      }
    },
    config: {
      targetListeners: [{ chatId: "oc-chat" }],
      fallbackLarkBot: false
    }
  });
  service.batches.set("oc-chat", {
    listener: { chatId: "oc-chat" },
    messages: [],
    latestMessage: {
      messageId: "om-newer",
      createdAt: "1779811201000",
      senderId: "ou-target",
      messageType: "text",
      text: "新消息"
    },
    updatedAtMs: 0,
    dirty: true
  });

  await service.processBatch({
    chatKey: "oc-chat",
    batch: {
      listener: { chatId: "oc-chat" },
      messages: [],
      latestMessage: {
        messageId: "om-old",
        createdAt: "1779811200000",
        senderId: "ou-target",
        messageType: "text",
        text: "旧消息"
      },
      updatedAtMs: 0,
      dirty: false
    }
  });

  const request = [...store.records.values()].find((record) => record.messageId === "om-old");
  assert.equal(request.status, STATUS.SUPERSEDED);
  assert.equal(request.errorMessage, undefined);
  assert.equal(store.entries.some((log) => log.event === "superseded_notification_failed"), true);
});
test("PersonalWatchService notifies approval surface when pending request is superseded by a new message", async () => {
  const expired = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-old",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-old",
    draftText: "旧建议"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {},
    bridge: {},
    approvalSurface: {
      async notifyExpired(requestId, request) {
        expired.push({ requestId, request });
      }
    },
    config: {
      targetListeners: [{ chatId: "oc-chat" }]
    }
  });
  service.pendingRequestByChat.set("oc-chat", "req-old");

  await service.queueMessage({
    listener: { chatId: "oc-chat" },
    message: {
      messageId: "om-new",
      createdAt: "1779811200000",
      senderId: "ou-target",
      messageType: "text",
      text: "新消息"
    }
  });

  assert.equal(store.get("req-old").status, STATUS.SUPERSEDED);
  assert.deepEqual(expired, [
    {
      requestId: "req-old",
      request: {
        id: "req-old",
        status: STATUS.SUPERSEDED,
        messageId: "om-old",
        draftText: "旧建议",
        supersededByMessageId: "om-new"
      }
    }
  ]);
});

test("PersonalWatchService polls configured chat ids and skips owner messages", async () => {
  const handled = [];
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages(request) {
        handled.push(request);
        return [
          {
            messageId: "om-self",
            createdAt: "1779811190000",
            senderId: "ou-me",
            messageType: "text",
            text: "我自己说的"
          },
          {
            messageId: "om-target-1",
            createdAt: "1779811200000",
            senderId: "ou-target",
            messageType: "text",
            text: "这个方案明天能看一下吗"
          }
        ];
      },
      async sendText() {
        return { message_id: "om-notify" };
      }
    },
    bridge: {
      async handleLarkMessage(message) {
        return { text: `建议：${message.text}`, channel: "hermes" };
      }
    },
    config: {
      targetListeners: [{ chatId: "oc-chat" }],
      selfUserId: "ou-me",
      lookbackMinutes: 10,
      quietWindowSeconds: 0
    },
    now: () => new Date("2026-05-27T10:10:00+08:00")
  });

  const result = await service.pollOnce();

  assert.equal(result.processed, 1);
  assert.equal(handled[0].chatId, "oc-chat");
  assert.equal(store.getWatermark("oc-chat").messageId, "om-target-1");
});

test("PersonalWatchService hot reloads target listeners before each poll", async () => {
  const handled = [];
  const store = new MemoryApprovalStore();
  let targetListeners = [{ chatId: "oc-old" }];
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages(request) {
        handled.push(request);
        return [];
      }
    },
    bridge: {},
    config: {
      targetListeners,
      selfUserId: "ou-me",
      lookbackMinutes: 10
    },
    configProvider() {
      return {
        targetListeners,
        selfUserId: "ou-me",
        lookbackMinutes: 10
      };
    },
    now: () => new Date("2026-05-27T10:10:00+08:00")
  });

  await service.pollOnce();
  targetListeners = [{ chatId: "oc-new" }];
  await service.pollOnce();

  assert.equal(handled[0].chatId, "oc-old");
  assert.equal(handled[1].chatId, "oc-new");
  assert.deepEqual(
    store.logs("system").filter((log) => log.event === "watch_config_reloaded").map((log) => log.data),
    [
      {
        added: ["oc-new"],
        removed: ["oc-old"],
        targetListeners: [{ chatId: "oc-new" }]
      }
    ]
  );
});

test("PersonalWatchService coalesces continuous chat messages and drafts once with context", async () => {
  const notifications = [];
  const handled = [];
  const store = new MemoryApprovalStore();
  let now = new Date("2026-05-27T10:00:00+08:00");
  const messages = [
    {
      messageId: "om-1",
      createdAt: "1779847200000",
      senderId: "ou-target",
      messageType: "text",
      text: "你看看这个"
    },
    {
      messageId: "om-2",
      createdAt: "1779847205000",
      senderId: "ou-target",
      messageType: "text",
      text: "我主要想问明天能不能定"
    }
  ];
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages(request) {
        if (request.pageSize === 20) {
          return [
            {
              messageId: "om-context-self",
              createdAt: "1779847140000",
              senderId: "ou-me",
              messageType: "text",
              text: "我晚点看"
            },
            ...messages
          ];
        }
        return messages;
      },
      async sendText(message) {
        notifications.push(message);
        return { message_id: "om-notify" };
      }
    },
    bridge: {
      async handleLarkMessage(message) {
        handled.push(message);
        return { text: `建议：${message.text}`, channel: "hermes" };
      }
    },
    config: {
      targetListeners: [{ chatId: "oc-chat" }],
      selfUserId: "ou-me",
      lookbackMinutes: 10,
      quietWindowSeconds: 10,
      contextLookbackMessages: 20,
      contextLookbackMinutes: 120,
      contextMaxChars: 6000
    },
    now: () => now
  });

  const first = await service.pollOnce();

  assert.equal(first.processed, 2);
  assert.equal(handled.length, 0);
  assert.equal(notifications.length, 0);

  now = new Date("2026-05-27T10:00:16+08:00");
  const second = await service.pollOnce();

  assert.equal(second.processed, 0);
  assert.equal(handled.length, 1);
  assert.equal(handled[0].messageId, "om-2");
  assert.equal(handled[0].text, "我主要想问明天能不能定");
  assert.deepEqual(
    handled[0].contextMessages.map((message) => [message.messageId, message.text]),
    [
      ["om-context-self", "我晚点看"],
      ["om-1", "你看看这个"],
      ["om-2", "我主要想问明天能不能定"]
    ]
  );
  assert.match(notifications[0].text, /我主要想问明天能不能定/);
});

test("PersonalWatchService does not refresh quiet window for already seen Feishu formatted timestamps", async () => {
  const handled = [];
  const store = new MemoryApprovalStore();
  let now = new Date("2026-05-27T10:00:00+08:00");
  const messages = [
    {
      messageId: "om-1",
      messagePosition: "10",
      createdAt: "2026-05-27 09:59",
      senderId: "ou-target",
      messageType: "text",
      text: "第一条"
    },
    {
      messageId: "om-2",
      messagePosition: "11",
      createdAt: "2026-05-27 09:59",
      senderId: "ou-target",
      messageType: "text",
      text: "第二条"
    }
  ];
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return messages;
      },
      async sendText() {
        return { message_id: "om-notify" };
      }
    },
    bridge: {
      async handleLarkMessage(message) {
        handled.push(message);
        return { text: `建议：${message.text}`, channel: "hermes" };
      }
    },
    config: {
      targetUserIds: ["ou-target"],
      selfUserId: "ou-me",
      lookbackMinutes: 10,
      quietWindowSeconds: 10
    },
    now: () => now
  });

  const first = await service.pollOnce();

  assert.equal(first.processed, 2);
  assert.equal(handled.length, 0);

  now = new Date("2026-05-27T10:00:16+08:00");
  const second = await service.pollOnce();

  assert.equal(second.processed, 0);
  assert.equal(handled.length, 1);
  assert.equal(handled[0].messageId, "om-2");
});


test("PersonalWatchService skips messages already at or before contact watermark", async () => {
  const store = new MemoryApprovalStore();
  store.setWatermark("ou-target", {
    messageId: "om-old",
    createdAt: "1779811200000"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return [
          {
            messageId: "om-old",
            createdAt: "1779811200000",
            senderId: "ou-target",
            messageType: "text",
            text: "old"
          }
        ];
      },
      async sendText() {
        throw new Error("should not notify for duplicate messages");
      }
    },
    bridge: {
      async handleLarkMessage() {
        throw new Error("should not draft duplicate messages");
      }
    },
    config: {
      targetUserIds: ["ou-target"],
      selfUserId: "ou-me",
      lookbackMinutes: 10
    },
    now: () => new Date("2026-05-27T10:10:00+08:00")
  });

  const result = await service.pollOnce();

  assert.equal(result.processed, 0);
});

test("PersonalWatchService falls back to lookback window when stored watermark time is invalid", async () => {
  const handled = [];
  const store = new MemoryApprovalStore();
  store.setWatermark("ou-target", {
    messageId: "om-old",
    createdAt: "not-a-number"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages(request) {
        handled.push(request);
        return [];
      }
    },
    bridge: {},
    config: {
      targetUserIds: ["ou-target"],
      selfUserId: "ou-me",
      lookbackMinutes: 10
    },
    now: () => new Date("2026-05-27T10:10:00+08:00")
  });

  await service.pollOnce();

  assert.equal(handled[0].start, "2026-05-27T10:00:00+08:00");
});

test("PersonalWatchService sends approved draft back to original message as user", async () => {
  const replies = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    senderId: "ou-target",
    text: "帮我看一下",
    draftText: "可以，我明天上午看。",
    channel: "codex"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {
      async replyText(reply) {
        replies.push(reply);
        return { message_id: "om-reply" };
      }
    },
    bridge: {},
    config: {
      replyAs: "user"
    }
  });

  const result = await service.handleConfirmationText({
    senderId: "ou-me",
    text: "send req-1"
  });

  assert.equal(result.status, STATUS.SENT);
  assert.deepEqual(replies, [
    {
      as: "user",
      messageId: "om-source",
      text: "可以，我明天上午看。",
      idempotencyKey: "reply-req-1"
    }
  ]);
  assert.equal(store.get("req-1").sentMessageId, "om-reply");
});

test("PersonalWatchService rejects sending superseded drafts", async () => {
  const notifications = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-old",
    status: STATUS.SUPERSEDED,
    messageId: "om-source",
    draftText: "旧建议"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {
      async sendMarkdown(message) {
        notifications.push(message);
        return { message_id: "om-expired" };
      },
      async replyText() {
        throw new Error("should not send superseded drafts");
      }
    },
    bridge: {},
    config: {
      replyAs: "user"
    }
  });

  const result = await service.handleConfirmationText({
    senderId: "ou-me",
    text: "send req-old"
  });

  assert.equal(result.status, STATUS.SUPERSEDED);
  assert.equal(result.reason, "request_superseded");
  assert.match(notifications[0].markdown, /Suggestion expired/);
  assert.match(notifications[0].markdown, /req-old/);
});


test("PersonalWatchService rewrites a pending draft from bot confirmation text", async () => {
  const notifications = [];
  const handled = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    status: STATUS.PENDING_APPROVAL,
    eventId: "poll-1",
    messageId: "om-source",
    senderId: "ou-target",
    selfUserId: "ou-me",
    text: "帮我看一下",
    draftText: "可以",
    contextMessages: [{ messageId: "om-context", text: "前文", messageType: "text" }],
    contextMaxChars: 1200,
    contextSummary: "对方希望你帮忙看一下材料。",
    channel: "codex"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {
      async sendMarkdown(message) {
        notifications.push(message);
        return { message_id: "om-notify-2" };
      }
    },
    bridge: {
      async handleLarkMessage(message) {
        handled.push(message);
        return { text: `改后：${message.rewriteInstruction}`, channel: "codex" };
      }
    },
    config: {
      selfUserId: "ou-me",
      notifyAs: "bot"
    }
  });

  const result = await service.handleConfirmationText({
    senderId: "ou-me",
    text: "rewrite req-1 更短一点"
  });

  assert.equal(result.status, STATUS.PENDING_APPROVAL);
  assert.deepEqual(handled[0].contextMessages, [{ messageId: "om-context", text: "前文", messageType: "text" }]);
  assert.equal(handled[0].contextMaxChars, 1200);
  assert.equal(handled[0].selfUserId, "ou-me");
  assert.equal(store.get("req-1").draftText, "改后：更短一点");
  assert.equal(store.get("req-1").approvalMessageId, "om-notify-2");
  assert.match(notifications[0].markdown, /Rewritten as requested/);
  assert.match(notifications[0].markdown, /更短一点/);
  assert.match(notifications[0].markdown, /对方希望你帮忙看一下材料。/);
  assert.match(notifications[0].markdown, /改后：更短一点/);
  assert.match(notifications[0].markdown, /send req-1/);
  assert.match(notifications[0].markdown, /rewrite req-1/);
  assert.match(notifications[0].markdown, /ignore req-1/);
  assert.match(notifications[0].idempotencyKey, /^rn-1-/);
  assert.ok(notifications[0].idempotencyKey.length <= 50);
  assert.match(
    store.logs("req-1").find((log) => log.event === "rewrite_notification_sent").data.messageId,
    /om-notify-2/
  );
});

test("PersonalWatchService rejects rewriting superseded drafts with an explicit notification", async () => {
  const notifications = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-old",
    status: STATUS.SUPERSEDED,
    messageId: "om-source",
    text: "原消息",
    draftText: "旧建议"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {
      async sendMarkdown(message) {
        notifications.push(message);
        return { message_id: "om-expired" };
      }
    },
    bridge: {
      async handleLarkMessage() {
        throw new Error("should not rewrite superseded drafts");
      }
    },
    config: {
      selfUserId: "ou-me",
      notifyAs: "bot"
    }
  });

  const result = await service.handleConfirmationText({
    senderId: "ou-me",
    text: "改写 req-old 更短"
  });

  assert.equal(result.status, STATUS.SUPERSEDED);
  assert.equal(result.reason, "request_superseded");
  assert.match(notifications[0].markdown, /Suggestion expired/);
  assert.match(notifications[0].markdown, /req-old/);
});

test("PersonalWatchService ignores a pending draft from bot confirmation text", async () => {
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    draftText: "draft"
  });
  const service = new PersonalWatchService({
    store,
    imClient: {},
    bridge: {},
    config: {}
  });

  const result = await service.handleConfirmationText({
    senderId: "ou-me",
    text: "ignore req-1"
  });

  assert.equal(result.status, STATUS.IGNORED);
  assert.equal(store.get("req-1").status, STATUS.IGNORED);
});
