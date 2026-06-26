import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createAgentBridge } from "./agent/agent-bridge.js";
import { createAgentChannel } from "./agent/channel-registry.js";
import { createApprovalController } from "./approval/approval-controller.js";
import { DesktopApprovalSurface } from "./approval/desktop-approval-surface.js";
import { LarkBotApprovalSurface } from "./approval/lark-bot-approval-surface.js";
import {
  addListener,
  initProjectConfig,
  loadProjectConfig,
  redactProjectConfig,
  removeListener,
  saveProjectConfig,
  setHermesChannel,
  setLarkApp,
  setOllamaChannel,
  setOwnerUser,
  validateRuntimeConfig
} from "./config/project-config.js";
import { createDesktopApiServer } from "./desktop/desktop-api-server.js";
import { ensureDesktopApiToken, loadDesktopConfig, saveDesktopConfig } from "./desktop/desktop-config.js";
import { DesktopEventBus } from "./desktop/desktop-event-bus.js";
import { LarkCliEventSource } from "./lark/lark-cli-event-source.js";
import { LarkCliContactClient } from "./lark/lark-cli-contact-client.js";
import { LarkCliImClient } from "./lark/lark-cli-im-client.js";
import { PersonalWatchService } from "./personal-watch/personal-watch-service.js";
import { SqliteApprovalStore } from "./workflow/sqlite-approval-store.js";

const execFileAsync = promisify(execFile);

export async function runCli(argv = process.argv.slice(2), deps = {}) {
  const io = {
    cwd: deps.cwd ?? process.cwd(),
    stdout: deps.stdout ?? console.log,
    stderr: deps.stderr ?? console.error,
    runCommand: deps.runCommand ?? runExecFile,
    createPersonalWatchService: deps.createPersonalWatchService,
    createEventSource: deps.createEventSource
  };

  try {
    const [group] = argv;
    if (!group || group === "help" || group === "--help" || group === "-h") {
      io.stdout(helpText());
      return { exitCode: 0 };
    }

    if (group === "config") {
      return handleConfig(argv[1], argv.slice(2), io);
    }
    if (group === "lark") {
      return await handleLark(argv[1], argv[2], argv.slice(3), io);
    }
    if (group === "channels") {
      return handleChannels(argv[1], argv[2], argv.slice(3), io);
    }
    if (group === "watch") {
      return await handleWatch(io, argv.slice(1));
    }
    if (group === "desktop-api") {
      return await handleDesktopApi(io);
    }
    if (group === "poll-once") {
      return await handlePollOnce(io);
    }
    if (group === "logs") {
      return handleLogs(argv[1], argv.slice(2), io);
    }
    if (group === "auth-check") {
      return await handleAuthCheck(io);
    }

    throw new Error(`unknown command: ${argv.join(" ")}`);
  } catch (error) {
    io.stderr(error.message);
    return { exitCode: 1 };
  }
}

function handleConfig(subcommand, args, io) {
  if (subcommand === "init") {
    initProjectConfig({ cwd: io.cwd, overwrite: args.includes("--force") });
    io.stdout("initialized .reply-pilot/config.json and .reply-pilot/state.sqlite");
    return { exitCode: 0 };
  }
  if (subcommand === "show") {
    io.stdout(JSON.stringify(redactProjectConfig(loadProjectConfig({ cwd: io.cwd })), null, 2));
    return { exitCode: 0 };
  }
  throw new Error(`unknown config command: ${subcommand ?? ""}`.trim());
}

async function handleLark(subcommand, action, args, io) {
  if (subcommand === "app" && action === "set") {
    return updateConfig(io, (config) =>
      setLarkApp(config, {
        appId: optionValue(args, "--app-id"),
        appSecret: optionValue(args, "--app-secret")
      })
    );
  }
  if (subcommand === "user" && action === "set") {
    return updateConfig(io, (config) =>
      setOwnerUser(config, {
        openId: optionValue(args, "--open-id")
      })
    );
  }
  if (subcommand === "listeners") {
    if (action === "add") {
      return updateConfig(io, (config) =>
        addListener(config, {
          openId: optionValue(args, "--open-id"),
          alias: optionValue(args, "--alias", "")
        })
      );
    }
    if (action === "remove") {
      return updateConfig(io, (config) =>
        removeListener(config, {
          openId: optionValue(args, "--open-id")
        })
      );
    }
    if (action === "list") {
      const config = loadProjectConfig({ cwd: io.cwd });
      const listeners = config.lark.listeners ?? [];
      const rows = await Promise.all(listeners.map((listener) => resolveListenerRow({ listener, config, io })));
      io.stdout(listeners.length ? rows.join("\n") : "no listeners configured");
      return { exitCode: 0 };
    }
  }
  throw new Error(`unknown lark command: ${[subcommand, action].filter(Boolean).join(" ")}`);
}

