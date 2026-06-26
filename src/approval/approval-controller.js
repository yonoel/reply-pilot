import { interpretApprovalInstruction } from "./instruction-rules.js";
import { STATUS } from "../workflow/status.js";

export function createApprovalController({ store, imClient, bridge, config = {}, eventBus = undefined }) {
  const runtimeConfig = /** @type {any} */ (config);
  return {
    listPending() {
      return store.pendingRequests();
    },

    getRequest(requestId) {
      return store.get(requestId);
    },

    async send(requestId, actor = "desktop-pet") {
      const record = requireRequest(store, requestId);
      if (record.status !== STATUS.PENDING_APPROVAL) {
        return record;
      }
      store.log(requestId, "approval_send_requested", { actor });
      try {
        const sent = await imClient.replyText({
          as: runtimeConfig.replyAs ?? "user",
          messageId: record.messageId,
          text: record.draftText,
          idempotencyKey: `reply-${requestId}`
        });
        const updated = store.update(requestId, {
          status: STATUS.SENT,
          uiState: "idle",
          approvedBy: actor,
          sentMessageId: sent.message_id
        });
        store.log(requestId, "sent", { actor, messageId: sent.message_id });
        publishUpdated(eventBus, updated);
        return updated;
      } catch (error) {
        const failed = store.update(requestId, {
          status: STATUS.SEND_FAILED,
          uiState: "error",
          errorMessage: error.message
        });
        store.log(requestId, "send_failed", { actor, message: error.message });
        publishUpdated(eventBus, failed);
        throw error;
      }
    },

    async ignore(requestId, actor = "desktop-pet") {
      const record = requireRequest(store, requestId);
      if (record.status !== STATUS.PENDING_APPROVAL) {
        return record;
      }
      store.log(requestId, "approval_ignore_requested", { actor });
      const updated = store.update(requestId, {
        status: STATUS.IGNORED,
        uiState: "idle",
        ignoredBy: actor
      });
      store.log(requestId, "ignored", { actor });
      publishUpdated(eventBus, updated);
      return updated;
    },

    async handleInstruction({ requestId, instruction, actor = "desktop-pet" }) {
      const interpreted = interpretApprovalInstruction(instruction);
      const record = requireRequest(store, requestId);
      store.log(requestId, "approval_instruction_received", { actor, interpreted });
      if (interpreted.action === "empty") {
        return { action: "empty", request: record };
      }
      if (interpreted.action === "send" && !allowDirectSendByInstruction(runtimeConfig)) {
        return {
          action: "rewrite",
          request: await rewriteRequest({
            requestId,
            instruction: String(instruction).trim(),
            actor,
            store,
            bridge,
            eventBus
          })
        };
      }
      if (interpreted.action === "send") {
        return { action: "send", request: await this.send(requestId, actor) };
      }
      if (interpreted.action === "ignore") {
        return { action: "ignore", request: await this.ignore(requestId, actor) };
      }
      return {
        action: "rewrite",
        request: await rewriteRequest({
          requestId,
          instruction: interpreted.instruction,
          actor,
          store,
          bridge,
          eventBus
        })
      };
    }
  };
}

async function rewriteRequest({ requestId, instruction, actor, store, bridge, eventBus }) {
  const record = requireRequest(store, requestId);
  if (record.status !== STATUS.PENDING_APPROVAL) {
    return record;
  }
  const thinking = store.update(requestId, {
    uiState: "thinking",
    rewriteInstruction: instruction,
    requestedBy: actor
  });
  publishUpdated(eventBus, thinking);

  try {
    const draft = await bridge.handleLarkMessage({
      eventId: record.eventId,
      senderId: record.senderId,
      selfUserId: record.selfUserId,
      chatId: record.chatId,
      messageId: record.messageId,
      text: record.text,
      contextMessages: record.contextMessages,
      contextMaxChars: record.contextMaxChars,
      contextSummary: record.contextSummary,
      rewriteInstruction: instruction,
      previousDraftText: record.draftText
    });
    const updated = store.update(requestId, {
      status: STATUS.PENDING_APPROVAL,
      uiState: "pending",
      draftText: draft.text,
      channel: draft.channel,
      rewriteInstruction: instruction,
      requestedBy: actor
    });
    store.log(requestId, "rewritten", { actor, instruction });
    publishUpdated(eventBus, updated);
    return updated;
  } catch (error) {
    const failed = store.update(requestId, {
      status: STATUS.DRAFT_FAILED,
      uiState: "error",
      errorMessage: error.message
    });
    store.log(requestId, "rewrite_failed", { actor, instruction, message: error.message });
    publishUpdated(eventBus, failed);
    throw error;
  }
}

function requireRequest(store, requestId) {
  const record = store.get(requestId);
  if (!record) {
    throw new Error(`approval request not found: ${requestId}`);
  }
  return record;
}

function publishUpdated(eventBus, request) {
  eventBus?.publish({
    type: "updated",
    request
  });
}

function allowDirectSendByInstruction(config) {
  return config.approval?.allowDirectSendByInstruction !== false;
}
