import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addListener,
  createDefaultProjectConfig,
  initProjectConfig,
  loadProjectConfig,
  projectConfigPaths,
  redactProjectConfig,
  removeListener,
  setHermesChannel,
  setLarkApp,
  setOllamaChannel,
  setOwnerUser,
  validateRuntimeConfig
} from "../src/config/project-config.js";

test("initProjectConfig creates project local config with default watch and hermes settings", () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-config-"));
  try {
    const config = initProjectConfig({ cwd });
    const paths = projectConfigPaths(cwd);
    const saved = JSON.parse(readFileSync(paths.configPath, "utf8"));

    assert.equal(paths.statePath, join(cwd, ".reply-pilot", "state.sqlite"));
    assert.equal(paths.promptPath, join(cwd, "prompt.md"));
    assert.deepEqual(saved, config);
    assert.equal(config.watch.pollIntervalSeconds, 30);
    assert.equal(config.watch.lookbackMinutes, 10);
    assert.equal(config.context.lookbackMessages, 20);
    assert.equal(config.context.lookbackMinutes, 120);
    assert.equal(config.context.maxChars, 6000);
    assert.equal(config.context.quietWindowSeconds, 10);
    assert.equal(config.prompt.path, "prompt.md");
    assert.match(readFileSync(paths.promptPath, "utf8"), /imitate how I would reply/);
    assert.equal(config.channel.type, "hermes");
    assert.equal(config.channel.hermes.command, "hermes");
    assert.deepEqual(config.lark.listeners, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("loadProjectConfig normalizes the old hidden prompt path to project prompt.md", () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-config-"));
  try {
    const config = initProjectConfig({ cwd });
    const paths = projectConfigPaths(cwd);
    writeFileSync(
      paths.configPath,
      `${JSON.stringify(
        {
          ...config,
          prompt: {
            ...config.prompt,
            path: ".reply-pilot/prompt.md"
          }
        },
        null,
        2
      )}\n`
    );

    assert.equal(loadProjectConfig({ cwd }).prompt.path, "prompt.md");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("initProjectConfig migrates old hidden prompt content to project prompt.md", () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-config-"));
  try {
    const paths = projectConfigPaths(cwd);
    mkdirSync(paths.dir, { recursive: true });
    const oldConfig = {
      ...createDefaultProjectConfig(),
      prompt: {
        path: ".reply-pilot/prompt.md",
        persona: ""
      }
    };
    writeFileSync(paths.configPath, `${JSON.stringify(oldConfig, null, 2)}\n`);
    writeFileSync(join(paths.dir, "prompt.md"), "custom old prompt");

    const config = initProjectConfig({ cwd });

    assert.equal(config.prompt.path, "prompt.md");
    assert.equal(readFileSync(paths.promptPath, "utf8"), "custom old prompt");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("project config setters maintain lark app, owner user, listeners, and hermes command", () => {
  let config = createDefaultProjectConfig();

  config = setLarkApp(config, {
    appId: "cli_app",
    appSecret: "secret_1"
  });
  config = setOwnerUser(config, {
    openId: "ou-me"
  });
  config = addListener(config, {
    openId: "ou-target",
    alias: "张三"
  });
  config = addListener(config, {
    openId: "ou-target",
    alias: "张三更新"
  });
  config = setHermesChannel(config, {
    command: "hermes-dev",
    model: "gpt-5",
    provider: "openai"
  });

  assert.deepEqual(config.lark.app, {
    appId: "cli_app",
    appSecret: "secret_1"
  });
  assert.deepEqual(config.lark.owner, {
    openId: "ou-me"
  });
  assert.deepEqual(config.lark.listeners, [
    {
      openId: "ou-target",
      alias: "张三更新"
    }
  ]);
  assert.deepEqual(config.channel, {
    type: "hermes",
    hermes: {
      command: "hermes-dev",
      model: "gpt-5",
      provider: "openai",
      timeoutSeconds: 90
    }
  });

  const removed = removeListener(config, {
    openId: "ou-target"
  });
  assert.deepEqual(removed.lark.listeners, []);
});

test("project config supports ollama channel runtime settings", () => {
  let config = createDefaultProjectConfig();
  config = setLarkApp(config, {
    appId: "cli_app",
    appSecret: "secret_1"
  });
  config = setOwnerUser(config, {
    openId: "ou-me"
  });
  config = addListener(config, {
    openId: "ou-target"
  });
  config = setOllamaChannel(config, {
    command: "ollama-dev",
    model: "llama3.2"
  });

  assert.deepEqual(config.channel, {
    type: "ollama",
    ollama: {
      command: "ollama-dev",
      model: "llama3.2",
      timeoutSeconds: 90
    }
  });
  assert.doesNotThrow(() => validateRuntimeConfig(config));
});

test("addListener stores oc identifiers as chat listeners", () => {
  const config = addListener(createDefaultProjectConfig(), {
    openId: "oc_chat",
    alias: "项目群"
  });

  assert.deepEqual(config.lark.listeners, [
    {
      chatId: "oc_chat",
      alias: "项目群"
    }
  ]);
});

test("redactProjectConfig masks secrets for config show", () => {
  const config = setLarkApp(createDefaultProjectConfig(), {
    appId: "cli_app",
    appSecret: "secret_1"
  });

  assert.equal(redactProjectConfig(config).lark.app.appId, "cli_app");
  assert.equal(redactProjectConfig(config).lark.app.appSecret, "***");
});

test("validateRuntimeConfig reports missing required runtime config", () => {
  assert.throws(
    () => validateRuntimeConfig(createDefaultProjectConfig()),
    /missing config: lark.app.appId, lark.app.appSecret, lark.owner.openId, lark.listeners/
  );
  assert.throws(
    () =>
      validateRuntimeConfig({
        ...setLarkApp(setOwnerUser(addListener(createDefaultProjectConfig(), { openId: "ou-target" }), { openId: "ou-me" }), {
          appId: "cli_app",
          appSecret: "secret_1"
        }),
        channel: {
          type: "hermes",
          hermes: {
            command: ""
          }
        }
      }),
    /missing config: channel.hermes.command/
  );
  assert.throws(
    () =>
      validateRuntimeConfig({
        ...setLarkApp(setOwnerUser(addListener(createDefaultProjectConfig(), { openId: "ou-target" }), { openId: "ou-me" }), {
          appId: "cli_app",
          appSecret: "secret_1"
        }),
        channel: {
          type: "ollama",
          ollama: {
            command: "ollama",
            model: ""
          }
        }
      }),
    /missing config: channel.ollama.model/
  );
});
