import assert from "node:assert/strict";
import test from "node:test";

import { OllamaLocalChannel } from "../src/agent/channels/ollama-local-channel.js";

test("OllamaLocalChannel calls ollama run with a drafting prompt", async () => {
  const calls = [];
  const channel = new OllamaLocalChannel({
    model: "llama3.2",
    async runCommand(file, args) {
      calls.push({ file, args });
      return { stdout: " 可以，明天上午我看一下。 \n" };
    }
  });

  const response = await channel.send({
    input: "这个方案明天能看一下吗",
    conversation: {
      platform: "lark",
      chatId: "ou-target",
      messageId: "om-1",
      senderId: "ou-target"
    },
    metadata: {
      eventId: "req-1"
    }
  });

  assert.equal(response.text, "可以，明天上午我看一下。");
  assert.equal(calls[0].file, "ollama");
  assert.deepEqual(calls[0].args.slice(0, 2), ["run", "llama3.2"]);
  assert.match(calls[0].args[2], /You are my Lark message reply copilot/);
  assert.match(calls[0].args[2], /这个方案明天能看一下吗/);
  assert.match(calls[0].args[2], /Output only the reply body/);
});

test("OllamaLocalChannel renders configured prompt template with context", async () => {
  const calls = [];
  const channel = new OllamaLocalChannel({
    model: "llama3.2",
    promptTemplate: ["角色：{{persona}}", "上下文：", "{{context}}", "当前：{{currentMessage}}", "会话：{{chatId}}"].join("\n"),
    persona: "我是项目负责人，回复克制直接。",
    async runCommand(file, args) {
      calls.push({ file, args });
      return { stdout: "收到，我来定。" };
    }
  });

  await channel.send({
    input: "明天能不能定",
    contextMessages: [
      { senderId: "ou-me", text: "我晚点看", messageId: "om-self" },
      { senderId: "ou-target", text: "你看看这个", messageId: "om-1" }
    ],
    conversation: {
      chatId: "oc-chat",
      messageId: "om-2",
      senderId: "ou-target",
      selfUserId: "ou-me"
    },
    metadata: {
      eventId: "req-1"
    }
  });

  assert.match(calls[0].args[2], /角色：我是项目负责人/);
  assert.match(calls[0].args[2], /Me: 我晚点看/);
  assert.match(calls[0].args[2], /Them: 你看看这个/);
  assert.match(calls[0].args[2], /当前：明天能不能定/);
});

test("OllamaLocalChannel requires a model", () => {
  assert.throws(() => new OllamaLocalChannel(), /ollama local channel requires model/);
});

test("OllamaLocalChannel reports empty stdout and command failures clearly", async () => {
  await assert.rejects(
    () =>
      new OllamaLocalChannel({
        model: "llama3.2",
        async runCommand() {
          return { stdout: "  \n" };
        }
      }).send({ input: "ping", conversation: {}, metadata: {} }),
    /ollama local channel returned empty output/
  );

  await assert.rejects(
    () =>
      new OllamaLocalChannel({
        model: "llama3.2",
        async runCommand() {
          throw new Error("spawn failed");
        }
      }).send({ input: "ping", conversation: {}, metadata: {} }),
    /ollama local channel failed: spawn failed/
  );
});

test("OllamaLocalChannel times out when local ollama hangs", async () => {
  const channel = new OllamaLocalChannel({
    model: "llama3.2",
    timeoutSeconds: 0.01,
    async runCommand() {
      return new Promise(() => {});
    }
  });

  await assert.rejects(
    () => channel.send({ input: "ping", conversation: {}, metadata: {} }),
    /ollama local channel timed out after 0.01s/
  );
});
