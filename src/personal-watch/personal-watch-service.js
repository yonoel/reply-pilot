import crypto from "node:crypto";

import { parseConfirmationCommand } from "./confirmation-command.js";
import { STATUS } from "../workflow/status.js";

export class PersonalWatchService {
  /**
   * @param {{
 *   store: any,
 *   imClient: any,
 *   bridge: any,
 *   contactClient?: any,
 *   config?: any,
 *   configProvider?: () => any | Promise<any>,
 *   now?: () => Date
 * }} options
 */
  constructor({ store, imClient, bridge, contactClient, config = {}, configProvider, now = () => new Date() }) {
    this.store = store;
    this.imClient = imClient;
    this.contactClient = contactClient;
    this.bridge = bridge;
    this.config = normalizeConfig(config);
    this.configProvider = configProvider;
    this.now = now;
    this.timer = undefined;
    this.stopped = true;
    this.batches = new Map();
    this.drafting = new Set();
    this.pendingRequestByChat = new Map();
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    const run = async () => {
      try {
        await this.pollOnce();
      } catch (error) {
        console.error(`personal watch poll failed: ${error.message}`);
      } finally {
        if (!this.stopped) {
          this.timer = setTimeout(run, this.config.pollIntervalSeconds * 1000);
        }
      }
    };
    void run();
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async pollOnce() {
    await this.reloadConfig();
    this.store.log("system", "poll_started", {
      targetListeners: this.config.targetListeners
    });
    let processed = 0;
    for (const listener of this.config.targetListeners) {
      const watermarkKey = listener.chatId ?? listener.openId;
      const watermark = this.store.getWatermark(watermarkKey);
      const endDate = this.now();
      const watermarkTime = messageTimeMs(watermark?.createdAt);
      const startDate = Number.isFinite(watermarkTime)
        ? new Date(watermarkTime)
        : new Date(endDate.getTime() - this.config.lookbackMinutes * 60 * 1000);
      const listRequest = {
        start: formatIsoWithOffset(startDate),
        end: formatIsoWithOffset(endDate)
      };
      if (listener.openId) {
        listRequest.targetUserId = listener.openId;
      }
      if (listener.chatId) {
        listRequest.chatId = listener.chatId;
      }
      const messages = await this.imClient.listP2pMessages(listRequest);

      for (const message of messages) {
        if (!shouldProcess({ message, listener, watermark, selfUserId: this.config.selfUserId })) {
          continue;
        }
        this.queueMessage({ listener, message });
        this.store.setWatermark(watermarkKey, {
          messageId: message.messageId,
          createdAt: message.createdAt,
          ...(message.messagePosition !== undefined ? { messagePosition: message.messagePosition } : {})
        });
        processed += 1;
      }
    }
    await this.flushDueBatches();
    this.store.log("system", "poll_finished", { processed });
    return { processed };
  }

  async reloadConfig() {
    if (!this.configProvider) {
      return;
    }
    const nextConfig = normalizeConfig(await this.configProvider());
    const previousKeys = new Set(this.config.targetListeners.map(listenerKey));
    const nextKeys = new Set(nextConfig.targetListeners.map(listenerKey));
    const added = [...nextKeys].filter((key) => !previousKeys.has(key));
    const removed = [...previousKeys].filter((key) => !nextKeys.has(key));
    this.config = nextConfig;
    if (added.length || removed.length) {
      this.store.log("system", "watch_config_reloaded", {
        added,
        removed,
        targetListeners: this.config.targetListeners
      });
    }
  }

  queueMessage({ listener, message }) {
    const chatKey = listener.chatId ?? listener.openId;
    const pendingRequestId = this.pendingRequestByChat.get(chatKey);
    if (pendingRequestId) {
      const pending = this.store.get(pendingRequestId);
      if (pending?.status === STATUS.PENDING_APPROVAL) {
        this.store.update(pendingRequestId, {
          status: STATUS.SUPERSEDED,
          supersededByMessageId: message.messageId
        });
        this.store.log(pendingRequestId, "superseded_by_new_message", { messageId: message.messageId });
      }
      this.pendingRequestByChat.delete(chatKey);
    }

    const batch = this.batches.get(chatKey) ?? {
      listener,
      messages: [],
      latestMessage: undefined,
      updatedAtMs: 0,
      dirty: false
    };
    batch.listener = listener;
    batch.messages.push(message);
    batch.latestMessage = message;
    batch.updatedAtMs = this.now().getTime();
    if (this.drafting.has(chatKey)) {
      batch.dirty = true;
    }
    this.batches.set(chatKey, batch);
  }

  async flushDueBatches() {
    const nowMs = this.now().getTime();
    for (const [chatKey, batch] of [...this.batches.entries()]) {
      if (this.drafting.has(chatKey)) {
        continue;
      }
      if (nowMs - batch.updatedAtMs < this.config.quietWindowSeconds * 1000) {
        continue;
      }
      await this.processBatch({ chatKey, batch });
    }
  }

  async processBatch({ chatKey, batch }) {
    const message = batch.latestMessage;
    const listener = batch.listener;
    const requestId = createRequestId(message);
    if (this.store.get(requestId)) {
      return;
    }
    const targetId = listener.openId ?? listener.chatId;
    this.drafting.add(chatKey);

    this.store.create({
      id: requestId,
      eventId: requestId,
      senderId: message.senderId,
      chatId: targetId,
      messageId: message.messageId,
      text: message.text,
      status: STATUS.RECEIVED,
      source: "personal-watch"
    });
    this.store.log(requestId, "personal_watch_message_found", {
      targetId,
      messageId: message.messageId
    });

    try {
      const contextMessages = await this.loadContextMessages({ listener, anchorMessage: message });
      const contextSummary = await this.createContextSummary({
        requestId,
        message,
        targetId,
        contextMessages
      });
      this.store.log(requestId, "hermes_draft_started", {});
      const draft = await this.bridge.handleLarkMessage({
        eventId: requestId,
        senderId: message.senderId,
        selfUserId: this.config.selfUserId,
        chatId: targetId,
        messageId: message.messageId,
        text: message.text,
        contextMessages,
        contextMaxChars: this.config.contextMaxChars
      });

      const latestBatch = this.batches.get(chatKey);
      if (latestBatch?.dirty || latestBatch?.latestMessage?.messageId !== message.messageId) {
        this.store.update(requestId, {
          status: STATUS.SUPERSEDED
        });
        this.store.log(requestId, "superseded_during_draft", {
          latestMessageId: latestBatch?.latestMessage?.messageId
        });
        if (latestBatch) {
          latestBatch.dirty = false;
          latestBatch.updatedAtMs = this.now().getTime();
          this.batches.set(chatKey, latestBatch);
        }
        return;
      }

      this.store.update(requestId, {
        status: STATUS.PENDING_APPROVAL,
        draftText: draft.text,
        contextSummary,
        channel: draft.channel
      });
      this.pendingRequestByChat.set(chatKey, requestId);
      this.store.log(requestId, "hermes_draft_finished", { channel: draft.channel });

      const notification = await this.notifySelf({
        requestId,
        targetUserId: message.senderId,
        sourceText: message.text,
        contextSummary,
        draftText: draft.text
      });
      this.store.update(requestId, {
        approvalMessageId: notification.message_id
      });
      this.store.log(requestId, "personal_watch_notification_sent", { messageId: notification.message_id });
      this.batches.delete(chatKey);
    } catch (error) {
      this.store.update(requestId, {
        status: STATUS.DRAFT_FAILED,
        errorMessage: error.message
      });
      this.store.log(requestId, "draft_failed", { message: error.message });
      this.batches.delete(chatKey);
    } finally {
      this.drafting.delete(chatKey);
    }
  }

  async loadContextMessages({ listener, anchorMessage }) {
    const anchorTime = messageTimeMs(anchorMessage.createdAt);
    const endDate = Number.isFinite(anchorTime) ? new Date(anchorTime + 1000) : this.now();
    const startDate = new Date(endDate.getTime() - this.config.contextLookbackMinutes * 60 * 1000);
    const request = {
      start: formatIsoWithOffset(startDate),
      end: formatIsoWithOffset(endDate),
      pageSize: this.config.contextLookbackMessages
    };
    if (listener.openId) {
      request.targetUserId = listener.openId;
    }
    if (listener.chatId) {
      request.chatId = listener.chatId;
    }
    const messages = await this.imClient.listP2pMessages(request);
    const context = messages
      .filter((candidate) => candidate.messageType === "text" && candidate.text.trim())
      .filter((candidate) => !Number.isFinite(anchorTime) || Number(candidate.createdAt) <= anchorTime)
      .slice(-this.config.contextLookbackMessages);

    if (!context.some((candidate) => candidate.messageId === anchorMessage.messageId)) {
      context.push(anchorMessage);
    }
    return context;
  }

  async handleConfirmationText({ senderId, text }) {
    if (this.config.selfUserId && senderId !== this.config.selfUserId) {
      return { ignored: true, reason: "sender_not_self" };
    }

    const command = parseConfirmationCommand(text);
    if (!command) {
      return { ignored: true, reason: "not_confirmation_command" };
    }

    this.store.log(command.requestId, "confirmation_received", {
      action: command.action,
      senderId
    });
    const record = this.store.get(command.requestId);
    if (!record) {
      throw new Error(`approval request not found: ${command.requestId}`);
    }
    if (record.status !== STATUS.PENDING_APPROVAL) {
      if (record.status === STATUS.SUPERSEDED && ["send", "rewrite"].includes(command.action)) {
        await this.notifyExpiredRequest({ requestId: command.requestId });
      }
      return {
        requestId: command.requestId,
        status: record.status,
        reason: record.status === STATUS.SUPERSEDED ? "request_superseded" : undefined
      };
    }

    if (command.action === "send") {
      const sent = await this.imClient.replyText({
        as: this.config.replyAs,
        messageId: record.messageId,
        text: record.draftText,
        idempotencyKey: `reply-${command.requestId}`
      });
      this.store.update(command.requestId, {
        status: STATUS.SENT,
        approvedBy: senderId,
        sentMessageId: sent.message_id
      });
      this.store.log(command.requestId, "sent", { messageId: sent.message_id });
      return {
        requestId: command.requestId,
        status: STATUS.SENT
      };
    }

    if (command.action === "rewrite") {
      const draft = await this.bridge.handleLarkMessage({
        eventId: record.eventId,
        senderId: record.senderId,
        chatId: record.chatId,
        messageId: record.messageId,
        text: record.text,
        rewriteInstruction: command.instruction,
        previousDraftText: record.draftText
      });
      this.store.update(command.requestId, {
        status: STATUS.PENDING_APPROVAL,
        draftText: draft.text,
        rewriteInstruction: command.instruction,
        requestedBy: senderId
      });
      const notification = await this.notifySelf({
        requestId: command.requestId,
        targetUserId: record.senderId,
        sourceText: record.text,
        contextSummary: record.contextSummary,
        draftText: draft.text,
        title: `Rewritten as requested: ${command.instruction}`,
        idempotencyKey: createRewriteNotificationIdempotencyKey(command.requestId)
      });
      this.store.update(command.requestId, {
        approvalMessageId: notification.message_id
      });
      this.store.log(command.requestId, "rewritten", { instruction: command.instruction });
      this.store.log(command.requestId, "rewrite_notification_sent", { messageId: notification.message_id });
      return {
        requestId: command.requestId,
        status: STATUS.PENDING_APPROVAL
      };
    }

    if (command.action === "ignore") {
      this.store.update(command.requestId, {
        status: STATUS.IGNORED,
        ignoredBy: senderId
      });
      this.store.log(command.requestId, "ignored", { senderId });
      return {
        requestId: command.requestId,
        status: STATUS.IGNORED
      };
    }

    throw new Error(`unsupported confirmation action: ${command.action}`);
  }

  async createContextSummary({ requestId, message, targetId, contextMessages }) {
    if (typeof this.bridge.handleLarkContextSummary !== "function") {
      return "";
    }
    this.store.log(requestId, "context_summary_started", {});
    try {
      const summary = await this.bridge.handleLarkContextSummary({
        eventId: requestId,
        senderId: message.senderId,
        selfUserId: this.config.selfUserId,
        chatId: targetId,
        messageId: message.messageId,
        text: message.text,
        contextMessages,
        contextMaxChars: this.config.contextMaxChars
      });
      this.store.log(requestId, "context_summary_finished", { channel: summary.channel });
      return summary.text;
    } catch (error) {
      this.store.log(requestId, "context_summary_failed", { message: error.message });
      return "";
    }
  }

  async notifySelf({
    requestId,
    targetUserId,
    sourceText,
    contextSummary = "",
    draftText,
    title = undefined,
    idempotencyKey = undefined
  }) {
    const senderName = await this.resolveDisplayName(targetUserId);
    const markdown = buildNotificationMarkdown({
      requestId,
      senderName,
      targetUserId,
      sourceText,
      contextSummary,
      draftText,
      title
    });
    if (typeof this.imClient.sendMarkdown === "function") {
      return this.imClient.sendMarkdown({
        as: this.config.notifyAs,
        userId: this.config.selfUserId,
        markdown,
        idempotencyKey: idempotencyKey ?? `notify-${requestId}`
      });
    }
    return this.imClient.sendText({
      as: this.config.notifyAs,
      userId: this.config.selfUserId,
      text: markdown,
      idempotencyKey: idempotencyKey ?? `notify-${requestId}`
    });
  }

  async resolveDisplayName(openId) {
    if (!this.contactClient || !openId || openId.startsWith("oc_")) {
      return openId;
    }
    return this.contactClient.getDisplayName(openId);
  }

  async notifyExpiredRequest({ requestId }) {
    const markdown = [
      "**Suggestion expired**",
      "",
      `requestId: \`${requestId}\``,
      "",
      "A newer message has arrived in this conversation. Use the requestId from the latest notification."
    ].join("\n");
    if (typeof this.imClient.sendMarkdown === "function") {
      return this.imClient.sendMarkdown({
        as: this.config.notifyAs,
        userId: this.config.selfUserId,
        markdown,
        idempotencyKey: `expired-${requestId}`
      });
    }
    return this.imClient.sendText({
      as: this.config.notifyAs,
      userId: this.config.selfUserId,
      text: markdown,
      idempotencyKey: `expired-${requestId}`
    });
  }
}

function normalizeTargetListeners(config) {
  if (Array.isArray(config.targetListeners) && config.targetListeners.length) {
    return config.targetListeners.map((listener) =>
      typeof listener === "string" ? { openId: listener } : { ...listener }
    );
  }
  return (config.targetUserIds ?? []).map((openId) => ({ openId }));
}

function normalizeConfig(config = {}) {
  return {
    targetListeners: normalizeTargetListeners(config),
    selfUserId: config.selfUserId,
    pollIntervalSeconds: config.pollIntervalSeconds ?? 30,
    lookbackMinutes: config.lookbackMinutes ?? 10,
    quietWindowSeconds: config.quietWindowSeconds ?? 10,
    contextLookbackMessages: config.contextLookbackMessages ?? 20,
    contextLookbackMinutes: config.contextLookbackMinutes ?? 120,
    contextMaxChars: config.contextMaxChars ?? 6000,
    notifyAs: config.notifyAs ?? "bot",
    replyAs: config.replyAs ?? "user"
  };
}

function listenerKey(listener) {
  return listener.chatId ?? listener.openId;
}

function shouldProcess({ message, listener, watermark, selfUserId }) {
  if (message.messageType !== "text" || !message.text.trim()) {
    return false;
  }
  if (listener.openId && message.senderId !== listener.openId) {
    return false;
  }
  if (listener.chatId && selfUserId && message.senderId === selfUserId) {
    return false;
  }
  if (!watermark) {
    return true;
  }
  const currentTime = messageTimeMs(message.createdAt);
  const lastTime = messageTimeMs(watermark.createdAt);
  if (Number.isFinite(currentTime) && Number.isFinite(lastTime) && currentTime < lastTime) {
    return false;
  }
  if (Number.isFinite(currentTime) && Number.isFinite(lastTime) && currentTime === lastTime) {
    const currentPosition = messagePositionNumber(message.messagePosition);
    const lastPosition = messagePositionNumber(watermark.messagePosition);
    if (Number.isFinite(currentPosition) && Number.isFinite(lastPosition) && currentPosition <= lastPosition) {
      return false;
    }
  }
  return !(message.messageId === watermark.messageId && message.createdAt === watermark.createdAt);
}

function messageTimeMs(value) {
  if (value === undefined || value === null || value === "") {
    return Number.NaN;
  }
  if (typeof value === "number") {
    return value;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const parsed = Date.parse(String(value).replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function messagePositionNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function createRequestId(message) {
  return `req-${crypto
    .createHash("sha256")
    .update(`${message.messageId}:${message.createdAt}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function createRewriteNotificationIdempotencyKey(requestId) {
  return `rn-${requestId.replace(/^req-/, "").slice(0, 24)}-${crypto.randomUUID().slice(0, 8)}`;
}

function buildNotificationMarkdown({ requestId, senderName, targetUserId, sourceText, contextSummary, draftText, title }) {
  const source = senderName || targetUserId;
  const sections = [
    `**${title ?? `New message from ${source}`}**`,
    "",
    "**Original message**",
    "```",
    sourceText,
    "```"
  ];
  if (contextSummary) {
    sections.push("", "**Context summary**", "```", contextSummary, "```");
  }
  sections.push(
    "",
    "**Suggested reply**",
    "```",
    draftText,
    "```",
    "",
    "**Actions**",
    `- Send: \`send ${requestId}\``,
    `- Rewrite: \`rewrite ${requestId} <instruction>\``,
    `- Ignore: \`ignore ${requestId}\``
  );
  return sections.join("\n");
}

function formatIsoWithOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absOffset % 60).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}${sign}${offsetHours}:${offsetRemainder}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
