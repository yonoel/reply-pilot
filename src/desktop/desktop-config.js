import crypto from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_DIR = ".reply-pilot";
const DESKTOP_CONFIG_FILE = "desktop.json";

export function defaultDesktopConfig() {
  return {
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
    apiPort: 3017,
    apiToken: "",
    fallbackLarkBot: true,
    approval: {
      instructionMode: "rules",
      allowDirectSendByInstruction: true
    }
  };
}

export function desktopConfigPath({ cwd = process.cwd() } = {}) {
  return join(cwd, CONFIG_DIR, DESKTOP_CONFIG_FILE);
}

export function loadDesktopConfig({ cwd = process.cwd() } = {}) {
  const path = desktopConfigPath({ cwd });
  if (!existsSync(path)) {
    return defaultDesktopConfig();
  }
  try {
    return mergeDesktopConfig(defaultDesktopConfig(), JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return defaultDesktopConfig();
  }
}

export function saveDesktopConfig(config, { cwd = process.cwd() } = {}) {
  const path = desktopConfigPath({ cwd });
  mkdirSync(join(cwd, CONFIG_DIR), { recursive: true });
  const normalized = mergeDesktopConfig(defaultDesktopConfig(), config);
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return normalized;
}

export function ensureDesktopApiToken({ cwd = process.cwd() } = {}) {
  const config = loadDesktopConfig({ cwd });
  if (config.apiToken) {
    return config.apiToken;
  }
  const token = `rp_${crypto.randomBytes(32).toString("base64url")}`;
  saveDesktopConfig(
    {
      ...config,
      apiToken: token
    },
    { cwd }
  );
  return token;
}

export function publicDesktopConfig(config) {
  const { apiToken, ...publicConfig } = config ?? {};
  return publicConfig;
}

function mergeDesktopConfig(base, override = {}) {
  return {
    ...base,
    ...override,
    position: {
      ...base.position,
      ...(override.position ?? {})
    },
    approval: {
      ...base.approval,
      ...(override.approval ?? {})
    }
  };
}
