import { spawn } from "node:child_process";

export function parseLarkCliMessageEvent(event) {
  const messageType = required(event.message_type, "message_type");
  if (messageType !== "text") {
    throw new Error(`unsupported lark message type: ${messageType}`);
  }

  return {
    eventId: required(event.event_id, "event_id"),
    createdAt: event.timestamp ?? event.create_time,
    senderId: required(event.sender_id, "sender_id"),
    chatId: required(event.chat_id, "chat_id"),
    messageId: required(event.message_id ?? event.id, "message_id"),
    text: required(event.content, "content").trim()
  };
}

export class LarkCliEventSource {
  /**
   * @param {{
   *   eventKey?: string,
   *   identity?: string,
   *   spawnCommand?: (file: string, args: string[]) => any,
   *   onMessage?: (message: object) => Promise<any> | any
   * }} [config]
   */
  constructor({
    eventKey = "im.message.receive_v1",
    identity = "bot",
    spawnCommand = spawn,
    onMessage
  } = {}) {
    this.eventKey = eventKey;
    this.identity = identity;
    this.spawnCommand = spawnCommand;
    this.onMessage = onMessage;
    this.child = undefined;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
  }

  start() {
    if (!this.onMessage) {
      throw new Error("lark cli event source requires onMessage");
    }

    const args = ["event", "consume", this.eventKey, "--as", this.identity];
    this.child = this.spawnCommand("lark-cli", args);
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");

    this.child.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk;
      this.drainStdout();
    });

    return new Promise((resolve, reject) => {
      const onReadyData = (chunk) => {
        this.stderrBuffer += chunk;
        const lines = this.stderrBuffer.split(/\r?\n/);
        this.stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.includes(`[event] ready event_key=${this.eventKey}`)) {
            this.child.stderr.off("data", onReadyData);
            resolve();
            return;
          }
        }
      };

      this.child.stderr.on("data", onReadyData);
      this.child.on("error", reject);
      this.child.on("exit", (code) => {
        if (code && code !== 0) {
          reject(new Error(`lark cli event source exited before ready: ${code}`));
        }
      });
    });
  }

  stop() {
    if (!this.child) {
      return;
    }
    this.child.stdin.end();
    this.child.kill("SIGTERM");
  }

  drainStdout() {
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let message;
      try {
        const event = JSON.parse(line);
        message = parseLarkCliMessageEvent(event);
      } catch (error) {
        console.warn(`lark cli event skipped: ${error.message}`);
        continue;
      }
      Promise.resolve(this.onMessage(message)).catch((error) => {
        console.error(`lark cli event handler failed: ${error.message}`);
      });
    }
  }
}

function required(value, path) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`missing lark cli event field: ${path}`);
  }
  return value;
}
