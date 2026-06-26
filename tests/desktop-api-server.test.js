import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopApiServer } from "../src/desktop/desktop-api-server.js";
import { MemoryApprovalStore } from "../src/workflow/memory-approval-store.js";
import { STATUS } from "../src/workflow/status.js";

test("desktop api lists pending requests and sends actions to controller", async () => {
  const sent = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    text: "原消息",
    draftText: "建议回复"
  });
  const server = createDesktopApiServer({
    apiToken: "test-token",
    sessionBootstrapToken: "boot-token",
    store,
    controller: {
      listPending: () => store.pendingRequests(),
      getRequest: (requestId) => store.get(requestId),
      async send(requestId, actor) {
        sent.push({ requestId, actor });
        return store.update(requestId, { status: STATUS.SENT, sentMessageId: "om-reply" });
      }
    }
  });
  await server.listen(0);
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const deniedBootstrap = await fetch(`${baseUrl}/api/session`, {
      headers: {
        Origin: "http://tauri.localhost"
      }
    });
    assert.equal(deniedBootstrap.status, 401);

    const session = await fetch(`${baseUrl}/api/session?bootstrap=boot-token`, {
      headers: {
        Origin: "http://tauri.localhost"
      }
    }).then((response) => response.json());
    assert.equal(session.token, "test-token");

    const reusedSession = await fetch(`${baseUrl}/api/session?bootstrap=boot-token`, {
      headers: {
        Origin: "http://tauri.localhost"
      }
    });
    assert.equal(reusedSession.status, 401);

    const blocked = await fetch(`${baseUrl}/api/requests/req-1/send`, { method: "POST" });
    assert.equal(blocked.status, 403);
    assert.deepEqual(sent, []);

    const deniedSession = await fetch(`${baseUrl}/api/session`);
    assert.equal(deniedSession.status, 403);

    const deniedOrigin = await fetch(`${baseUrl}/api/requests/pending`, {
      headers: {
        Origin: "http://evil.localhost",
        "X-Reply-Pilot-Token": "test-token"
      }
    });
    assert.equal(deniedOrigin.status, 403);

    const deniedQueryToken = await fetch(`${baseUrl}/api/requests/pending?token=test-token`, {
      headers: {
        Origin: "http://tauri.localhost"
      }
    });
    assert.equal(deniedQueryToken.status, 401);

    const headers = { Origin: "http://tauri.localhost", "X-Reply-Pilot-Token": "test-token" };
    const list = await fetch(`${baseUrl}/api/requests/pending`, { headers }).then((response) => response.json());
    assert.equal(list.requests[0].id, "req-1");

    const current = await fetch(`${baseUrl}/api/requests/req-1`, { headers }).then((response) => response.json());
    assert.equal(current.request.id, "req-1");

    const result = await fetch(`${baseUrl}/api/requests/req-1/send`, { method: "POST", headers }).then((response) =>
      response.json()
    );
    assert.equal(result.request.status, STATUS.SENT);
    assert.deepEqual(sent, [{ requestId: "req-1", actor: "desktop-pet" }]);
  } finally {
    await server.close();
  }
});

test("desktop api loads and saves desktop position config", async () => {
  let config = {
    theme: "pixel",
    position: {
      mode: "free",
      x: 1320,
      y: 820,
      corner: "bottom-right"
    }
  };
  const server = createDesktopApiServer({
    apiToken: "test-token",
    controller: {
      listPending: () => [],
      getRequest: () => undefined
    },
    desktopConfig: {
      load: () => config,
      save(nextConfig) {
        config = nextConfig;
        return config;
      }
    }
  });
  await server.listen(0);
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const headers = { Origin: "http://tauri.localhost", "X-Reply-Pilot-Token": "test-token" };
    const initial = await fetch(`${baseUrl}/api/desktop-config`, { headers }).then((response) => response.json());
    assert.equal(initial.config.position.x, 1320);
    assert.equal(initial.config.apiToken, undefined);

    const saved = await fetch(`${baseUrl}/api/desktop-config`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...config,
          position: {
            mode: "free",
            x: 120,
            y: 240,
            corner: "bottom-right"
          }
        }
      })
    }).then((response) => response.json());

    assert.equal(saved.config.position.x, 120);
    assert.equal(saved.config.position.y, 240);
    assert.equal(saved.config.apiToken, undefined);
    assert.equal(config.position.x, 120);
  } finally {
    await server.close();
  }
});
