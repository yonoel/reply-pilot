import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SqliteApprovalStore } from "../workflow/sqlite-approval-store.js";

const CONFIG_DIR = ".reply-pilot";
const CONFIG_FILE = "config.json";
const STATE_FILE = "state.sqlite";
const PROMPT_FILE = "prompt.md";
const DEFAULT_PROMPT = `You are my Lark message reply copilot.
Your job is not to improvise freely. Your job is to imitate how I would reply.

My background and style:
{{persona}}

Reply requirements:
- Infer the other person's real intent from the context.
- Keep the tone natural, restrained, and close to how I write.
- Do not explain your reasoning.
- Do not output multiple options.
- Output exactly one reply body that can be sent directly.

Conversation context:
{{context}}

Current message to reply to:
{{currentMessage}}
`;

export function projectConfigPaths(cwd = process.cwd()) {
  const dir = join(cwd, CONFIG_DIR);
  return {
    dir,
    configPath: join(dir, CONFIG_FILE),
    statePath: join(dir, STATE_FILE),
    promptPath: join(cwd, PROMPT_FILE)
  };
}

export function createDefaultProjectConfig() {
  return {
    storage: {
      sqlitePath: join(CONFIG_DIR, STATE_FILE)
    },
    desktop: {
      enabled: true,
      theme: "pixel",
      position: {
        mode: "free",
        x: 1320,
        y: 820,
        corner: "bottom-right"
      },
      alwaysOnTop: true,
      scale: 1,
      doNotDisturb: false,
      showSystemNotification: true,
      apiPort: 3017
    },
    approval: {
      primarySurface: "desktop-pet",
      fallbackLarkBot: true,
      instructionMode: "rules",
      allowDirectSendByInstruction: true
    },
    watch: {
      pollIntervalSeconds: 30,
      lookbackMinutes: 10,
      notifyAs: "bot",
      replyAs: "user"
    },
    context: {
      lookbackMessages: 20,
      lookbackMinutes: 120,
      maxChars: 6000,
      quietWindowSeconds: 10
    },
    prompt: {
      path: PROMPT_FILE,
      persona: ""
    },
    lark: {
      app: {
        appId: "",
        appSecret: ""
      },
      owner: {
        openId: ""
      },
      listeners: []
    },
    channel: {
      type: "hermes",
      hermes: {
        command: "hermes",
        model: "",
        provider: "",
        timeoutSeconds: 90
      }
    }
  };
}

export function initProjectConfig({ cwd = process.cwd(), overwrite = false } = {}) {
  const paths = projectConfigPaths(cwd);
  mkdirSync(paths.dir, { recursive: true });
  const config = existsSync(paths.configPath) && !overwrite ? loadProjectConfig({ cwd }) : createDefaultProjectConfig();
  saveProjectConfig(config, { cwd });
  ensurePromptFile(paths, { overwrite });
  const store = new SqliteApprovalStore(paths.statePath);
  store.close();
  return config;
}

export function loadProjectConfig({ cwd = process.cwd() } = {}) {
  const { configPath } = projectConfigPaths(cwd);
  if (!existsSync(configPath)) {
    throw new Error("project config not found; run `npm run cli -- config init` first");
  }
  const saved = JSON.parse(readFileSync(configPath, "utf8"));
  return normalizeProjectConfig(mergeConfig(createDefaultProjectConfig(), saved));
}

