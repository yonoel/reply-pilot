import assert from "node:assert/strict";
import test from "node:test";

test("desktop pet click refreshes pending requests when no request is currently rendered", async () => {
  const elements = createElements();
  const fetchCalls = [];
  globalThis.document = {
    querySelector(selector) {
      return elements[selector];
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        async writeText() {}
      }
    }
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { search: "" }
  });
  globalThis.__TAURI__ = {
    core: {
      async invoke(command) {
        assert.equal(command, "bootstrap_token");
        return "bootstrap-token";
      }
    },
    window: {
      getCurrentWindow() {
        return {
          async setPosition() {},
          async setSize() {},
          async show() {},
          async outerPosition() {
            return { x: 80, y: 120 };
          },
          async outerSize() {
            return { width: 156, height: 160 };
          }
        };
      },
      PhysicalPosition: class PhysicalPosition {
        constructor(x, y) {
          this.x = x;
          this.y = y;
        }
      },
      PhysicalSize: class PhysicalSize {
        constructor(width, height) {
          this.width = width;
          this.height = height;
        }
      }
    }
  };
  globalThis.EventSource = class EventSource {
    close() {}
  };
  globalThis.addEventListener = () => {};
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url).endsWith("/api/session")) {
      return jsonResponse({ token: "api-token" });
    }
    if (String(url).endsWith("/api/desktop-config")) {
      return jsonResponse({ config: { position: { mode: "free", x: 80, y: 120 } } });
    }
    if (String(url).endsWith("/api/requests/pending")) {
      const pendingFetchCount = fetchCalls.filter((call) => call.endsWith("/api/requests/pending")).length;
      return jsonResponse({
        requests:
          pendingFetchCount === 1
            ? []
            : [
                {
                  id: "req-1",
                  senderName: "赵飞",
                  status: "PENDING_APPROVAL",
                  text: "有权限的话可以在 dms 直接执行",
                  draftText: "了解了，没 DMS 权限，走 C26。"
                }
              ]
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  await import(`../desktop/main.js?click-refresh=${Date.now()}`);
  await settle();

  assert.equal(elements["#approval-card"].hidden, true);
  await elements["#sprite"].dispatch("click", {});
  await settle();

  assert.equal(elements["#approval-card"].hidden, false);
  assert.equal(elements["#sender"].textContent, "赵飞");
  assert.equal(elements["#draft-text"].textContent, "了解了，没 DMS 权限，走 C26。");
});

test("desktop pet renders drafting requests without enabling approval actions", async () => {
  const elements = createElements();
  globalThis.document = {
    querySelector(selector) {
      return elements[selector];
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        async writeText() {}
      }
    }
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { search: "" }
  });
  globalThis.__TAURI__ = {
    core: {
      async invoke(command) {
        assert.equal(command, "bootstrap_token");
        return "bootstrap-token";
      }
    },
    window: {
      getCurrentWindow() {
        return {
          async setPosition() {},
          async setSize() {},
          async show() {},
          async outerPosition() {
            return { x: 80, y: 120 };
          },
          async outerSize() {
            return { width: 156, height: 160 };
          }
        };
      },
      PhysicalPosition: class PhysicalPosition {
        constructor(x, y) {
          this.x = x;
          this.y = y;
        }
      },
      PhysicalSize: class PhysicalSize {
        constructor(width, height) {
          this.width = width;
          this.height = height;
        }
      }
    }
  };
  globalThis.EventSource = class EventSource {
    close() {}
  };
  globalThis.addEventListener = () => {};
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/session")) {
      return jsonResponse({ token: "api-token" });
    }
    if (String(url).endsWith("/api/desktop-config")) {
      return jsonResponse({ config: { position: { mode: "free", x: 80, y: 120 } } });
    }
    if (String(url).endsWith("/api/requests/pending")) {
      return jsonResponse({
        requests: [
          {
            id: "req-1",
            senderName: "杨霞",
            status: "RECEIVED",
            uiState: "thinking",
            text: "哈哈 行 切换成功。",
            draftText: ""
          }
        ]
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  await import(`../desktop/main.js?drafting=${Date.now()}`);
  await settle();

  assert.equal(elements["#approval-card"].hidden, false);
  assert.equal(elements["#sender"].textContent, "杨霞");
  assert.equal(elements["#source-text"].textContent, "哈哈 行 切换成功。");
  assert.equal(elements["#helper"].textContent, "正在生成建议回复...");
  assert.equal(elements["#send"].hidden, true);
  assert.equal(elements["#ignore"].hidden, true);
  assert.equal(elements["#instruction"].disabled, true);
  assert.equal([...elements["#pet"].classList].includes("state-thinking"), true);
});

function createElements() {
  const selectors = [
    "#pet",
    "#approval-card",
    "#badge",
    "#sender",
    "#source-text",
    "#draft-text",
    "#helper",
    "#instruction-form",
    "#instruction",
    "#send",
    "#ignore",
    "#copy-draft",
    "#sprite"
  ];
  return Object.fromEntries(selectors.map((selector) => [selector, createElement()]));
}

function createElement() {
  const listeners = new Map();
  return {
    hidden: false,
    disabled: false,
    textContent: "",
    value: "",
    classList: createClassList(),
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    removeEventListener(event) {
      listeners.delete(event);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture() {
      return false;
    },
    async dispatch(event, payload) {
      return listeners.get(event)?.(payload);
    }
  };
}

function createClassList() {
  const values = new Set();
  return {
    add(...names) {
      for (const name of names) values.add(name);
    },
    remove(...names) {
      for (const name of names) values.delete(name);
    },
    [Symbol.iterator]() {
      return values[Symbol.iterator]();
    }
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
