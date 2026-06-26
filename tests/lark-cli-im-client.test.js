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

test("LarkCliImClient normalizes file messages into readable text", async () => {
  const client = new LarkCliImClient({
    async runCommand() {
      return {
        stdout: JSON.stringify({
          items: [
            {
              message_id: "om-file",
              create_time: "2026-06-25 16:25",
              msg_type: "file",
              content: '<file key="file-key" name="demo.zip"/>',
              sender: {
                id: "ou-target",
                sender_type: "user",
                name: "温浩"
              }
            }
          ]
        })
      };
    }
  });

  const messages = await client.listP2pMessages({
    chatId: "oc-chat",
    start: "2026-06-25T16:00:00+08:00",
    end: "2026-06-25T16:30:00+08:00"
  });

  assert.equal(messages[0].messageType, "file");
  assert.equal(messages[0].text, "[文件] demo.zip");
});

test("LarkCliImClient normalizes image messages into readable text", async () => {
  const client = new LarkCliImClient({
    async runCommand() {
      return {
        stdout: JSON.stringify({
          items: [
            {
              message_id: "om-image",
              create_time: "2026-06-26 11:10",
              msg_type: "image",
              content: "[Image: img_v3_02131_59ffeb0d-9e29-49a1-b2ab-797b58fabd2g]",
              sender: {
                id: "ou-target",
                sender_type: "user",
                name: "陈钢"
              }
            }
          ]
        })
      };
    }
  });

  const messages = await client.listP2pMessages({
    chatId: "oc-chat",
    start: "2026-06-26T11:00:00+08:00",
    end: "2026-06-26T11:30:00+08:00"
  });

  assert.equal(messages[0].messageType, "image");
  assert.equal(messages[0].text, "[图片]");
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
