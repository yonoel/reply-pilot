export function createAgentBridge({ channel }) {
  if (!channel || typeof channel.send !== "function") {
    throw new Error("agent bridge requires a channel with send(request)");
  }

  return {
    async handleLarkMessage(message) {
      const request = {
        input: message.text,
        conversation: {
          platform: "lark",
          chatId: message.chatId,
          messageId: message.messageId,
          senderId: message.senderId
        },
        metadata: {
          eventId: message.eventId
        }
      };
      if (message.contextMessages) {
        request.contextMessages = message.contextMessages;
      }
      if (message.contextMaxChars) {
        request.contextMaxChars = message.contextMaxChars;
      }
      if (message.selfUserId) {
        request.conversation.selfUserId = message.selfUserId;
      }
      if (message.rewriteInstruction) {
        request.rewriteInstruction = message.rewriteInstruction;
      }
      if (message.previousDraftText) {
        request.previousDraftText = message.previousDraftText;
      }
      const agentResponse = await channel.send(request);

      return {
        text: agentResponse.text,
        channel: channel.name
      };
    }
  };
}