export function saveProjectConfig(config, { cwd = process.cwd() } = {}) {
  const { dir, configPath } = projectConfigPaths(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function setLarkApp(config, { appId, appSecret }) {
  return mergeConfig(config, {
    lark: {
      app: {
        appId: requiredOption(appId, "--app-id"),
        appSecret: requiredOption(appSecret, "--app-secret")
      }
    }
  });
}

export function setOwnerUser(config, { openId }) {
  return mergeConfig(config, {
    lark: {
      owner: {
        openId: requiredOption(openId, "--open-id")
      }
    }
  });
}

export function addListener(config, { openId, alias = "" }) {
  const targetOpenId = requiredOption(openId, "--open-id");
  const key = targetOpenId.startsWith("oc_") || targetOpenId.startsWith("oc-") ? "chatId" : "openId";
  const listeners = (config.lark?.listeners ?? []).filter((listener) => listener.openId !== targetOpenId && listener.chatId !== targetOpenId);
  listeners.push(
    key === "chatId"
      ? {
          chatId: targetOpenId,
          alias
        }
      : {
          openId: targetOpenId,
          alias
        }
  );
  return mergeConfig(config, {
    lark: {
      listeners
    }
  });
}

export function removeListener(config, { openId }) {
  const targetOpenId = requiredOption(openId, "--open-id");
  return mergeConfig(config, {
    lark: {
      listeners: (config.lark?.listeners ?? []).filter((listener) => listener.openId !== targetOpenId && listener.chatId !== targetOpenId)
    }
  });
}

export function setHermesChannel(config, { command = "hermes", model = "", provider = "" } = {}) {
  return {
    ...config,
    channel: {
      type: "hermes",
      hermes: {
        command: requiredOption(command, "--command"),
        model,
        provider,
        timeoutSeconds: channelTimeout(config, "hermes")
      }
    }
  };
}

export function setOllamaChannel(config, options = {}) {
  const command = options.command ?? "ollama";
  const model = options.model ?? "";
  const timeoutSeconds = options.timeoutSeconds;
  return {
    ...config,
    channel: {
      type: "ollama",
      ollama: {
        command: requiredOption(command, "--command"),
        model: requiredOption(model, "--model"),
        timeoutSeconds: timeoutSeconds ?? channelTimeout(config, "ollama")
      }
    }
  };
}

export function redactProjectConfig(config) {
  return mergeConfig(config, {
    lark: {
      app: {
        appSecret: config.lark?.app?.appSecret ? "***" : ""
      }
    }
  });
}

export function validateRuntimeConfig(config) {
  const missing = [];
  if (!config.lark?.app?.appId) {
    missing.push("lark.app.appId");
  }
  if (!config.lark?.app?.appSecret) {
    missing.push("lark.app.appSecret");
  }
  if (!config.lark?.owner?.openId) {
    missing.push("lark.owner.openId");
  }
  if (!config.lark?.listeners?.length) {
    missing.push("lark.listeners");
  }
  if (config.channel?.type === "hermes") {
    validateHermesRuntimeConfig(config, missing);
  } else if (config.channel?.type === "ollama") {
    validateOllamaRuntimeConfig(config, missing);
  } else {
    missing.push("channel.type=hermes|ollama");
  }
  if (missing.length) {
    throw new Error(`missing config: ${missing.join(", ")}`);
  }
}

function validateHermesRuntimeConfig(config, missing) {
  if (!config.channel?.hermes?.command) {
    missing.push("channel.hermes.command");
  }
}

function validateOllamaRuntimeConfig(config, missing) {
  if (!config.channel?.ollama?.command) {
    missing.push("channel.ollama.command");
  }
  if (!config.channel?.ollama?.model) {
    missing.push("channel.ollama.model");
  }
}

function requiredOption(value, name) {
  if (!value) {
    throw new Error(`missing required option: ${name}`);
  }
  return value;
}

function ensurePromptFile(paths, { overwrite = false } = {}) {
  if (!overwrite && existsSync(paths.promptPath)) {
    return;
  }
  const legacyPromptPath = join(paths.dir, PROMPT_FILE);
  if (!overwrite && existsSync(legacyPromptPath)) {
    writeFileSync(paths.promptPath, readFileSync(legacyPromptPath, "utf8"));
    return;
  }
  writeFileSync(paths.promptPath, DEFAULT_PROMPT);
}

function channelTimeout(config, type) {
  return config.channel?.[type]?.timeoutSeconds ?? 90;
}

function normalizeProjectConfig(config) {
  const normalizedPrompt = normalizePromptConfig(config.prompt);
  if (config.channel?.type === "hermes") {
    return {
      ...config,
      prompt: normalizedPrompt,
      channel: {
        type: "hermes",
        hermes: mergeConfig(createDefaultProjectConfig().channel.hermes, config.channel.hermes)
      }
    };
  }
  if (config.channel?.type === "ollama") {
    return {
      ...config,
      prompt: normalizedPrompt,
      channel: {
        type: "ollama",
        ollama: mergeConfig(
          {
            command: "ollama",
            model: "",
            timeoutSeconds: 90
          },
          config.channel.ollama
        )
      }
    };
  }
  return config;
}

function normalizePromptConfig(prompt = {}) {
  const path = prompt.path === join(CONFIG_DIR, PROMPT_FILE) ? PROMPT_FILE : prompt.path;
  return mergeConfig(createDefaultProjectConfig().prompt, {
    ...prompt,
    path
  });
}

function mergeConfig(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) {
    return patch ?? base;
  }
  if (!isObject(base) || !isObject(patch)) {
    return patch ?? base;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = mergeConfig(base[key], value);
  }
  return merged;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
