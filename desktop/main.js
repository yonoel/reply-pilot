import { interpretDesktopInstruction } from "./approval-rules.js";

const API_BASE = "http://127.0.0.1:3017";
const IDLE_WINDOW_SIZE = { width: 156, height: 160 };
const CARD_WINDOW_SIZE = { width: 520, height: 360 };
const PENDING_REFRESH_INTERVAL_MS = 15_000;

const state = {
  current: undefined,
  count: 0,
  apiToken: "",
  desktopConfig: undefined,
  drag: undefined,
  appWindow: undefined,
  events: undefined
};

const pet = document.querySelector("#pet");
const card = document.querySelector("#approval-card");
const badge = document.querySelector("#badge");
const sender = document.querySelector("#sender");
const sourceText = document.querySelector("#source-text");
const draftText = document.querySelector("#draft-text");
const helper = document.querySelector("#helper");
const instructionForm = document.querySelector("#instruction-form");
const instruction = document.querySelector("#instruction");
const sendButton = document.querySelector("#send");
const ignoreButton = document.querySelector("#ignore");

const sprite = document.querySelector("#sprite");

sprite.addEventListener("click", () => {
  void handleSpriteClick();
});

sprite.addEventListener("pointerdown", startDrag);

sendButton.addEventListener("click", async () => {
  await action("send");
});

ignoreButton.addEventListener("click", async () => {
  await action("ignore");
});

document.querySelector("#copy-draft").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.current?.draftText ?? "");
});

instructionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = instruction.value.trim();
  if (!state.current || !value) {
    return;
  }
  const interpreted = interpretDesktopInstruction(value);
  if (interpreted.action === "empty") {
    return;
  }
  if (interpreted.action === "send") {
    instruction.value = "";
    await action("send");
    return;
  }
  if (interpreted.action === "ignore") {
    instruction.value = "";
    await action("ignore");
    return;
  }
  setBusy(true);
  setPetState("thinking");
  helper.textContent = "思考中：按你的要求改写...";
  try {
    const body = await postJson(`/api/requests/${encodeURIComponent(state.current.id)}/instruction`, {
      instruction: interpreted.instruction
    });
    instruction.value = "";
    renderRequest(body.request);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
});

async function handleSpriteClick() {
  const wasVisible = Boolean(state.current && !card.hidden);
  if (!wasVisible) {
    try {
      await loadPending();
    } catch (error) {
      showError(error);
      return;
    }
  }
  if (!state.current) {
    return;
  }
  const showCard = !wasVisible;
  card.hidden = !showCard;
  await setWindowSizeForCard(showCard);
}

