import assert from "node:assert/strict";
import test from "node:test";

import { HermesLocalChannel } from "../src/agent/channels/hermes-local-channel.js";

test("HermesLocalChannel calls hermes -z with a drafting prompt", async () => {
  const calls = [];
  const channel = new HermesLocalChannel({
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
  assert.equal(calls[0].file, "hermes");
  assert.equal(calls[0].args[0], "-z");
  assert.match(calls[0].args[1], /You are my Lark message reply copilot/);
  assert.match(calls[0].args[1], /这个方案明天能看一下吗/);
  assert.match(calls[0].args[1], /Output only the reply body/);
});

test("HermesLocalChannel renders configured prompt template with context", async () => {
  const calls = [];
  const channel = new HermesLocalChannel({
    promptTemplate: [
      "角色：{{persona}}",
      "上下文：",
      "{{context}}",
      "当前：{{currentMessage}}",
      "会话：{{chatId}}"
    ].join("\n"),
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

  assert.match(calls[0].args[1], /角色：我是项目负责人/);
  assert.match(calls[0].args[1], /Me: 我晚点看/);
  assert.match(calls[0].args[1], /Them: 你看看这个/);
  assert.match(calls[0].args[1], /当前：明天能不能定/);
});


test("HermesLocalChannel appends model and provider flags", async () => {
  const calls = [];
  const channel = new HermesLocalChannel({
    command: "hermes-dev",
    model: "gpt-5",
    provider: "openai",
    async runCommand(file, args) {
      calls.push({ file, args });
      return { stdout: "好的" };
    }
  });

  await channel.send({
    input: "ping",
    conversation: {},
    metadata: {}
  });

  assert.equal(calls[0].file, "hermes-dev");
  assert.equal(calls[0].args.at(-4), "--model");
  assert.equal(calls[0].args.at(-3), "gpt-5");
  assert.equal(calls[0].args.at(-2), "--provider");
  assert.equal(calls[0].args.at(-1), "openai");
});

test("HermesLocalChannel reports empty stdout and command failures clearly", async () => {
  await assert.rejects(
    () =>
      new HermesLocalChannel({
        async runCommand() {
          return { stdout: "  \n" };
        }
      }).send({ input: "ping", conversation: {}, metadata: {} }),
    /hermes local channel returned empty output/
  );

  await assert.rejects(
    () =>
      new HermesLocalChannel({
        async runCommand() {
          throw new Error("spawn failed");
        }
      }).send({ input: "ping", conversation: {}, metadata: {} }),
    /hermes local channel failed: spawn failed/
  );
});

test("HermesLocalChannel times out when local hermes hangs", async () => {
  const channel = new HermesLocalChannel({
    timeoutSeconds: 0.01,
    async runCommand() {
      return new Promise(() => {});
    }
  });

  await assert.rejects(
    () => channel.send({ input: "ping", conversation: {}, metadata: {} }),
    /hermes local channel timed out after 0.01s/
  );
});
