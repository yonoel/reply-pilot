import assert from "node:assert/strict";
import test from "node:test";

import { createAgentChannel } from "../src/agent/channel-registry.js";

test("createAgentChannel creates hermes as one selectable channel", () => {
  const channel = createAgentChannel({
    type: "hermes",
    hermes: {
      command: "hermes-dev",
      model: "gpt-5"
    }
  });

  assert.equal(channel.name, "hermes");
  assert.equal(channel.command, "hermes-dev");
});

test("createAgentChannel creates ollama as one selectable channel", () => {
  const channel = createAgentChannel({
    type: "ollama",
    ollama: {
      command: "ollama-dev",
      model: "llama3.2"
    }
  });

  assert.equal(channel.name, "ollama");
  assert.equal(channel.command, "ollama-dev");
  assert.equal(channel.model, "llama3.2");
});

test("createAgentChannel rejects unknown channels without mentioning lark", () => {
  assert.throws(
    () =>
      createAgentChannel({
        type: "claude"
      }),
    /unsupported agent channel: claude/
  );
});

test("createAgentChannel rejects unsupported command channels", () => {
  assert.throws(
    () =>
      createAgentChannel({
        type: "command"
      }),
    /unsupported agent channel: command/
  );
});
