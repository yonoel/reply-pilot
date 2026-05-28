export function buildAgentPrompt(request) {
  if (request.task === "context-summary") {
    return buildContextSummaryPrompt(request);
  }
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

function buildContextSummaryPrompt(request) {
  const conversation = request.conversation ?? {};
  const metadata = request.metadata ?? {};
  const context = formatContextMessages(request.contextMessages ?? [], conversation.selfUserId, request.contextMaxChars);
  return [
    "You are summarizing a Lark conversation for the message owner.",
    "Write a concise Chinese summary so the owner can understand the context before deciding whether to send the suggested reply.",
    "",
    "Requirements:",
    "- Focus on what the other person wants, what has already been discussed, and any pending decision or deadline.",
    "- Keep it to 1-2 short sentences.",
    "- Do not suggest a reply.",
    "- Output only the summary.",
    "",
    `Chat: ${conversation.chatId ?? "unknown"}`,
    `Current message ID: ${conversation.messageId ?? "unknown"}`,
    `Request ID: ${metadata.eventId ?? "unknown"}`,
    "",
    "Conversation context:",
    context || "(no previous context)",
    "",
    "Current message:",
    request.input ?? ""
  ].join("\n");
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
