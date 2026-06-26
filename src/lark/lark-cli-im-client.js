import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class LarkCliImClient {
  constructor({ runCommand = runExecFile, now = () => new Date() } = {}) {
    this.runCommand = runCommand;
    this.now = now;
  }

  async listP2pMessages({ targetUserId, chatId, start, end, pageSize = 50 }) {
    if (!chatId && !targetUserId) {
      throw new Error("listP2pMessages requires chatId or targetUserId");
    }
    const targetArgs = chatId ? ["--chat-id", chatId] : ["--user-id", targetUserId];
    const args = ["im", "+chat-messages-list", "--as", "user", ...targetArgs, "--start", start, "--end", end, "--sort", "asc", "--page-size", String(pageSize), "--format", "json"];
    const body = await this.runJson(args);
    return messageItems(body).map(normalizeMessage).filter(Boolean);
  }

  async getChat({ chatId, as = "user" }) {
    const body = await this.runJson([
      "im",
      "chats",
      "get",
      "--as",
      as,
      "--params",
      JSON.stringify({
        chat_id: chatId,
        user_id_type: "open_id"
      }),
      "--format",
      "json"
    ]);
    return body.data ?? body;
  }

  async listRecentChatMessages({ chatId, start, end, pageSize = 20 }) {
    const args = [
      "im",
      "+chat-messages-list",
      "--as",
      "user",
      "--chat-id",
      chatId,
      "--start",
      start,
      "--end",
      end,
      "--sort",
      "desc",
      "--page-size",
      String(pageSize),
      "--format",
      "json"
    ];
    const body = await this.runJson(args);
    return messageItems(body).map(normalizeMessage).filter(Boolean);
  }

  async sendText({ as = "bot", userId, text, idempotencyKey }) {
    const args = ["im", "+messages-send", "--as", as, "--user-id", userId, "--text", text];
    if (idempotencyKey) {
      args.push("--idempotency-key", idempotencyKey);
    }
    const body = await this.runJson(args);
    return body.data ?? body;
  }

  async sendMarkdown({ as = "bot", userId, markdown, idempotencyKey }) {
    const args = ["im", "+messages-send", "--as", as, "--user-id", userId, "--markdown", markdown];
    if (idempotencyKey) {
      args.push("--idempotency-key", idempotencyKey);
    }
    const body = await this.runJson(args);
    return body.data ?? body;
  }

  async replyText({ as = "user", messageId, text, idempotencyKey }) {
    const args = ["im", "+messages-reply", "--as", as, "--message-id", messageId, "--text", text];
    if (idempotencyKey) {
      args.push("--idempotency-key", idempotencyKey);
    }
    const body = await this.runJson(args);
    return body.data ?? body;
  }

  async runJson(args) {
    const { stdout } = await this.runCommand("lark-cli", args);
    const body = JSON.parse(stdout || "{}");
    if (body.code && body.code !== 0) {
      throw new Error(`lark-cli im failed: ${body.code} ${body.msg ?? ""}`.trim());
    }
    return body;
  }
}

function messageItems(body) {
  if (Array.isArray(body)) {
    return body;
  }
  if (Array.isArray(body.items)) {
    return body.items;
  }
  if (Array.isArray(body.data?.items)) {
    return body.data.items;
  }
  if (Array.isArray(body.data?.messages)) {
    return body.data.messages;
  }
  return [];
}

function normalizeMessage(item) {
  const messageId = item.message_id ?? item.messageId ?? item.id;
  const createdAt = item.create_time ?? item.createdAt;
  const senderId = item.sender?.id ?? item.sender_id ?? item.senderId;
  const messageType = item.msg_type ?? item.message_type ?? item.messageType;
  const text = decodeMessageText(messageType, item.body?.content ?? item.content);
  if (!messageId || !createdAt || !senderId || !messageType) {
    return undefined;
  }
  const senderName = item.sender?.name ?? item.sender?.localized_name ?? item.sender?.display_name ?? item.sender_name ?? item.senderName ?? "";
  const messagePosition = item.message_position ?? item.messagePosition;
  return {
    messageId,
    createdAt,
    ...(messagePosition !== undefined ? { messagePosition } : {}),
    senderId,
    ...(senderName ? { senderName } : {}),
    messageType,
    text
  };
}

function decodeMessageText(messageType, content) {
  const text = decodeText(content);
  if (messageType === "file") {
    const fileName = extractXmlAttribute(text, "name");
    return fileName ? `[文件] ${fileName}` : "[文件]";
  }
  if (messageType === "image") {
    return "[图片]";
  }
  return text;
}

function decodeText(content) {
  if (content === undefined || content === null) {
    return "";
  }
  if (typeof content !== "string") {
    return String(content);
  }
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch {
    // lark-cli may already return human-readable text for some paths.
  }
  return content;
}

function extractXmlAttribute(value, name) {
  const match = String(value ?? "").match(new RegExp(`${name}="([^"]+)"`));
  return match?.[1] ?? "";
}

async function runExecFile(file, args) {
  return execFileAsync(file, args, {
    maxBuffer: 1024 * 1024
  });
}