function handleChannels(subcommand, action, args, io) {
  if (subcommand === "set" && action === "hermes") {
    return updateConfig(io, (config) =>
      setHermesChannel(config, {
        command: optionValue(args, "--command", "hermes"),
        model: optionValue(args, "--model", ""),
        provider: optionValue(args, "--provider", "")
      })
    );
  }
  if (subcommand === "set" && action === "ollama") {
    return updateConfig(io, (config) =>
      setOllamaChannel(config, {
        command: optionValue(args, "--command", "ollama"),
        model: optionValue(args, "--model")
      })
    );
  }
  if (subcommand === "show") {
    const config = loadProjectConfig({ cwd: io.cwd });
    io.stdout(JSON.stringify(config.channel, null, 2));
    return { exitCode: 0 };
  }
  throw new Error(`unknown channels command: ${[subcommand, action].filter(Boolean).join(" ")}`);
}

async function handlePollOnce(io) {
  const config = loadProjectConfig({ cwd: io.cwd });
  validateRuntimeConfig(config);
  const { service } = createWatchService(config, io);
  const result = await service.pollOnce();
  io.stdout(`poll-once complete processed=${result.processed}`);
  return { exitCode: 0 };
}

async function handleWatch(io, args = []) {
  const config = loadProjectConfig({ cwd: io.cwd });
  validateRuntimeConfig(config);
  const desktop = args.includes("--desktop");
  const serviceBundle = createWatchService(config, io, { desktopSurface: desktop });
  if (desktop && serviceBundle.apiServer) {
    await serviceBundle.apiServer.listen(config.desktop?.apiPort ?? 3017);
    io.stdout(`desktop-api started port=${serviceBundle.apiServer.port}`);
  }
  try {
    serviceBundle.service.start();
    const eventSource = createConfirmationEventSource(serviceBundle.service, io);
    await eventSource.start();
  } catch (error) {
    serviceBundle.service.stop?.();
    await serviceBundle.apiServer?.close();
    throw error;
  }
  io.stdout("watch started");
  return { exitCode: 0 };
}

async function handleDesktopApi(io) {
  const config = loadProjectConfig({ cwd: io.cwd });
  validateRuntimeConfig(config);
  const serviceBundle = createWatchService(config, io, { desktopSurface: true });
  if (!serviceBundle.apiServer) {
    throw new Error("desktop api server unavailable");
  }
  await serviceBundle.apiServer.listen(config.desktop?.apiPort ?? 3017);
  io.stdout(`desktop-api started port=${serviceBundle.apiServer.port}`);
  return { exitCode: 0 };
}

function handleLogs(subcommand, args, io) {
  const config = loadProjectConfig({ cwd: io.cwd });
  const store = createStore(config, io.cwd);
  if (subcommand === "list") {
    const limit = Number(optionValue(args, "--limit", "20"));
    io.stdout(JSON.stringify(store.recentLogs(limit), null, 2));
    store.close();
    return { exitCode: 0 };
  }
  if (subcommand === "show") {
    const requestId = optionValue(args, "--request-id");
    const record = store.get(requestId);
    if (!record) {
      throw new Error(`approval request not found: ${requestId}`);
    }
    io.stdout(
      JSON.stringify(
        {
          request: record,
          logs: store.logs(requestId)
        },
        null,
        2
      )
    );
    store.close();
    return { exitCode: 0 };
  }
  throw new Error(`unknown logs command: ${subcommand ?? ""}`.trim());
}

