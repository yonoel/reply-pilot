import assert from "node:assert/strict";
import test from "node:test";

import { LarkCliImClient } from "../src/lark/lark-cli-im-client.js";

test("LarkCliImClient lists P2P messages as user for a target open id", async () => {
  const calls = [];
  const client = new LarkCliImClient({
    async runCommand(file, args) {
      calls.push({ file, args });
      return {
        stdout: JSON.stringify({
          items: [
            {
              message_id: "om-1",
              create_time: "1779811200000",
              msg_type: "text",
              body: { content: "{\"text\":\"hello\"}" },
              sender: {
                id: "ou-target",
                sender_type: "user"
              }
            }
          ]
        })
      };
    }
  });

  const messages = await client.listP2pMessages({
    targetUserId: "ou-target",
    start: "2026-05-27T00:00:00+08:00",
    end: "2026-05-27T00:10:00+08:00"
  });

  assert.deepEqual(calls, [
    {
      file: "lark-cli",
      args: [
        "im",
        "+chat-messages-list",
        "--as",
        "user",
        "--user-id",
        "ou-target",
        "--start",
        "2026-05-27T00:00:00+08:00",
        "--end",
        "2026-05-27T00:10:00+08:00",
        "--sort",
        "asc",
        "--page-size",
        "50",
        "--format",
        "json"
      ]
    }
  ]);
  assert.deepEqual(messages, [
    {
      messageId: "om-1",
      createdAt: "1779811200000",
      senderId: "ou-target",
      messageType: "text",
      text: "hello"
    }
  ]);
});

test("LarkCliImClient lists messages by chat id as user", async () => {
  const calls = [];
  const client = new LarkCliImClient({
    async runCommand(file, args) {
      calls.push({ file, args });
      return { stdout: JSON.stringify({ items: [] }) };
    }
  });

  await client.listP2pMessages({
    chatId: "oc-chat",
    start: "2026-05-27T00:00:00+08:00",
    end: "2026-05-27T00:10:00+08:00"
  });

  assert.deepEqual(calls[0].args.slice(0, 7), [
    "im",
    "+chat-messages-list",
    "--as",
    "user",
    "--chat-id",
    "oc-chat",
    "--start"
  ]);
});

test("LarkCliImClient sends bot notification to self", async () => {
  const calls = [];
  const client = new LarkCliImClient({
    async runCommand(file, args) {
      calls.push({ file, args });
      return { stdout: JSON.stringify({ data: { message_id: "om-notify" } }) };
    }
  });

  const result = await client.sendText({
    as: "bot",
    userId: "ou-me",
    text: "建议回复",
    idempotencyKey: "notify-1"
  });

  assert.equal(result.message_id, "om-notify");
  assert.deepEqual(calls[0].args, [
    "im",
    "+messages-send",
    "--as",
    "bot",
    "--user-id",
    "ou-me",
    "--text",
    "建议回复",
    "--idempotency-key",
    "notify-1"
  ]);
});

test("LarkCliImClient sends markdown bot notification to self", async () => {
  const calls = [];
  const client = new LarkCliImClient({
    async runCommand(file, args) {
      calls.push({ file, args });
      return { stdout: JSON.stringify({ data: { message_id: "om-notify" } }) };
    }
  });

  const result = await client.sendMarkdown({
    as: "bot",
    userId: "ou-me",
    markdown: "**建议回复**",
    idempotencyKey: "notify-1"
  });

  assert.equal(result.message_id, "om-notify");
  assert.deepEqual(calls[0].args, [
    "im",
    "+messages-send",
    "--as",
    "bot",
    "--user-id",
    "ou-me",
    "--markdown",
    "**建议回复**",
    "--idempotency-key",
    "notify-1"
  ]);
});


test("LarkCliImClient replies to original message as user", async () => {
  const calls = [];
  const client = new LarkCliImClient({
    async runCommand(file, args) {
      calls.push({ file, args });
      return { stdout: JSON.stringify({ data: { message_id: "om-reply" } }) };
    }
  });

  const result = await client.replyText({
    as: "user",
    messageId: "om-source",
    text: "我这样回复",
    idempotencyKey: "reply-1"
  });

  assert.equal(result.message_id, "om-reply");
  assert.deepEqual(calls[0].args, [
    "im",
    "+messages-reply",
    "--as",
    "user",
    "--message-id",
    "om-source",
    "--text",
    "我这样回复",
    "--idempotency-key",
    "reply-1"
  ]);
});
