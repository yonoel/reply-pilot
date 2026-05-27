import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.js";
import { loadProjectConfig } from "../src/config/project-config.js";
import { SqliteApprovalStore } from "../src/workflow/sqlite-approval-store.js";
import { STATUS } from "../src/workflow/status.js";

test("CLI configures lark app, owner, listeners, and hermes channel in project config", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const output = [];
  try {
    const deps = {
      cwd,
      stdout: (line) => output.push(line)
    };

    assert.equal((await runCli(["config", "init"], deps)).exitCode, 0);
    assert.equal(
      (await runCli(["lark", "app", "set", "--app-id", "cli_app", "--app-secret", "secret_1"], deps)).exitCode,
      0
    );
    assert.equal((await runCli(["lark", "user", "set", "--open-id", "ou-me"], deps)).exitCode, 0);
    assert.equal(
      (await runCli(["lark", "listeners", "add", "--open-id", "ou-target", "--alias", "张三"], deps)).exitCode,
      0
    );
    assert.equal(
      (
        await runCli(
          ["channels", "set", "hermes", "--command", "hermes-dev", "--model", "gpt-5", "--provider", "openai"],
          deps
        )
      ).exitCode,
      0
    );

    const config = loadProjectConfig({ cwd });
    assert.equal(config.lark.app.appId, "cli_app");
    assert.equal(config.lark.app.appSecret, "secret_1");
    assert.equal(config.lark.owner.openId, "ou-me");
    assert.deepEqual(config.lark.listeners, [{ openId: "ou-target", alias: "张三" }]);
    assert.deepEqual(config.channel.hermes, {
      command: "hermes-dev",
      model: "gpt-5",
      provider: "openai",
      timeoutSeconds: 90
    });

    await runCli(["config", "show"], deps);
    assert.match(output.at(-1), /"appSecret": "\*\*\*"/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI configures ollama channel in project config", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  try {
    const deps = {
      cwd,
      stdout() {}
    };

    assert.equal((await runCli(["config", "init"], deps)).exitCode, 0);
    assert.equal(
      (await runCli(["channels", "set", "ollama", "--command", "ollama-dev", "--model", "llama3.2"], deps)).exitCode,
      0
    );

    const config = loadProjectConfig({ cwd });
    assert.deepEqual(config.channel, {
      type: "ollama",
      ollama: {
        command: "ollama-dev",
        model: "llama3.2",
        timeoutSeconds: 90
      }
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI lists and removes lark listeners", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const output = [];
  try {
    const deps = { cwd, stdout: (line) => output.push(line) };
    await runCli(["config", "init"], deps);
    await runCli(["lark", "listeners", "add", "--open-id", "ou-target", "--alias", "张三"], deps);

    await runCli(["lark", "listeners", "list"], deps);
    assert.match(output.at(-1), /ou-target\s+张三/);

    await runCli(["lark", "listeners", "remove", "--open-id", "ou-target"], deps);
    await runCli(["lark", "listeners", "list"], deps);
    assert.match(output.at(-1), /no listeners configured/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI listeners list resolves user and chat display names", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const output = [];
  try {
    const deps = {
      cwd,
      stdout: (line) => output.push(line),
      async runCommand(file, args) {
        assert.equal(file, "lark-cli");
        if (args[0] === "contact") {
          return {
            stdout: JSON.stringify({
              data: {
                users: [
                  {
                    open_id: "ou-target",
                    localized_name: "张三"
                  }
                ]
              }
            })
          };
        }
        if (args[0] === "im" && args[1] === "chats") {
          return {
            stdout: JSON.stringify({
              code: 0,
              data: {
                chat_mode: "p2p",
                name: "",
                i18n_names: {
                  zh_cn: ""
                }
              }
            })
          };
        }
        if (args[0] === "im" && args[1] === "+chat-messages-list") {
          return {
            stdout: JSON.stringify({
              ok: true,
              data: {
                messages: [
                  {
                    message_id: "om-1",
                    create_time: "2026-05-27 16:07",
                    msg_type: "text",
                    content: "hello",
                    sender: {
                      id: "ou-other",
                      name: "李四"
                    }
                  }
                ]
              }
            })
          };
        }
        throw new Error(`unexpected command: ${args.join(" ")}`);
      }
    };

    await runCli(["config", "init"], deps);
    await runCli(["lark", "user", "set", "--open-id", "ou-me"], deps);
    await runCli(["lark", "listeners", "add", "--open-id", "ou-target"], deps);
    await runCli(["lark", "listeners", "add", "--open-id", "oc-chat", "--alias", "watch-chat"], deps);

    await runCli(["lark", "listeners", "list"], deps);

    assert.match(output.at(-1), /user\s+ou-target\s+张三/);
    assert.match(output.at(-1), /chat\s+oc-chat\s+李四\s+alias=watch-chat/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI poll-once loads config and runs one personal watch poll", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const output = [];
  const created = [];
  try {
    const deps = {
      cwd,
      stdout: (line) => output.push(line),
      createPersonalWatchService({ config }) {
        created.push(config);
        return {
          async pollOnce() {
            return { processed: 2 };
          }
        };
      }
    };

    await runCli(["config", "init"], deps);
    await runCli(["lark", "app", "set", "--app-id", "cli_app", "--app-secret", "secret_1"], deps);
    await runCli(["lark", "user", "set", "--open-id", "ou-me"], deps);
    await runCli(["lark", "listeners", "add", "--open-id", "ou-target"], deps);

    const result = await runCli(["poll-once"], deps);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(created[0].targetListeners, [{ openId: "ou-target", alias: "" }]);
    assert.equal(created[0].selfUserId, "ou-me");
    assert.match(output.at(-1), /processed=2/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI watch reports missing runtime config before starting", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const errors = [];
  try {
    const deps = { cwd, stderr: (line) => errors.push(line) };
    await runCli(["config", "init"], deps);

    const result = await runCli(["watch"], deps);

    assert.equal(result.exitCode, 1);
    assert.match(errors.at(-1), /missing config: lark.app.appId/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI auth-check runs lark dry-run commands and hermes help check", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const calls = [];
  try {
    const deps = {
      cwd,
      async runCommand(file, args) {
        calls.push({ file, args });
        return { stdout: "{}" };
      }
    };
    await runCli(["config", "init"], deps);
    await runCli(["lark", "app", "set", "--app-id", "cli_app", "--app-secret", "secret_1"], deps);
    await runCli(["lark", "user", "set", "--open-id", "ou-me"], deps);
    await runCli(["lark", "listeners", "add", "--open-id", "ou-target"], deps);

    const result = await runCli(["auth-check"], deps);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls.map((call) => [call.file, call.args.slice(0, 3)]), [
      ["hermes", ["--help"]],
      ["lark-cli", ["im", "+chat-messages-list", "--as"]],
      ["lark-cli", ["im", "+messages-send", "--as"]],
      ["lark-cli", ["im", "+messages-reply", "--as"]]
    ]);
    assert.ok(calls[1].args.includes("--dry-run"));
    assert.ok(calls[2].args.includes("--dry-run"));
    assert.ok(calls[3].args.includes("--dry-run"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI auth-check checks ollama command and selected model", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const calls = [];
  try {
    const deps = {
      cwd,
      async runCommand(file, args) {
        calls.push({ file, args });
        return { stdout: "{}" };
      }
    };
    await runCli(["config", "init"], deps);
    await runCli(["lark", "app", "set", "--app-id", "cli_app", "--app-secret", "secret_1"], deps);
    await runCli(["lark", "user", "set", "--open-id", "ou-me"], deps);
    await runCli(["lark", "listeners", "add", "--open-id", "ou-target"], deps);
    await runCli(["channels", "set", "ollama", "--model", "llama3.2"], deps);

    const result = await runCli(["auth-check"], deps);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls.map((call) => [call.file, call.args.slice(0, 3)]), [
      ["ollama", ["--help"]],
      ["ollama", ["show", "llama3.2"]],
      ["lark-cli", ["im", "+chat-messages-list", "--as"]],
      ["lark-cli", ["im", "+messages-send", "--as"]],
      ["lark-cli", ["im", "+messages-reply", "--as"]]
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI auth-check uses chat-id dry-run for oc listeners", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const calls = [];
  try {
    const deps = {
      cwd,
      async runCommand(file, args) {
        calls.push({ file, args });
        return { stdout: "{}" };
      }
    };
    await runCli(["config", "init"], deps);
    await runCli(["lark", "app", "set", "--app-id", "cli_app", "--app-secret", "secret_1"], deps);
    await runCli(["lark", "user", "set", "--open-id", "ou-me"], deps);
    await runCli(["lark", "listeners", "add", "--open-id", "oc_chat"], deps);

    const result = await runCli(["auth-check"], deps);

    assert.equal(result.exitCode, 0);
    assert.ok(calls[1].args.includes("--chat-id"));
    assert.ok(calls[1].args.includes("oc_chat"));
    assert.ok(!calls[1].args.includes("--user-id"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI logs list and show read requests and execution logs from sqlite state", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const output = [];
  try {
    const deps = { cwd, stdout: (line) => output.push(line) };
    await runCli(["config", "init"], deps);
    const config = loadProjectConfig({ cwd });
    const store = new SqliteApprovalStore(join(cwd, config.storage.sqlitePath));
    store.create({
      id: "req-1",
      eventId: "evt-1",
      messageId: "om-source",
      chatId: "ou-target",
      senderId: "ou-target",
      text: "原消息",
      status: STATUS.PENDING_APPROVAL,
      draftText: "建议回复"
    });
    store.log("req-1", "sent", { messageId: "om-reply" });

    await runCli(["logs", "list", "--limit", "5"], deps);
    assert.match(output.at(-1), /req-1/);
    assert.match(output.at(-1), /sent/);

    await runCli(["logs", "show", "--request-id", "req-1"], deps);
    assert.match(output.at(-1), /"text": "原消息"/);
    assert.match(output.at(-1), /"draftText": "建议回复"/);
    assert.match(output.at(-1), /"event": "sent"/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
