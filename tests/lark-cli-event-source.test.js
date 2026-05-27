import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import test from "node:test";

import {
  LarkCliEventSource,
  parseLarkCliMessageEvent
} from "../src/lark/lark-cli-event-source.js";

test("parseLarkCliMessageEvent maps lark-cli flattened receive events to bridge messages", () => {
  const message = parseLarkCliMessageEvent({
    event_id: "evt-1",
    timestamp: "1779791111000",
    sender_id: "ou-user",
    chat_id: "oc-chat",
    message_id: "om-msg",
    message_type: "text",
    content: "@Hermes hello"
  });

  assert.deepEqual(message, {
    eventId: "evt-1",
    createdAt: "1779791111000",
    senderId: "ou-user",
    chatId: "oc-chat",
    messageId: "om-msg",
    text: "@Hermes hello"
  });
});

test("parseLarkCliMessageEvent rejects non-text flattened events", () => {
  assert.throws(
    () =>
      parseLarkCliMessageEvent({
        event_id: "evt-1",
        sender_id: "ou-user",
        chat_id: "oc-chat",
        message_id: "om-msg",
        message_type: "image",
        content: "[image]"
      }),
    /unsupported lark message type: image/
  );
});

test("LarkCliEventSource consumes NDJSON events after ready marker", async () => {
  const spawned = [];
  const child = fakeChildProcess();
  const messages = [];
  const source = new LarkCliEventSource({
    identity: "bot",
    spawnCommand(file, args) {
      spawned.push({ file, args });
      return child;
    },
    async onMessage(message) {
      messages.push(message);
    }
  });

  const ready = source.start();
  child.stderr.write("[event] ready event_key=im.message.receive_v1\n");
  await ready;
  child.stdout.write(
    `${JSON.stringify({
      event_id: "evt-1",
      sender_id: "ou-user",
      chat_id: "oc-chat",
      message_id: "om-msg",
      message_type: "text",
      content: "@Hermes hello"
    })}\n`
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(spawned, [
    {
      file: "lark-cli",
      args: ["event", "consume", "im.message.receive_v1", "--as", "bot"]
    }
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "@Hermes hello");
});

function fakeChildProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  return child;
}