async function action(name) {
  if (!state.current || state.current.status !== "PENDING_APPROVAL") {
    return;
  }
  setBusy(true);
  setPetState(name === "send" ? "sending" : "pending");
  try {
    const body = await postJson(`/api/requests/${encodeURIComponent(state.current.id)}/${name}`);
    if (body.request.status === "SENT" || body.request.status === "IGNORED") {
      state.current = undefined;
      card.hidden = true;
      badge.hidden = true;
      setPetState("idle");
      await loadPending();
      return;
    }
    renderRequest(body.request);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function loadPending() {
  const response = await apiFetch("/api/requests/pending");
  if (!response.ok) {
    throw new Error(`desktop api ${response.status}`);
  }
  const body = await response.json();
  state.count = body.requests.length;
  renderRequest(body.requests[0]);
  renderBadge();
}

function renderRequest(request) {
  state.current = request;
  if (!request) {
    card.hidden = true;
    helper.textContent = "";
    setActionAvailability(false);
    setPetState("idle");
    void setWindowSizeForCard(false);
    return;
  }
  sender.textContent = request.senderName || request.senderId || request.chatId || "-";
  sourceText.textContent = request.text || "";
  draftText.textContent = request.draftText || "";
  const pending = request.status === "PENDING_APPROVAL";
  helper.textContent = helperTextForRequest(request);
  setActionAvailability(pending);
  card.hidden = false;
  void setWindowSizeForCard(true);
  setPetState(petStateForRequest(request, pending));
}

function helperTextForRequest(request) {
  if (request.uiState === "thinking" && request.status === "RECEIVED") {
    return "正在生成建议回复...";
  }
  if (request.status === "SUPERSEDED") {
    return "这条建议已过期，对方又发了新消息。";
  }
  return "";
}

function petStateForRequest(request, pending) {
  if (request.uiState === "thinking") {
    return "thinking";
  }
  if (pending) {
    return "pending";
  }
  if (request.status === "SUPERSEDED") {
    return "idle";
  }
  return "error";
}

function renderBadge() {
  badge.textContent = String(state.count);
  badge.hidden = state.count === 0;
}

function setPetState(name) {
  for (const className of [...pet.classList]) {
    if (className.startsWith("state-")) {
      pet.classList.remove(className);
    }
  }
  pet.classList.add(`state-${name}`);
}

function setBusy(busy) {
  instruction.disabled = busy || state.current?.status !== "PENDING_APPROVAL";
  sendButton.disabled = busy || state.current?.status !== "PENDING_APPROVAL";
  ignoreButton.disabled = busy || state.current?.status !== "PENDING_APPROVAL";
}

function setActionAvailability(available) {
  sendButton.hidden = !available;
  ignoreButton.hidden = !available;
  sendButton.disabled = !available;
  ignoreButton.disabled = !available;
  instruction.disabled = !available;
}

function showError(error) {
  helper.textContent = error.message;
  setPetState("error");
}

async function postJson(path, body) {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `desktop api ${response.status}`);
  }
  return response.json();
}

function connectEvents() {
  state.events?.close();
  const events = new EventSource(`${API_BASE}/api/events?token=${encodeURIComponent(state.apiToken)}`);
  state.events = events;
  events.onopen = () => {
    void loadPending().catch(showError);
  };
  events.onmessage = (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    if (event.request && state.current?.id === event.request.id) {
      renderRequest(event.request);
      return;
    }
    if (event.type === "expired" && state.current?.id === event.requestId) {
      renderRequest({
        ...state.current,
        status: "SUPERSEDED"
      });
      return;
    }
    void loadPending().catch(showError);
  };
  events.onerror = () => {
    setPetState(state.current ? "error" : "idle");
  };
}

function startPendingRefresh() {
  const timer = setInterval(() => {
    void loadPending().catch(showError);
  }, PENDING_REFRESH_INTERVAL_MS);
  timer.unref?.();
}

async function loadDesktopConfig() {
  const response = await apiFetch("/api/desktop-config");
  if (!response.ok) {
    throw new Error(`desktop config ${response.status}`);
  }
  const body = await response.json();
  state.desktopConfig = body.config;
  await applyDesktopConfig(body.config);
}

async function applyDesktopConfig(config = {}) {
  const position = config.position ?? {};
  pet.classList.remove("position-free", "corner-top-left", "corner-top-right", "corner-bottom-left", "corner-bottom-right");
  if (position.mode === "free") {
    pet.classList.add("position-free");
    await setWindowPosition(Number(position.x ?? 1320), Number(position.y ?? 820));
    return;
  }
  const corner = position.corner ?? "bottom-right";
  pet.classList.add(`corner-${corner}`);
  await setWindowCorner(corner);
}

async function startDrag(event) {
  const appWindow = getAppWindow();
  if (event.button !== 0 || !appWindow) {
    return;
  }
  const position = await appWindow.outerPosition();
  state.drag = {
    screenX: event.screenX,
    screenY: event.screenY,
    windowX: position.x,
    windowY: position.y
  };
  pet.classList.add("position-free");
  sprite.setPointerCapture(event.pointerId);
  sprite.addEventListener("pointermove", dragWindow);
  sprite.addEventListener("pointerup", endWindowDrag, { once: true });
  sprite.addEventListener("pointercancel", endWindowDrag, { once: true });
}

function dragWindow(event) {
  if (!state.drag) {
    return;
  }
  const x = Math.round(state.drag.windowX + event.screenX - state.drag.screenX);
  const y = Math.round(state.drag.windowY + event.screenY - state.drag.screenY);
  void setWindowPosition(x, y);
}

