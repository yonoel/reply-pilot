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
