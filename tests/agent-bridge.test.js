import assert from "node:assert/strict";
import test from "node:test";

import { createAgentBridge } from "../src/agent/agent-bridge.js";

test("agent bridge sends lark text through the configured generic channel", async () => {
  const requests = [];
  const bridge = createAgentBridge({
    channel: {
      name: "codex",
      async send(request) {
        requests.push(request);
        return {
          text: `reply from ${this.name}: ${request.input}`
        };
      }
    }
  });

  const response = await bridge.handleLarkMessage({
    eventId: "evt-1",
    senderId: "ou-user",
    chatId: "oc-chat",
    messageId: "om-msg",
    text: "status?"
  });

  assert.equal(response.text, "reply from codex: status?");
  assert.equal(response.channel, "codex");
  assert.deepEqual(requests, [
    {
      input: "status?",
      conversation: {
        platform: "lark",
        chatId: "oc-chat",
        messageId: "om-msg",
        senderId: "ou-user"
      },
      metadata: {
        eventId: "evt-1"
      }
    }
  ]);
});

test("agent bridge sends lark context through a summary task", async () => {
  const requests = [];
  const bridge = createAgentBridge({
    channel: {
      name: "codex",
      async send(request) {
        requests.push(request);
        return {
          text: "对方先催进展，又补充说明希望明天前确认。"
        };
      }
    }
  });

  const response = await bridge.handleLarkContextSummary({
    eventId: "evt-1",
    senderId: "ou-user",
    selfUserId: "ou-me",
    chatId: "oc-chat",
    messageId: "om-msg",
    text: "明天能不能定",
    contextMessages: [
      { senderId: "ou-me", text: "我晚点看", messageId: "om-self" },
      { senderId: "ou-user", text: "你看看这个", messageId: "om-before" }
    ],
    contextMaxChars: 1000
  });

  assert.equal(response.text, "对方先催进展，又补充说明希望明天前确认。");
  assert.equal(response.channel, "codex");
  assert.deepEqual(requests, [
    {
      task: "context-summary",
      input: "明天能不能定",
      contextMessages: [
        { senderId: "ou-me", text: "我晚点看", messageId: "om-self" },
        { senderId: "ou-user", text: "你看看这个", messageId: "om-before" }
      ],
      contextMaxChars: 1000,
      conversation: {
        platform: "lark",
        chatId: "oc-chat",
        messageId: "om-msg",
        senderId: "ou-user",
        selfUserId: "ou-me"
      },
      metadata: {
        eventId: "evt-1"
      }
    }
  ]);
});