async function endWindowDrag(event) {
  if (sprite.hasPointerCapture(event.pointerId)) {
    sprite.releasePointerCapture(event.pointerId);
  }
  sprite.removeEventListener("pointermove", dragWindow);
  if (!state.drag) {
    return;
  }
  state.drag = undefined;
  const position = await getAppWindow()?.outerPosition();
  if (!position) {
    return;
  }
  const nextConfig = {
    ...(state.desktopConfig ?? {}),
    position: {
      ...((state.desktopConfig ?? {}).position ?? {}),
      mode: "free",
      x: Math.round(position.x),
      y: Math.round(position.y)
    }
  };
  state.desktopConfig = nextConfig;
  await apiFetch("/api/desktop-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: nextConfig })
  }).catch(showError);
}

async function loadSession() {
  const bootstrapToken = await getBootstrapToken();
  if (!bootstrapToken) {
    throw new Error("desktop bootstrap token missing");
  }
  const response = await fetch(`${API_BASE}/api/session`, {
    headers: {
      "X-Reply-Pilot-Bootstrap": bootstrapToken
    }
  });
  if (!response.ok) {
    throw new Error(`desktop session ${response.status}`);
  }
  const body = await response.json();
  state.apiToken = body.token ?? "";
}

async function getBootstrapToken() {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (typeof invoke === "function") {
    return invoke("bootstrap_token");
  }
  return new URLSearchParams(globalThis.location?.search ?? "").get("bootstrap") ?? "";
}

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("X-Reply-Pilot-Token", state.apiToken);
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
}

function getTauriWindowApi() {
  return globalThis.__TAURI__?.window;
}

function getAppWindow() {
  if (state.appWindow) {
    return state.appWindow;
  }
  const tauriWindow = getTauriWindowApi();
  state.appWindow = tauriWindow?.getCurrentWindow?.();
  return state.appWindow;
}

async function setWindowPosition(x, y) {
  const appWindow = getAppWindow();
  if (!appWindow) {
    return;
  }
  await appWindow.setPosition(createPhysicalPosition(x, y));
}

async function setWindowSizeForCard(showCard) {
  const appWindow = getAppWindow();
  if (!appWindow) {
    return;
  }
  const size = showCard ? CARD_WINDOW_SIZE : IDLE_WINDOW_SIZE;
  await appWindow.setSize(createPhysicalSize(size.width, size.height));
}

async function setWindowCorner(corner) {
  const appWindow = getAppWindow();
  const tauriWindow = getTauriWindowApi();
  if (!appWindow || !tauriWindow) {
    return;
  }
  const monitor = (await tauriWindow.currentMonitor?.()) ?? (await tauriWindow.primaryMonitor?.());
  const windowSize = await appWindow.outerSize();
  const workArea = monitor?.workArea;
  if (!workArea) {
    return;
  }
  const margin = 16;
  const left = workArea.position.x + margin;
  const top = workArea.position.y + margin;
  const right = workArea.position.x + workArea.size.width - windowSize.width - margin;
  const bottom = workArea.position.y + workArea.size.height - windowSize.height - margin;
  const x = corner.endsWith("right") ? right : left;
  const y = corner.startsWith("top") ? top : bottom;
  await setWindowPosition(Math.round(x), Math.round(y));
}

function createPhysicalPosition(x, y) {
  const PhysicalPosition = getTauriWindowApi()?.PhysicalPosition;
  return PhysicalPosition ? new PhysicalPosition(x, y) : { type: "Physical", x, y };
}

function createPhysicalSize(width, height) {
  const PhysicalSize = getTauriWindowApi()?.PhysicalSize;
  return PhysicalSize ? new PhysicalSize(width, height) : { type: "Physical", width, height };
}

async function revealWindow() {
  await getAppWindow()?.show?.();
}

void loadSession()
  .then(loadDesktopConfig)
  .catch(showError)
  .finally(() => {
    void revealWindow();
    void loadPending().catch(showError);
    connectEvents();
    startPendingRefresh();
  });

globalThis.addEventListener("beforeunload", () => {
  state.events?.close();
});
