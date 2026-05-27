export function buildAgentPrompt(request) {
  if (request.promptTemplate) {
    return renderTemplate(request.promptTemplate, request);
  }
  if (request.channelPromptTemplate) {
    return renderTemplate(request.channelPromptTemplate, request);
  }
  const conversation = request.conversation ?? {};
  const metadata = request.metadata ?? {};
  const lines = [
    "You are my Lark message reply copilot.",
    "Draft one reply that I can send to the contact below.",
    "Requirements: natural, concise, suitable for workplace communication, and close to my voice. Do not pretend to be a bot. Output only the reply body.",
    "",
    `Contact open_id: ${conversation.senderId ?? conversation.chatId ?? "unknown"}`,
    `Chat: ${conversation.chatId ?? "unknown"}`,
    `Original message ID: ${conversation.messageId ?? "unknown"}`,
    `Request ID: ${metadata.eventId ?? "unknown"}`,
    "",
    "Original message:",
    request.input ?? ""
  ];

  if (request.rewriteInstruction) {
    lines.push("", "Rewrite instruction:", request.rewriteInstruction);
  }
  if (request.previousDraftText) {
    lines.push("", "Previous draft:", request.previousDraftText);
  }

  return lines.join("\n");
}

function renderTemplate(template, request) {
  const conversation = request.conversation ?? {};
  const context = formatContextMessages(request.contextMessages ?? [], conversation.selfUserId, request.contextMaxChars);
  return template
    .replaceAll("{{persona}}", request.persona ?? "")
    .replaceAll("{{context}}", context)
    .replaceAll("{{currentMessage}}", request.input ?? "")
    .replaceAll("{{message}}", request.input ?? "")
    .replaceAll("{{senderId}}", conversation.senderId ?? "")
    .replaceAll("{{chatId}}", conversation.chatId ?? "");
}

function formatContextMessages(messages, selfUserId, maxChars = 6000) {
  const lines = messages.map((message) => {
    const speaker = selfUserId && message.senderId === selfUserId ? "Me" : "Them";
    return `${speaker}: ${message.text}`;
  });
  let text = lines.join("\n");
  if (text.length <= maxChars) {
    return text;
  }
  text = text.slice(text.length - maxChars);
  return `...[earlier context truncated]\n${text}`;
}
