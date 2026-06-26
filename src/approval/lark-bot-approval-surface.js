export class LarkBotApprovalSurface {
  constructor({ imClient, contactClient = undefined, config = {} }) {
    this.imClient = imClient;
    this.contactClient = contactClient;
    this.config = /** @type {any} */ (config);
  }

  async notifyPending(request) {
    const senderName = await this.resolveDisplayName(request.senderId);
    const markdown = buildNotificationMarkdown({
      requestId: request.id,
      senderName,
      targetUserId: request.senderId,
      sourceText: request.text,
      contextSummary: request.contextSummary,
      draftText: request.draftText,
      title: undefined
    });
    const result = await this.sendMarkdownOrText({
      markdown,
      idempotencyKey: `notify-${request.id}`
    });
    return {
      surface: "lark-bot",
      messageId: result.message_id,
      message_id: result.message_id
    };
  }

  async notifyExpired(requestId) {
    const markdown = [
      "**Suggestion expired**",
      "",
      `requestId: \`${requestId}\``,
      "",
      "A newer message has arrived in this conversation. Use the requestId from the latest notification."
    ].join("\n");
    return this.sendMarkdownOrText({
      markdown,
      idempotencyKey: `expired-${requestId}`
    });
  }

  async resolveDisplayName(openId) {
    if (!this.contactClient || !openId || openId.startsWith("oc_")) {
      return openId;
    }
    return this.contactClient.getDisplayName(openId);
  }

  async sendMarkdownOrText({ markdown, idempotencyKey }) {
    if (typeof this.imClient.sendMarkdown === "function") {
      return this.imClient.sendMarkdown({
        as: this.config.notifyAs ?? "bot",
        userId: this.config.selfUserId,
        markdown,
        idempotencyKey
      });
    }
    return this.imClient.sendText({
      as: this.config.notifyAs ?? "bot",
      userId: this.config.selfUserId,
      text: markdown,
      idempotencyKey
    });
  }
}

export function buildNotificationMarkdown({
  requestId,
  senderName,
  targetUserId,
  sourceText,
  contextSummary,
  draftText,
  title = undefined
}) {
  const source = senderName || targetUserId;
  const sections = [
    `**${title ?? `New message from ${source}`}**`,
    "",
    "**Original message**",
    "```",
    fencedMarkdownValue(sourceText),
    "```"
  ];
  if (contextSummary) {
    sections.push("", "**Context summary**", "```", fencedMarkdownValue(contextSummary), "```");
  }
  sections.push(
    "",
    "**Suggested reply**",
    "```",
    fencedMarkdownValue(draftText),
    "```",
    "",
    "**Actions**",
    `- Send: \`send ${requestId}\``,
    `- Rewrite: \`rewrite ${requestId} <instruction>\``,
    `- Ignore: \`ignore ${requestId}\``
  );
  return sections.join("\n");
}

function fencedMarkdownValue(value) {
  return String(value ?? "").replaceAll("```", "``\\`");
}
