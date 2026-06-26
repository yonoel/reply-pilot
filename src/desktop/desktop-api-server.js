import http from "node:http";

import { publicDesktopConfig } from "./desktop-config.js";

const DEFAULT_ALLOWED_ORIGINS = new Set(["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]);
const MAX_JSON_BODY_BYTES = 1024 * 1024;

export function createDesktopApiServer({
  controller,
  eventBus,
  desktopConfig,
  apiToken = "",
  sessionBootstrapToken = "",
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS
}) {
  const security = {
    apiToken,
    sessionBootstrapTokens: new Set(sessionBootstrapToken ? [sessionBootstrapToken] : []),
    allowedOrigins: new Set(allowedOrigins)
  };
  const server = http.createServer(async (req, res) => {
    try {
      await route({ req, res, controller, eventBus, desktopConfig, security });
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      sendJson({
        req,
        res,
        status: error.statusCode ?? 500,
        body: { error: error.expose ? error.message : "desktop api error" },
        security
      });
    }
  });

  return {
    get port() {
      const address = server.address();
      return typeof address === "object" && address ? address.port : 0;
    },
    listen(port = 3017, host = "127.0.0.1") {
      return new Promise((resolve) => server.listen(Number(port), host, () => resolve(undefined)));
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function route({ req, res, controller, eventBus, desktopConfig, security }) {
  const url = new URL(req.url, "http://127.0.0.1");
  if (!isAllowedOrigin(req, security)) {
    sendJson({ req, res, status: 403, body: { error: "origin not allowed" }, security });
    return;
  }
  if (req.method === "OPTIONS") {
    sendJson({ req, res, status: 204, body: {}, security });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson({ req, res, status: 200, body: { status: "UP" }, security });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/session") {
    if (!consumeSessionBootstrapToken(req, url, security)) {
      sendUnauthorized({ req, res, security });
      return;
    }
    sendJson({ req, res, status: 200, body: { token: security.apiToken }, security });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/requests/pending") {
    if (!isAuthorized(req, url, security)) {
      sendUnauthorized({ req, res, security });
      return;
    }
    sendJson({ req, res, status: 200, body: { requests: controller.listPending() }, security });
    return;
  }
  const requestMatch = url.pathname.match(/^\/api\/requests\/([^/]+)$/);
  if (requestMatch && req.method === "GET") {
    if (!isAuthorized(req, url, security)) {
      sendUnauthorized({ req, res, security });
      return;
    }
    sendJson({
      req,
      res,
      status: 200,
      body: { request: controller.getRequest(decodeURIComponent(requestMatch[1])) },
      security
    });
    return;
  }
  const action = url.pathname.match(/^\/api\/requests\/([^/]+)\/(send|ignore|instruction)$/);
  if (action && req.method === "POST") {
    if (!isAuthorized(req, url, security)) {
      sendUnauthorized({ req, res, security });
      return;
    }
    const requestId = decodeURIComponent(action[1]);
    if (action[2] === "send") {
      sendJson({ req, res, status: 200, body: { request: await controller.send(requestId, "desktop-pet") }, security });
      return;
    }
    if (action[2] === "ignore") {
      sendJson({ req, res, status: 200, body: { request: await controller.ignore(requestId, "desktop-pet") }, security });
      return;
    }
    const body = await readJson(req);
    sendJson({
      req,
      res,
      status: 200,
      body: await controller.handleInstruction({
        requestId,
        instruction: body.instruction,
        actor: "desktop-pet"
      }),
      security
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/desktop-config") {
    if (!isAuthorized(req, url, security)) {
      sendUnauthorized({ req, res, security });
      return;
    }
    if (!desktopConfig) {
      sendJson({ req, res, status: 503, body: { error: "desktop config unavailable" }, security });
      return;
    }
    sendJson({
      req,
      res,
      status: 200,
      body: { config: publicDesktopConfig(desktopConfig.load()) },
      security
    });
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/desktop-config") {
    if (!isAuthorized(req, url, security)) {
      sendUnauthorized({ req, res, security });
      return;
    }
    if (!desktopConfig) {
      sendJson({ req, res, status: 503, body: { error: "desktop config unavailable" }, security });
      return;
    }
    const body = await readJson(req);
    const saved = desktopConfig.save(body.config ?? body);
    sendJson({ req, res, status: 200, body: { config: publicDesktopConfig(saved) }, security });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    if (!isAuthorized(req, url, security, { allowQueryToken: true })) {
      sendUnauthorized({ req, res, security });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...corsHeaders(req, security)
    });
    let unsubscribe = undefined;
    try {
      unsubscribe = eventBus?.subscribe((event) => {
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          unsubscribe?.();
        }
      });
    } catch (error) {
      res.destroy(error);
      return;
    }
    res.on("error", () => unsubscribe?.());
    req.on("close", () => unsubscribe?.());
    return;
  }
  sendJson({ req, res, status: 404, body: { error: "not found" }, security });
}

function sendJson({ req, res, status, body, security }) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders(req, security),
    "Access-Control-Allow-Headers": "Content-Type, X-Reply-Pilot-Token",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
  });
  res.end(status === 204 ? "" : JSON.stringify(body));
}

function sendUnauthorized({ req, res, security }) {
  sendJson({ req, res, status: 401, body: { error: "desktop api token required" }, security });
}

function corsHeaders(req, security) {
  const origin = req.headers.origin;
  if (origin && security.allowedOrigins.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin"
    };
  }
  return {};
}

function isAllowedOrigin(req, security) {
  const origin = req.headers.origin;
  return Boolean(origin && security.allowedOrigins.has(origin));
}

function consumeSessionBootstrapToken(req, url, security) {
  const headerToken = req.headers["x-reply-pilot-bootstrap"];
  const requestToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  const token = requestToken ?? url.searchParams.get("bootstrap");
  if (!token || !security.sessionBootstrapTokens.has(token)) {
    return false;
  }
  security.sessionBootstrapTokens.delete(token);
  return true;
}

function isAuthorized(req, url, security, { allowQueryToken = false } = {}) {
  if (!security.apiToken) {
    return false;
  }
  const headerToken = req.headers["x-reply-pilot-token"];
  const requestToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  return requestToken === security.apiToken || (allowQueryToken && url.searchParams.get("token") === security.apiToken);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) {
        return;
      }
      data += chunk;
      if (Buffer.byteLength(data) > MAX_JSON_BODY_BYTES) {
        settled = true;
        reject(Object.assign(new Error("request body too large"), { statusCode: 413, expose: true }));
      }
    });
    req.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}