async function handleAuthCheck(io) {
  const config = loadProjectConfig({ cwd: io.cwd });
  validateRuntimeConfig(config);
  const listener = config.lark.listeners[0];
  const targetArgs = listener.chatId ? ["--chat-id", listener.chatId] : ["--user-id", listener.openId];
  await checkAgentChannel(config, io);
  await io.runCommand("lark-cli", [
    "im",
    "+chat-messages-list",
    "--as",
    "user",
    ...targetArgs,
    "--start",
    "2026-01-01T00:00:00+08:00",
    "--end",
    "2026-01-01T00:01:00+08:00",
    "--sort",
    "asc",
    "--page-size",
    "1",
    "--dry-run",
    "--format",
    "json"
  ]);
  await io.runCommand("lark-cli", [
    "im",
    "+messages-send",
    "--as",
    "bot",
    "--user-id",
    config.lark.owner.openId,
    "--text",
    "reply-pilot auth-check",
    "--dry-run"
  ]);
  await io.runCommand("lark-cli", [
    "im",
    "+messages-reply",
    "--as",
    "user",
    "--message-id",
    "om_auth_check",
    "--text",
    "reply-pilot auth-check",
    "--dry-run"
  ]);
  io.stdout("auth-check dry-run complete");
  return { exitCode: 0 };
}

async function checkAgentChannel(config, io) {
  if (config.channel.type === "hermes") {
    await io.runCommand(config.channel.hermes.command, ["--help"]);
    return;
  }
  if (config.channel.type === "ollama") {
    await io.runCommand(config.channel.ollama.command, ["--help"]);
    await io.runCommand(config.channel.ollama.command, ["show", config.channel.ollama.model]);
    return;
  }
  throw new Error(`unsupported agent channel: ${config.channel.type ?? "unknown"}`);
}

function updateConfig(io, updater) {
  const config = updater(loadProjectConfig({ cwd: io.cwd }));
  saveProjectConfig(config, { cwd: io.cwd });
  io.stdout("ok");
  return { exitCode: 0 };
}

async function resolveListenerRow({ listener, config, io }) {
  const id = listener.openId ?? listener.chatId;
  const type = listener.chatId ? "chat" : "user";
  const resolvedName = listener.chatId
    ? await resolveChatListenerName({ listener, config, io })
    : await resolveUserListenerName({ listener, io });
  const displayName = resolvedName && resolvedName !== id ? resolvedName : listener.alias || resolvedName || id;
  return [type, id, displayName, listener.alias && listener.alias !== displayName ? `alias=${listener.alias}` : ""]
    .filter(Boolean)
    .join("\t");
}

async function resolveUserListenerName({ listener, io }) {
  const contactClient = new LarkCliContactClient({
    runCommand: io.runCommand
  });
  return contactClient.getDisplayName(listener.openId);
}

async function resolveChatListenerName({ listener, config, io }) {
  const imClient = new LarkCliImClient({
    runCommand: io.runCommand
  });
  try {
    const chat = await imClient.getChat({ chatId: listener.chatId });
    const chatName = chat.name || chat.i18n_names?.zh_cn || chat.i18n_names?.en_us || chat.i18n_names?.ja_jp;
    if (chatName) {
      return chatName;
    }
  } catch {
    // Fall through to recent-message based name inference.
  }

  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const messages = await imClient.listRecentChatMessages({
      chatId: listener.chatId,
      start: formatIsoWithOffset(startDate),
      end: formatIsoWithOffset(endDate),
      pageSize: 20
    });
    const otherMessage = messages.find((message) => message.senderId && message.senderId !== config.lark.owner.openId);
    if (!otherMessage) {
      return "";
    }
    if (otherMessage.senderName) {
      return otherMessage.senderName;
    }
    return resolveUserListenerName({
      listener: {
        openId: otherMessage.senderId
      },
      io
    });
  } catch {
    return "";
  }
}

function createWatchService(config, io, options = {}) {
  const eventBus = options.desktopSurface ? new DesktopEventBus() : undefined;

  if (io.createPersonalWatchService) {
    const approvalSurface = options.desktopSurface ? new DesktopApprovalSurface({ eventBus }) : undefined;
    const service = io.createPersonalWatchService({
      config: personalWatchConfig(config),
      approvalSurface,
      approvalController: undefined
    });
    return { service, eventBus, approvalSurface, approvalController: undefined, apiServer: undefined };
  }

  const store = createStore(config, io.cwd);
  const channelType = config.channel.type;
  const channel = createAgentChannel({
    ...config.channel,
    [channelType]: {
      ...config.channel[channelType],
      promptTemplate: readPromptTemplate(config, io.cwd),
      persona: config.prompt?.persona ?? ""
    }
  });
  const bridge = createAgentBridge({ channel });
  const imClient = new LarkCliImClient({
    runCommand: io.runCommand
  });
  const contactClient = new LarkCliContactClient({
    runCommand: io.runCommand
  });
  const approvalController = createApprovalController({
    store,
    imClient,
    bridge,
    config: approvalControllerConfig(config),
    eventBus
  });
  const larkBotApprovalSurface =
    config.approval?.fallbackLarkBot !== false
      ? new LarkBotApprovalSurface({
          imClient,
          contactClient,
          config: personalWatchConfig(config)
        })
      : undefined;
  const approvalSurface = options.desktopSurface
    ? new DesktopApprovalSurface({ eventBus })
    : larkBotApprovalSurface;
  const fallbackApprovalSurface = options.desktopSurface ? larkBotApprovalSurface : undefined;
  const service = new PersonalWatchService({
    store,
    imClient,
    contactClient,
    bridge,
    approvalController,
    approvalSurface,
    fallbackApprovalSurface,
    config: personalWatchConfig(config),
    configProvider: () => personalWatchConfig(loadProjectConfig({ cwd: io.cwd }))
  });
  const desktopBootstrapToken =
    process.env.REPLY_PILOT_DESKTOP_BOOTSTRAP_TOKEN || `rpb_${crypto.randomBytes(24).toString("base64url")}`;
  const apiServer = options.desktopSurface
    ? createDesktopApiServer({
        controller: approvalController,
        eventBus,
        apiToken: ensureDesktopApiToken({ cwd: io.cwd }),
        sessionBootstrapToken: desktopBootstrapToken,
        desktopConfig: {
          load: () => loadDesktopConfig({ cwd: io.cwd }),
          save: (desktopConfig) => saveDesktopConfig(desktopConfig, { cwd: io.cwd })
        }
      })
    : undefined;
  return { service, store, approvalController, approvalSurface, eventBus, apiServer, desktopBootstrapToken };
}

function createConfirmationEventSource(service, io) {
  if (io.createEventSource) {
    return io.createEventSource({ service });
  }
  return new LarkCliEventSource({
    eventKey: "im.message.receive_v1",
    identity: "bot",
    onMessage: (message) =>
      service.handleConfirmationText({
        senderId: message.senderId,
        text: message.text
      })
  });
}

function personalWatchConfig(config) {
  return {
    targetListeners: config.lark.listeners.map((listener) => ({ ...listener })),
    selfUserId: config.lark.owner.openId,
    pollIntervalSeconds: config.watch.pollIntervalSeconds,
    lookbackMinutes: config.watch.lookbackMinutes,
    quietWindowSeconds: config.context.quietWindowSeconds,
    contextLookbackMessages: config.context.lookbackMessages,
    contextLookbackMinutes: config.context.lookbackMinutes,
    contextMaxChars: config.context.maxChars,
    notifyAs: config.watch.notifyAs,
    replyAs: config.watch.replyAs,
    fallbackLarkBot: config.approval?.fallbackLarkBot !== false
  };
}

function approvalControllerConfig(config) {
  return {
    ...personalWatchConfig(config),
    approval: config.approval ?? {}
  };
}

function readPromptTemplate(config, cwd) {
  const promptPath = config.prompt?.path;
  if (!promptPath) {
    return undefined;
  }
  const resolved = isAbsolute(promptPath) ? promptPath : join(cwd, promptPath);
  return existsSync(resolved) ? readFileSync(resolved, "utf8") : undefined;
}

function createStore(config, cwd) {
  const sqlitePath = config.storage.sqlitePath;
  return new SqliteApprovalStore(isAbsolute(sqlitePath) ? sqlitePath : join(cwd, sqlitePath));
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`missing required option: ${name}`);
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing required option: ${name}`);
  }
  return value;
}

function formatIsoWithOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absOffset % 60).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}${sign}${offsetHours}:${offsetRemainder}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

async function runExecFile(file, args) {
  return execFileAsync(file, args, {
    maxBuffer: 1024 * 1024
  });
}

function helpText() {
  return [
    "Usage: reply-pilot <command>",
    "",
    "Commands:",
    "  config init|show",
    "  lark app set --app-id <id> --app-secret <secret>",
    "  lark user set --open-id <ou_me>",
    "  lark listeners add|remove|list",
    "  channels set hermes [--command hermes] [--model <model>] [--provider <provider>]",
    "  channels set ollama [--command ollama] --model <model>",
    "  channels show",
    "  watch",
    "  watch --desktop",
    "  desktop-api",
    "  poll-once",
    "  logs list [--limit 20]",
    "  logs show --request-id <req_xxx>",
    "  auth-check"
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runCli();
  process.exitCode = result.exitCode;
}
