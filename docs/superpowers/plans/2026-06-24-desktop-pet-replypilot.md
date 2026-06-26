# ReplyPilot 桌面小精灵实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development, superpowers:grouped-subagent-development, or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 构建 ReplyPilot V1 桌面小精灵：飞书消息由后台静默生成建议回复，桌面像素小精灵直接展示原消息和建议回复，用户可发送、忽略或输入改写要求。

**架构：** 先把审批动作从 `PersonalWatchService` 抽到可复用的 `ApprovalController`，再用本地 HTTP/SSE API 暴露给桌宠 UI。桌宠 UI 使用 Tauri v2 透明无边框窗口承载静态 HTML/CSS/JS，不把浏览器控制台作为入口；飞书 bot 命令保留为 fallback，并委托同一个 controller。

**技术栈：** Node.js 22、node:test、node:sqlite、node:http、Tauri v2、HTML/CSS/JavaScript、lark-cli、现有 Hermes/Ollama channel。

**设计规格：** `docs/superpowers/specs/2026-06-24-desktop-pet-replypilot-design.md`

**参考依据：**
- Tauri v2 configuration: `https://v2.tauri.app/reference/config/`
- Tauri v2 window customization: `https://v2.tauri.app/learn/window-customization/`
- Tauri v2 JavaScript window API: `https://v2.tauri.app/reference/javascript/api/namespacewindow/`

---

## End-to-End Acceptance Plan

**适用：** 是

**适用性理由：**
本计划涉及桌面 UI、后台 watcher、SQLite 状态、lark-cli 真实读取和飞书 user 身份真实写回。单元测试、dry-run、HTTP 200 或 Tauri 窗口能打开都不能证明用户路径真正可用。

**端到端场景：**
用户启动 ReplyPilot watcher 和桌面小精灵。配置过的飞书联系人发来一条真实消息。后台静默生成建议回复后，桌面小精灵进入待处理状态并展示原消息和建议回复。用户输入“语气软一点”，小精灵进入思考中，新建议生成后回到待处理。用户点击发送，系统用飞书 user 身份回复原消息，并在本地 SQLite 中记录 `SENT` 和 `sentMessageId`。

**触发方式：**
1. 启动后台：`npm start`
2. 启动桌宠：`npm run desktop:dev`
3. 让已配置的飞书联系人或测试会话发送真实文本消息。
4. 在桌宠审批卡中输入改写要求并发送。

**通过标准：**
- 桌宠窗口是无浏览器 chrome 的桌面浮层，显示像素小精灵。
- 首次建议准备好之前不显示“思考中”。
- 建议准备好后直接展示发件人、原消息、建议回复、输入框、发送和忽略按钮。
- 输入改写要求后显示“思考中”，按钮不可重复提交；新草稿生成后回到待处理。
- 点击发送后，飞书原消息收到真实回复。
- SQLite 对应 request 最终为 `SENT`，包含 `sentMessageId`。
- `execution_logs` 记录 created、draft finished、instruction received、rewritten、sent 等关键事件。

**失败标准：**
- 只通过 `auth-check --dry-run`、mock 测试或 HTTP 200，不算 E2E 通过。
- 桌宠显示“待处理”但没有真实 pending request，不算通过。
- 点击发送后本地状态变为 `SENT`，但飞书原消息没有真实回复，不算通过。
- 飞书真实回复成功但 SQLite 没有回写 `sentMessageId`，不算通过。
- 新消息导致旧 request `SUPERSEDED` 后，旧草稿仍可发送，判定失败。

**副作用前置检查：**
- `npm run cli -- config show` 确认配置中 app secret 已脱敏显示，且 owner/listeners/channel 存在。
- `npm run cli -- auth-check` 只作为命令形状和本地工具 guard，不作为真实通过证据。
- 真实 E2E 前先确认测试联系人或测试群允许发送测试消息。
- 检查 SQLite 中没有同一 `messageId` 已经处于 `SENT` 的 request，避免重复真实回复。

**Controller 托管 UI 需求：**
- 需要桌面 UI 控制器验证 Tauri 窗口：启动、拖拽、点击输入框、输入改写要求、点击发送。
- UI 控制器需回填：桌宠截图、待处理卡片截图、思考中截图、发送完成后截图或状态日志。

**回读证据：**
- 飞书侧读取原消息线程，确认出现 user 身份回复文本和消息 ID。
- `npm run cli -- logs show --request-id <req>` 回读 request 与 execution logs。
- 桌宠 API `GET /api/requests/<req>` 返回 `SENT` 和 `sentMessageId`。

**端到端不覆盖范围：**
- 不验证生产安装包签名、公证、自动更新。
- 不验证多显示器所有边界行为，只验证当前主屏可拖拽和位置记忆。
- 不验证 `instructionMode=agent`，V1 只验证 `instructionMode=rules`。

---

## 文件结构

### 新增文件

- `src/approval/instruction-rules.js`：规则解释器。把输入框内容解释为 `send`、`ignore` 或 `rewrite`。
- `src/approval/approval-controller.js`：统一处理 pending request 的查询、发送、忽略、改写、过期校验和日志。
- `src/approval/lark-bot-approval-surface.js`：飞书 bot fallback 通知实现，承接现有 Markdown 通知格式。
- `src/approval/desktop-approval-surface.js`：桌宠通知实现，写入本地事件总线，不向飞书发送审批消息。
- `src/desktop/desktop-event-bus.js`：内存事件总线，用于 SSE 推送 pending、updated、expired 事件。
- `src/desktop/desktop-api-server.js`：本地 HTTP/SSE API，供 Tauri UI 读取 pending requests 和提交动作。
- `src/desktop/desktop-config.js`：读取和保存 `.reply-pilot/desktop.json`。
- `desktop/index.html`：Tauri 前端入口。
- `desktop/styles.css`：桌宠窗口和审批卡样式。
- `desktop/main.js`：桌宠 UI 状态、API 调用、拖拽和位置保存。
- `src-tauri/Cargo.toml`：Tauri Rust crate 配置。
- `src-tauri/tauri.conf.json`：Tauri v2 应用、窗口、build 配置。
- `src-tauri/src/main.rs`：最小 Tauri 启动入口。
- `tests/approval-instruction-rules.test.js`
- `tests/approval-controller.test.js`
- `tests/desktop-config.test.js`
- `tests/desktop-api-server.test.js`

### 修改文件

- `src/personal-watch/personal-watch-service.js`：注入 `approvalSurface` 和 `approvalController`，移除直接 `notifySelf` 作为主路径；保留兼容 fallback。
- `src/config/project-config.js`：增加 `desktop` 和 `approval` 默认配置，保留现有 config 兼容。
- `src/cli.js`：增加 `desktop-api` 命令；`watch` 可选启动 desktop API；`logs show/list` 继续复用。
- `src/workflow/sqlite-approval-store.js`：增加 pending/recent query helper。
- `src/workflow/memory-approval-store.js`：测试用 store 同步新增 helper。
- `src/workflow/status.js`：确认 `SEND_FAILED` 被发送失败路径使用。
- `package.json`：增加 Tauri 和桌宠脚本。
- `README.md`：补充桌宠运行方式、真实 E2E 验收边界。

---

### Task 1: 配置桌宠和审批默认值

**Files:**
- Modify: `src/config/project-config.js`
- Create: `src/desktop/desktop-config.js`
- Test: `tests/project-config.test.js`
- Test: `tests/desktop-config.test.js`

- [ ] **Step 1: 写失败测试，覆盖默认 desktop/approval 配置**

Add to `tests/project-config.test.js`:

```js
test("project config includes desktop pet and approval defaults", () => {
  const config = createDefaultProjectConfig();

  assert.deepEqual(config.desktop, {
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
    showSystemNotification: true
  });
  assert.deepEqual(config.approval, {
    primarySurface: "desktop-pet",
    fallbackLarkBot: true,
    instructionMode: "rules",
    allowDirectSendByInstruction: true
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/project-config.test.js --test-name-pattern "desktop pet"`

Expected: FAIL，错误包含 `desktop` 或 `approval` actual 为 `undefined`。

- [ ] **Step 3: 实现默认配置**

Modify `createDefaultProjectConfig()` in `src/config/project-config.js` by adding:

```js
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
      showSystemNotification: true
    },
    approval: {
      primarySurface: "desktop-pet",
      fallbackLarkBot: true,
      instructionMode: "rules",
      allowDirectSendByInstruction: true
    },
```

Place it before `lark` so runtime config stays readable.

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/project-config.test.js --test-name-pattern "desktop pet"`

Expected: PASS。

- [ ] **Step 5: 跑完整配置测试**

Run: `node --test tests/project-config.test.js`

Expected: PASS。

- [ ] **Step 6: 写 desktop.json 读写失败测试**

Create `tests/desktop-config.test.js`:

```js
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadDesktopConfig, saveDesktopConfig } from "../src/desktop/desktop-config.js";

test("desktop config loads defaults and saves project local desktop preferences", () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-desktop-"));
  try {
    const initial = loadDesktopConfig({ cwd });
    assert.equal(initial.theme, "pixel");
    assert.deepEqual(initial.position, {
      mode: "free",
      x: 1320,
      y: 820,
      corner: "bottom-right"
    });

    saveDesktopConfig(
      {
        ...initial,
        position: {
          mode: "free",
          x: 100,
          y: 200,
          corner: "bottom-right"
        }
      },
      { cwd }
    );

    assert.equal(loadDesktopConfig({ cwd }).position.x, 100);
    assert.equal(loadDesktopConfig({ cwd }).position.y, 200);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: 运行 desktop config 失败测试**

Run: `node --test tests/desktop-config.test.js`

Expected: FAIL with `Cannot find module '../src/desktop/desktop-config.js'`。

- [ ] **Step 8: 实现 desktop config 读写**

Create `src/desktop/desktop-config.js`:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  return mergeDesktopConfig(defaultDesktopConfig(), JSON.parse(readFileSync(path, "utf8")));
}

export function saveDesktopConfig(config, { cwd = process.cwd() } = {}) {
  const path = desktopConfigPath({ cwd });
  mkdirSync(join(cwd, CONFIG_DIR), { recursive: true });
  const normalized = mergeDesktopConfig(defaultDesktopConfig(), config);
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
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
```

- [ ] **Step 9: 跑 desktop config 测试确认通过**

Run: `node --test tests/desktop-config.test.js`

Expected: PASS。

- [ ] **Step 10: 跑配置相关测试**

Run: `node --test tests/project-config.test.js tests/desktop-config.test.js`

Expected: PASS。

- [ ] **Step 11: Commit**

```bash
git add src/config/project-config.js src/desktop/desktop-config.js tests/project-config.test.js tests/desktop-config.test.js
git commit -m "feat(config): 增加桌宠审批默认配置" -m "AI: Codex"
```

---

### Task 2: 增加规则解释器

**Files:**
- Create: `src/approval/instruction-rules.js`
- Test: `tests/approval-instruction-rules.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/approval-instruction-rules.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { interpretApprovalInstruction } from "../src/approval/instruction-rules.js";

test("interpretApprovalInstruction detects direct send phrases", () => {
  for (const text of ["发吧", "发送", "就这么发", "可以发"]) {
    assert.deepEqual(interpretApprovalInstruction(text), {
      action: "send"
    });
  }
});

test("interpretApprovalInstruction detects ignore phrases", () => {
  for (const text of ["忽略", "不用回", "先不回", "这个先不用回"]) {
    assert.deepEqual(interpretApprovalInstruction(text), {
      action: "ignore"
    });
  }
});

test("interpretApprovalInstruction treats other non-empty text as rewrite instruction", () => {
  assert.deepEqual(interpretApprovalInstruction("语气软一点"), {
    action: "rewrite",
    instruction: "语气软一点"
  });
});

test("interpretApprovalInstruction rejects empty input", () => {
  assert.deepEqual(interpretApprovalInstruction("   "), {
    action: "empty"
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/approval-instruction-rules.test.js`

Expected: FAIL with `Cannot find module '../src/approval/instruction-rules.js'`。

- [ ] **Step 3: 实现规则解释器**

Create `src/approval/instruction-rules.js`:

```js
const SEND_PHRASES = new Set(["发吧", "发送", "就这么发", "可以发"]);
const IGNORE_PHRASES = new Set(["忽略", "不用回", "先不回", "这个先不用回"]);

export function interpretApprovalInstruction(text = "") {
  const instruction = String(text).trim();
  if (!instruction) {
    return { action: "empty" };
  }
  if (SEND_PHRASES.has(instruction)) {
    return { action: "send" };
  }
  if (IGNORE_PHRASES.has(instruction)) {
    return { action: "ignore" };
  }
  return {
    action: "rewrite",
    instruction
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/approval-instruction-rules.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/approval/instruction-rules.js tests/approval-instruction-rules.test.js
git commit -m "feat(approval): 增加审批指令规则解释器" -m "AI: Codex"
```

---

### Task 3: 为 store 增加 pending 查询能力

**Files:**
- Modify: `src/workflow/sqlite-approval-store.js`
- Modify: `src/workflow/memory-approval-store.js`
- Test: `tests/sqlite-approval-store.test.js`

- [ ] **Step 1: 写 SQLite 失败测试**

Add to `tests/sqlite-approval-store.test.js`:

```js
test("SqliteApprovalStore lists pending approval requests newest first", () => {
  const store = new SqliteApprovalStore(":memory:");
  try {
    store.create({ id: "req-old", status: STATUS.PENDING_APPROVAL, messageId: "om-1" });
    store.create({ id: "req-sent", status: STATUS.SENT, messageId: "om-2" });
    store.create({ id: "req-new", status: STATUS.PENDING_APPROVAL, messageId: "om-3" });

    assert.deepEqual(
      store.pendingRequests().map((record) => record.id),
      ["req-new", "req-old"]
    );
  } finally {
    store.close();
  }
});
```

- [ ] **Step 2: 写 memory store 对应测试**

Add to `tests/personal-watch-service.test.js` or a new `tests/memory-approval-store.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { MemoryApprovalStore } from "../src/workflow/memory-approval-store.js";
import { STATUS } from "../src/workflow/status.js";

test("MemoryApprovalStore lists pending approval requests newest first", () => {
  const store = new MemoryApprovalStore();
  store.create({ id: "req-old", status: STATUS.PENDING_APPROVAL, messageId: "om-1" });
  store.create({ id: "req-sent", status: STATUS.SENT, messageId: "om-2" });
  store.create({ id: "req-new", status: STATUS.PENDING_APPROVAL, messageId: "om-3" });

  assert.deepEqual(
    store.pendingRequests().map((record) => record.id),
    ["req-new", "req-old"]
  );
});
```

- [ ] **Step 3: 运行失败测试**

Run: `node --test tests/sqlite-approval-store.test.js tests/memory-approval-store.test.js`

Expected: FAIL with `pendingRequests is not a function`。

- [ ] **Step 4: 实现 SQLite helper**

Add to `SqliteApprovalStore`:

```js
  pendingRequests() {
    return this.db
      .prepare("SELECT id, data FROM approval_requests ORDER BY rowid DESC")
      .all()
      .map((row) => ({
        id: row.id,
        ...JSON.parse(String(row.data))
      }))
      .filter((record) => record.status === "PENDING_APPROVAL");
  }
```

- [ ] **Step 5: 实现 memory helper**

Add to `MemoryApprovalStore`:

```js
  pendingRequests() {
    return [...this.records.values()]
      .map((record) => ({ ...record }))
      .reverse()
      .filter((record) => record.status === "PENDING_APPROVAL");
  }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node --test tests/sqlite-approval-store.test.js tests/memory-approval-store.test.js`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/workflow/sqlite-approval-store.js src/workflow/memory-approval-store.js tests/sqlite-approval-store.test.js tests/memory-approval-store.test.js
git commit -m "feat(workflow): 增加待审批请求查询能力" -m "AI: Codex"
```

---

### Task 4: 抽出 ApprovalController

**Files:**
- Create: `src/approval/approval-controller.js`
- Modify: `src/personal-watch/personal-watch-service.js`
- Test: `tests/approval-controller.test.js`
- Test: `tests/personal-watch-service.test.js`

- [ ] **Step 1: 写 controller 发送测试**

Create `tests/approval-controller.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { createApprovalController } from "../src/approval/approval-controller.js";
import { MemoryApprovalStore } from "../src/workflow/memory-approval-store.js";
import { STATUS } from "../src/workflow/status.js";

test("ApprovalController sends a pending draft with idempotency", async () => {
  const replies = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    draftText: "可以，我下午看。",
    senderId: "ou-target"
  });
  const controller = createApprovalController({
    store,
    imClient: {
      async replyText(reply) {
        replies.push(reply);
        return { message_id: "om-reply" };
      }
    },
    bridge: {},
    config: { replyAs: "user" }
  });

  const updated = await controller.send("req-1", "desktop-pet");

  assert.equal(updated.status, STATUS.SENT);
  assert.equal(updated.sentMessageId, "om-reply");
  assert.deepEqual(replies, [
    {
      as: "user",
      messageId: "om-source",
      text: "可以，我下午看。",
      idempotencyKey: "reply-req-1"
    }
  ]);
});
```

- [ ] **Step 2: 写指令改写测试**

Add to `tests/approval-controller.test.js`:

```js
test("ApprovalController rewrites non-command instructions and keeps request pending", async () => {
  const handled = [];
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-1",
    eventId: "evt-1",
    status: STATUS.PENDING_APPROVAL,
    messageId: "om-source",
    senderId: "ou-target",
    chatId: "ou-target",
    text: "这个方案我下午能看一下吗？",
    draftText: "可以，我下午看。",
    contextSummary: "对方想确认你是否能看方案。"
  });
  const controller = createApprovalController({
    store,
    imClient: {},
    bridge: {
      async handleLarkMessage(message) {
        handled.push(message);
        return { text: `改后：${message.rewriteInstruction}`, channel: "codex" };
      }
    },
    config: {}
  });

  const result = await controller.handleInstruction({
    requestId: "req-1",
    instruction: "语气软一点",
    actor: "desktop-pet"
  });

  assert.equal(result.action, "rewrite");
  assert.equal(result.request.status, STATUS.PENDING_APPROVAL);
  assert.equal(result.request.draftText, "改后：语气软一点");
  assert.equal(handled[0].previousDraftText, "可以，我下午看。");
  assert.equal(handled[0].rewriteInstruction, "语气软一点");
});
```

- [ ] **Step 3: 写过期保护测试**

Add:

```js
test("ApprovalController refuses to send superseded requests", async () => {
  const store = new MemoryApprovalStore();
  store.create({
    id: "req-old",
    status: STATUS.SUPERSEDED,
    messageId: "om-source",
    draftText: "旧建议"
  });
  const controller = createApprovalController({
    store,
    imClient: {
      async replyText() {
        throw new Error("should not send superseded requests");
      }
    },
    bridge: {},
    config: {}
  });

  const result = await controller.send("req-old", "desktop-pet");

  assert.equal(result.status, STATUS.SUPERSEDED);
});
```

- [ ] **Step 4: 运行失败测试**

Run: `node --test tests/approval-controller.test.js`

Expected: FAIL with `Cannot find module '../src/approval/approval-controller.js'`。

- [ ] **Step 5: 实现 controller**

Create `src/approval/approval-controller.js`:

```js
import { interpretApprovalInstruction } from "./instruction-rules.js";
import { STATUS } from "../workflow/status.js";

export function createApprovalController({ store, imClient, bridge, config = {} }) {
  return {
    listPending() {
      return store.pendingRequests();
    },

    getRequest(requestId) {
      return store.get(requestId);
    },

    async send(requestId, actor = "desktop-pet") {
      const record = store.get(requestId);
      if (!record) {
        throw new Error(`approval request not found: ${requestId}`);
      }
      store.log(requestId, "approval_send_requested", { actor });
      if (record.status !== STATUS.PENDING_APPROVAL) {
        return record;
      }
      const sent = await imClient.replyText({
        as: config.replyAs ?? "user",
        messageId: record.messageId,
        text: record.draftText,
        idempotencyKey: `reply-${requestId}`
      });
      const updated = store.update(requestId, {
        status: STATUS.SENT,
        approvedBy: actor,
        sentMessageId: sent.message_id
      });
      store.log(requestId, "sent", { actor, messageId: sent.message_id });
      return updated;
    },

    async ignore(requestId, actor = "desktop-pet") {
      const record = store.get(requestId);
      if (!record) {
        throw new Error(`approval request not found: ${requestId}`);
      }
      store.log(requestId, "approval_ignore_requested", { actor });
      if (record.status !== STATUS.PENDING_APPROVAL) {
        return record;
      }
      return store.update(requestId, {
        status: STATUS.IGNORED,
        ignoredBy: actor
      });
    },

    async handleInstruction({ requestId, instruction, actor = "desktop-pet" }) {
      const interpreted = interpretApprovalInstruction(instruction);
      store.log(requestId, "approval_instruction_received", { actor, interpreted });
      if (interpreted.action === "empty") {
        return { action: "empty", request: store.get(requestId) };
      }
      if (interpreted.action === "send") {
        return { action: "send", request: await this.send(requestId, actor) };
      }
      if (interpreted.action === "ignore") {
        return { action: "ignore", request: await this.ignore(requestId, actor) };
      }
      return {
        action: "rewrite",
        request: await rewriteRequest({
          requestId,
          instruction: interpreted.instruction,
          actor,
          store,
          bridge
        })
      };
    }
  };
}

async function rewriteRequest({ requestId, instruction, actor, store, bridge }) {
  const record = store.get(requestId);
  if (!record) {
    throw new Error(`approval request not found: ${requestId}`);
  }
  if (record.status !== STATUS.PENDING_APPROVAL) {
    return record;
  }
  store.update(requestId, {
    uiState: "thinking",
    rewriteInstruction: instruction,
    requestedBy: actor
  });
  const draft = await bridge.handleLarkMessage({
    eventId: record.eventId,
    senderId: record.senderId,
    chatId: record.chatId,
    messageId: record.messageId,
    text: record.text,
    rewriteInstruction: instruction,
    previousDraftText: record.draftText
  });
  const updated = store.update(requestId, {
    status: STATUS.PENDING_APPROVAL,
    uiState: "pending",
    draftText: draft.text,
    channel: draft.channel,
    rewriteInstruction: instruction,
    requestedBy: actor
  });
  store.log(requestId, "rewritten", { actor, instruction });
  return updated;
}
```

- [ ] **Step 6: 让 PersonalWatchService 委托 controller**

Modify constructor to accept `approvalController`:

```js
  constructor({ store, imClient, bridge, contactClient, approvalController, approvalSurface, config = {}, configProvider, now = () => new Date() }) {
    this.store = store;
    this.imClient = imClient;
    this.contactClient = contactClient;
    this.bridge = bridge;
    this.approvalController = approvalController;
    this.approvalSurface = approvalSurface;
```

Inside `handleConfirmationText`, replace send/ignore/rewrite branches with calls to `this.approvalController` when present, keeping existing fallback for tests until all callers are migrated:

```js
    if (this.approvalController) {
      if (command.action === "send") {
        const request = await this.approvalController.send(command.requestId, "lark-bot");
        return { requestId: command.requestId, status: request.status };
      }
      if (command.action === "ignore") {
        const request = await this.approvalController.ignore(command.requestId, "lark-bot");
        return { requestId: command.requestId, status: request.status };
      }
      if (command.action === "rewrite") {
        const result = await this.approvalController.handleInstruction({
          requestId: command.requestId,
          instruction: command.instruction,
          actor: "lark-bot"
        });
        return { requestId: command.requestId, status: result.request.status };
      }
    }
```

- [ ] **Step 7: 跑 controller 和现有 service 测试**

Run: `node --test tests/approval-controller.test.js tests/personal-watch-service.test.js`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/approval/approval-controller.js src/personal-watch/personal-watch-service.js tests/approval-controller.test.js tests/personal-watch-service.test.js
git commit -m "feat(approval): 抽出统一审批控制器" -m "AI: Codex"
```

---

### Task 5: 抽象 ApprovalSurface 并保留飞书 bot fallback

**Files:**
- Create: `src/approval/lark-bot-approval-surface.js`
- Create: `src/approval/desktop-approval-surface.js`
- Create: `src/desktop/desktop-event-bus.js`
- Modify: `src/personal-watch/personal-watch-service.js`
- Test: `tests/personal-watch-service.test.js`

- [ ] **Step 1: 写 desktop surface 通知测试**

Add:

```js
test("PersonalWatchService notifies desktop approval surface without sending bot markdown", async () => {
  const surfaceEvents = [];
  const store = new MemoryApprovalStore();
  const service = new PersonalWatchService({
    store,
    imClient: {
      async listP2pMessages() {
        return [
          {
            messageId: "om-1",
            createdAt: "1779811200000",
            senderId: "ou-target",
            messageType: "text",
            text: "这个方案我下午能看一下吗？"
          }
        ];
      },
      async sendMarkdown() {
        throw new Error("desktop surface should not send bot markdown");
      }
    },
    bridge: {
      async handleLarkMessage() {
        return { text: "可以，我下午先看一版。", channel: "codex" };
      }
    },
    approvalSurface: {
      async notifyPending(request) {
        surfaceEvents.push(request);
        return { surface: "desktop-pet" };
      }
    },
    config: {
      targetUserIds: ["ou-target"],
      selfUserId: "ou-me",
      lookbackMinutes: 10,
      quietWindowSeconds: 0
    },
    now: () => new Date("2026-05-27T10:10:00+08:00")
  });

  await service.pollOnce();

  assert.equal(surfaceEvents.length, 1);
  assert.equal(surfaceEvents[0].draftText, "可以，我下午先看一版。");
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/personal-watch-service.test.js --test-name-pattern "desktop approval surface"`

Expected: FAIL，因为 service 仍调用 `notifySelf` 或没有使用 `approvalSurface`。

- [ ] **Step 3: 实现 event bus**

Create `src/desktop/desktop-event-bus.js`:

```js
import { EventEmitter } from "node:events";

export class DesktopEventBus extends EventEmitter {
  publish(event) {
    this.emit("event", event);
  }

  subscribe(listener) {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}
```

- [ ] **Step 4: 实现 desktop surface**

Create `src/approval/desktop-approval-surface.js`:

```js
export class DesktopApprovalSurface {
  constructor({ eventBus }) {
    this.eventBus = eventBus;
  }

  async notifyPending(request) {
    this.eventBus.publish({
      type: "pending",
      request
    });
    return { surface: "desktop-pet" };
  }

  async notifyExpired(requestId) {
    this.eventBus.publish({
      type: "expired",
      requestId
    });
  }
}
```

- [ ] **Step 5: 移动飞书 bot Markdown surface**

Create `src/approval/lark-bot-approval-surface.js` by moving `buildNotificationMarkdown` behavior out of `PersonalWatchService`:

```js
export class LarkBotApprovalSurface {
  constructor({ imClient, contactClient, config = {} }) {
    this.imClient = imClient;
    this.contactClient = contactClient;
    this.config = config;
  }

  async notifyPending(request) {
    const senderName = await this.resolveDisplayName(request.senderId);
    const markdown = buildNotificationMarkdown({
      requestId: request.id,
      senderName,
      targetUserId: request.senderId,
      sourceText: request.text,
      contextSummary: request.contextSummary,
      draftText: request.draftText
    });
    const result = await this.imClient.sendMarkdown({
      as: this.config.notifyAs ?? "bot",
      userId: this.config.selfUserId,
      markdown,
      idempotencyKey: `notify-${request.id}`
    });
    return {
      surface: "lark-bot",
      messageId: result.message_id
    };
  }

  async notifyExpired(requestId) {
    const markdown = [
      "**Suggestion expired**",
      "",
      `requestId: \\`${requestId}\\``,
      "",
      "A newer message has arrived in this conversation. Use the requestId from the latest notification."
    ].join("\\n");
    await this.imClient.sendMarkdown({
      as: this.config.notifyAs ?? "bot",
      userId: this.config.selfUserId,
      markdown,
      idempotencyKey: `expired-${requestId}`
    });
  }

  async resolveDisplayName(openId) {
    if (!this.contactClient || !openId || openId.startsWith("oc_")) {
      return openId;
    }
    return this.contactClient.getDisplayName(openId);
  }
}
```

Move the current `buildNotificationMarkdown` helper into this file, export it, and update any direct tests to import it from `src/approval/lark-bot-approval-surface.js`.

- [ ] **Step 6: 修改 PersonalWatchService 使用 approvalSurface**

In `processBatch`, replace `this.notifySelf(...)` with:

```js
      const notification = this.approvalSurface
        ? await this.approvalSurface.notifyPending(this.store.get(requestId))
        : await this.notifySelf({
            requestId,
            targetUserId: message.senderId,
            sourceText: message.text,
            contextSummary,
            draftText: draft.text
          });
      this.store.update(requestId, {
        approvalSurface: notification.surface ?? "lark-bot",
        approvalMessageId: notification.messageId ?? notification.message_id
      });
```

- [ ] **Step 7: 跑测试**

Run: `node --test tests/personal-watch-service.test.js`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/approval/lark-bot-approval-surface.js src/approval/desktop-approval-surface.js src/desktop/desktop-event-bus.js src/personal-watch/personal-watch-service.js tests/personal-watch-service.test.js
git commit -m "feat(approval): 增加桌宠审批通知面" -m "AI: Codex"
```

---

### Task 6: 增加本地桌宠 API

**Files:**
- Create: `src/desktop/desktop-api-server.js`
- Modify: `src/cli.js`
- Test: `tests/desktop-api-server.test.js`
- Test: `tests/cli.test.js`

- [ ] **Step 1: 写 API 测试**

Create `tests/desktop-api-server.test.js`:

```js
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
    store,
    controller: {
      listPending: () => store.pendingRequests(),
      async send(requestId, actor) {
        sent.push({ requestId, actor });
        return store.update(requestId, { status: STATUS.SENT, sentMessageId: "om-reply" });
      }
    }
  });
  await server.listen(0);
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const list = await fetch(`${baseUrl}/api/requests/pending`).then((response) => response.json());
    assert.equal(list.requests[0].id, "req-1");

    const result = await fetch(`${baseUrl}/api/requests/req-1/send`, { method: "POST" }).then((response) => response.json());
    assert.equal(result.request.status, STATUS.SENT);
    assert.deepEqual(sent, [{ requestId: "req-1", actor: "desktop-pet" }]);
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/desktop-api-server.test.js`

Expected: FAIL with `Cannot find module '../src/desktop/desktop-api-server.js'`。

- [ ] **Step 3: 实现 API server**

Create `src/desktop/desktop-api-server.js`:

```js
import http from "node:http";

export function createDesktopApiServer({ store, controller, eventBus }) {
  const server = http.createServer(async (req, res) => {
    try {
      await route({ req, res, store, controller, eventBus });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });

  return {
    get port() {
      return server.address().port;
    },
    listen(port = 3017, host = "127.0.0.1") {
      return new Promise((resolve) => server.listen(port, host, resolve));
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function route({ req, res, store, controller, eventBus }) {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { status: "UP" });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/requests/pending") {
    sendJson(res, 200, { requests: controller.listPending() });
    return;
  }
  const action = url.pathname.match(/^\\/api\\/requests\\/([^/]+)\\/(send|ignore|instruction)$/);
  if (action && req.method === "POST") {
    const requestId = decodeURIComponent(action[1]);
    if (action[2] === "send") {
      sendJson(res, 200, { request: await controller.send(requestId, "desktop-pet") });
      return;
    }
    if (action[2] === "ignore") {
      sendJson(res, 200, { request: await controller.ignore(requestId, "desktop-pet") });
      return;
    }
    const body = await readJson(req);
    sendJson(res, 200, await controller.handleInstruction({
      requestId,
      instruction: body.instruction,
      actor: "desktop-pet"
    }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    const unsubscribe = eventBus?.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\\n\\n`);
    });
    req.on("close", () => unsubscribe?.());
    return;
  }
  sendJson(res, 404, { error: "not found" });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}
```

- [ ] **Step 4: 增加 CLI 命令测试**

Add to `tests/cli.test.js`:

```js
test("CLI desktop-api validates runtime config before starting", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const errors = [];
  try {
    const deps = { cwd, stderr: (line) => errors.push(line) };
    await runCli(["config", "init"], deps);

    const result = await runCli(["desktop-api"], deps);

    assert.equal(result.exitCode, 1);
    assert.match(errors.at(-1), /missing config: lark.app.appId/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: 实现 CLI `desktop-api`**

In `src/cli.js`, import API pieces and add a group branch:

```js
import { createApprovalController } from "./approval/approval-controller.js";
import { DesktopApprovalSurface } from "./approval/desktop-approval-surface.js";
import { DesktopEventBus } from "./desktop/desktop-event-bus.js";
import { createDesktopApiServer } from "./desktop/desktop-api-server.js";
```

In `runCli`:

```js
    if (group === "desktop-api") {
      return await handleDesktopApi(io);
    }
```

Add:

```js
async function handleDesktopApi(io) {
  const config = loadProjectConfig({ cwd: io.cwd });
  validateRuntimeConfig(config);
  const serviceBundle = createWatchService(config, io, { desktopSurface: true });
  const server = createDesktopApiServer({
    store: serviceBundle.store,
    controller: serviceBundle.approvalController,
    eventBus: serviceBundle.eventBus
  });
  await server.listen(config.desktop?.apiPort ?? 3017);
  io.stdout(`desktop-api started port=${server.port}`);
  return { exitCode: 0 };
}
```

Update `createWatchService` to return a bundle when needed:

```js
function createWatchService(config, io, options = {}) {
  // existing setup
  const eventBus = options.desktopSurface ? new DesktopEventBus() : undefined;
  const approvalController = createApprovalController({
    store,
    imClient,
    bridge,
    config: personalWatchConfig(config)
  });
  const approvalSurface = options.desktopSurface
    ? new DesktopApprovalSurface({ eventBus })
    : undefined;
  const service = new PersonalWatchService({
    store,
    imClient,
    contactClient,
    bridge,
    approvalController,
    approvalSurface,
    config: personalWatchConfig(config),
    configProvider: () => personalWatchConfig(loadProjectConfig({ cwd: io.cwd }))
  });
  return options.desktopSurface ? { service, store, approvalController, eventBus } : service;
}
```

- [ ] **Step 6: 跑测试**

Run: `node --test tests/desktop-api-server.test.js tests/cli.test.js`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/desktop/desktop-api-server.js src/cli.js tests/desktop-api-server.test.js tests/cli.test.js
git commit -m "feat(desktop): 增加本地桌宠审批 API" -m "AI: Codex"
```

---

### Task 7: 增加 Tauri 桌宠 UI

**Files:**
- Create: `desktop/index.html`
- Create: `desktop/styles.css`
- Create: `desktop/main.js`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Modify: `package.json`

- [ ] **Step 1: 安装 Tauri CLI**

Run:

```bash
npm install --save-dev @tauri-apps/cli
```

Expected: `package.json` 和 `package-lock.json` 增加 `@tauri-apps/cli`。

- [ ] **Step 2: 更新 package scripts**

Modify `package.json` scripts:

```json
{
  "desktop:dev": "tauri dev",
  "desktop:build": "tauri build"
}
```

Keep existing `start`, `cli`, `watch`, `poll-once`, `test`, and `typecheck`.

- [ ] **Step 3: 创建 Tauri 配置**

Create `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "ReplyPilot",
  "version": "0.1.0",
  "identifier": "com.yonoel.replypilot",
  "build": {
    "frontendDist": "../desktop",
    "devUrl": "../desktop/index.html"
  },
  "app": {
    "windows": [
      {
        "title": "ReplyPilot",
        "width": 520,
        "height": 360,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "resizable": false,
        "skipTaskbar": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all"
  }
}
```

- [ ] **Step 4: 创建 Rust 入口**

Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "replypilot"
version = "0.1.0"
description = "ReplyPilot desktop pet"
authors = ["yonoel"]
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
```

Create `src-tauri/src/main.rs`:

```rust
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: 创建 HTML**

Create `desktop/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ReplyPilot</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main id="pet" class="pet-shell state-idle">
      <section class="card" id="approval-card" hidden>
        <div class="row">
          <span class="label">发件人</span>
          <strong id="sender">-</strong>
        </div>
        <div class="row">
          <span class="label">原始消息</span>
          <p id="source-text"></p>
        </div>
        <div class="row">
          <span class="label">建议回复</span>
          <p id="draft-text"></p>
          <button id="copy-draft" type="button">复制</button>
        </div>
        <form id="instruction-form" class="instruction">
          <input id="instruction" name="instruction" placeholder="告诉我怎么处理..." autocomplete="off" />
          <button type="submit">➤</button>
        </form>
        <p id="helper" class="helper">输入要求后会改写建议回复</p>
        <div class="actions">
          <button id="send" type="button">发送</button>
          <button id="ignore" type="button">忽略</button>
        </div>
      </section>
      <button id="sprite" class="sprite" type="button" aria-label="ReplyPilot">
        <span class="antenna"></span>
        <span class="face"><span class="eye"></span><span class="eye"></span></span>
        <span id="badge" class="badge" hidden>1</span>
      </button>
    </main>
    <script type="module" src="./main.js"></script>
  </body>
</html>
```

- [ ] **Step 6: 创建 CSS**

Create `desktop/styles.css` with the pixel robot and card:

```css
:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  background: transparent;
}

html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
}

.pet-shell {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: end;
  gap: 10px;
}

.sprite {
  position: relative;
  width: 76px;
  height: 88px;
  border: 0;
  background: transparent;
  cursor: grab;
  image-rendering: pixelated;
}

.sprite::before {
  content: "";
  position: absolute;
  left: 11px;
  top: 24px;
  width: 54px;
  height: 46px;
  border: 4px solid #1d2733;
  border-radius: 14px;
  background: #eef4fb;
  box-shadow: inset 0 -6px #c9d6e6;
}

.antenna {
  position: absolute;
  left: 34px;
  top: 7px;
  width: 8px;
  height: 18px;
  background: #1d2733;
}

.antenna::before {
  content: "";
  position: absolute;
  left: -4px;
  top: -7px;
  width: 16px;
  height: 12px;
  background: #1d8cff;
  border: 3px solid #1d2733;
}

.face {
  position: absolute;
  left: 18px;
  top: 32px;
  width: 40px;
  height: 27px;
  border-radius: 8px;
  background: #101823;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.eye {
  width: 7px;
  height: 10px;
  background: #52c8ff;
  box-shadow: 0 0 8px #52c8ff;
}

.state-thinking .eye {
  height: 4px;
}

.state-sending .eye:first-child {
  transform: rotate(35deg);
}

.state-error .eye {
  background: #ff5b5b;
  box-shadow: 0 0 8px #ff5b5b;
}

.badge {
  position: absolute;
  right: 5px;
  top: 18px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #ef3340;
  color: #fff;
  font-weight: 700;
  line-height: 24px;
  text-align: center;
}

.card {
  width: 360px;
  padding: 16px;
  border: 1px solid rgba(32, 44, 62, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
}

.row {
  display: grid;
  grid-template-columns: 78px 1fr auto;
  gap: 10px;
  align-items: start;
  padding: 8px 0;
  border-bottom: 1px solid #edf1f5;
}

.label {
  color: #526070;
  font-size: 13px;
}

p {
  margin: 0;
  line-height: 1.45;
}

.instruction {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.instruction input {
  flex: 1;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid #ccd6e3;
  border-radius: 8px;
}

button {
  border: 1px solid #ccd6e3;
  border-radius: 8px;
  background: #fff;
  padding: 8px 12px;
}

#send {
  color: #fff;
  border-color: #1f6feb;
  background: #1f6feb;
}

.helper {
  margin-top: 8px;
  color: #697586;
  font-size: 12px;
}

.actions {
  display: flex;
  justify-content: end;
  gap: 8px;
  margin-top: 12px;
}

.state-thinking #send,
.state-thinking #ignore,
.state-sending #send,
.state-sending #ignore {
  opacity: 0.5;
  pointer-events: none;
}
```

- [ ] **Step 7: 创建前端 JS**

Create `desktop/main.js`:

```js
const API_BASE = "http://127.0.0.1:3017";

const state = {
  current: undefined
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

document.querySelector("#sprite").addEventListener("click", () => {
  if (state.current) {
    card.hidden = !card.hidden;
  }
});

document.querySelector("#send").addEventListener("click", async () => {
  await action("send");
});

document.querySelector("#ignore").addEventListener("click", async () => {
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
  setPetState("thinking");
  helper.textContent = "思考中：按你的要求改写...";
  const response = await fetch(`${API_BASE}/api/requests/${state.current.id}/instruction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction: value })
  });
  const body = await response.json();
  instruction.value = "";
  renderRequest(body.request);
});

async function action(name) {
  if (!state.current) {
    return;
  }
  setPetState(name === "send" ? "sending" : "pending");
  const response = await fetch(`${API_BASE}/api/requests/${state.current.id}/${name}`, { method: "POST" });
  const body = await response.json();
  if (body.request.status === "SENT" || body.request.status === "IGNORED") {
    state.current = undefined;
    card.hidden = true;
    badge.hidden = true;
    setPetState("idle");
    await loadPending();
    return;
  }
  renderRequest(body.request);
}

async function loadPending() {
  const response = await fetch(`${API_BASE}/api/requests/pending`);
  const body = await response.json();
  renderRequest(body.requests[0]);
  badge.textContent = String(body.requests.length);
  badge.hidden = body.requests.length === 0;
}

function renderRequest(request) {
  state.current = request;
  if (!request) {
    card.hidden = true;
    setPetState("idle");
    return;
  }
  sender.textContent = request.senderName || request.senderId || request.chatId || "-";
  sourceText.textContent = request.text || "";
  draftText.textContent = request.draftText || "";
  helper.textContent = "输入要求后会改写建议回复";
  card.hidden = false;
  badge.hidden = false;
  setPetState(request.uiState === "thinking" ? "thinking" : "pending");
}

function setPetState(name) {
  pet.className = `pet-shell state-${name}`;
}

function connectEvents() {
  const events = new EventSource(`${API_BASE}/api/events`);
  events.onmessage = () => {
    void loadPending();
  };
  events.onerror = () => {
    setPetState("error");
  };
}

void loadPending();
connectEvents();
```

- [ ] **Step 8: 运行桌宠开发模式**

Run: `npm run desktop:dev`

Expected: Tauri window opens as a transparent, borderless, always-on-top desktop pet. If Rust/Tauri prerequisites are missing, stop and report exact prerequisite error; do not claim desktop verification passed.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json desktop src-tauri
git commit -m "feat(desktop): 增加 Tauri 桌面小精灵界面" -m "AI: Codex"
```

---

### Task 8: 集成 watcher、API 和桌宠 surface

**Files:**
- Modify: `src/cli.js`
- Modify: `README.md`
- Test: `tests/cli.test.js`

- [ ] **Step 1: 写 watch 集成测试**

Add to `tests/cli.test.js`:

```js
test("CLI watch can start with desktop approval surface", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-cli-"));
  const output = [];
  const created = [];
  try {
    const deps = {
      cwd,
      stdout: (line) => output.push(line),
      createPersonalWatchService({ config, approvalSurface, approvalController }) {
        created.push({ config, approvalSurface, approvalController });
        return {
          start() {}
        };
      },
      createEventSource() {
        return {
          async start() {}
        };
      }
    };

    await runCli(["config", "init"], deps);
    await runCli(["lark", "app", "set", "--app-id", "cli_app", "--app-secret", "secret_1"], deps);
    await runCli(["lark", "user", "set", "--open-id", "ou-me"], deps);
    await runCli(["lark", "listeners", "add", "--open-id", "ou-target"], deps);

    const result = await runCli(["watch", "--desktop"], deps);

    assert.equal(result.exitCode, 0);
    assert.ok(created[0].approvalSurface);
    assert.ok(created[0].approvalController);
    assert.match(output.at(-1), /watch started/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/cli.test.js --test-name-pattern "desktop approval surface"`

Expected: FAIL because `watch --desktop` is not wired.

- [ ] **Step 3: 修改 CLI 参数解析**

In `handleWatch(io, args = [])`, detect:

```js
const desktop = args.includes("--desktop");
const serviceOrBundle = createWatchService(config, io, { desktopSurface: desktop });
const service = serviceOrBundle.service ?? serviceOrBundle;
```

In `runCli`, pass args:

```js
    if (group === "watch") {
      return await handleWatch(io, argv.slice(1));
    }
```

- [ ] **Step 4: 更新 README**

Add a section:

````markdown
## Desktop Pet

ReplyPilot V1 can run with a desktop approval surface:

```bash
npm run cli -- watch --desktop
npm run desktop:dev
```

The first command keeps the Lark watcher, approval controller, desktop event bus, and local desktop API running. The Tauri app is the user-facing surface. The old Lark bot confirmation command path remains available as fallback when configured.

The desktop pet does not show a thinking state for the first incoming message. It waits until the suggested reply is ready, then shows the original message and suggested reply directly. It only shows "思考中" after the user asks for a rewrite.
````

- [ ] **Step 5: 跑 CLI 测试**

Run: `node --test tests/cli.test.js`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/cli.js README.md tests/cli.test.js
git commit -m "feat(desktop): 串联 watcher 与桌宠审批面" -m "AI: Codex"
```

---

### Task 9: 验证与真实 E2E

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 跑全部本地测试**

Run:

```bash
npm test
```

Expected: PASS，包括 `npm run typecheck` 和 `node --test tests/**/*.test.js`。

- [ ] **Step 2: 跑桌宠构建检查**

Run:

```bash
npm run desktop:build
```

Expected: PASS，或如果本机缺 Tauri/Rust/macOS 环境，记录完整错误并停止桌面完成声明。

- [ ] **Step 3: 做本地 API smoke**

Run:

```bash
npm run cli -- desktop-api
```

In another terminal:

```bash
curl -s http://127.0.0.1:3017/api/health
```

Expected:

```json
{"status":"UP"}
```

- [ ] **Step 4: 做真实飞书前置 guard**

Run:

```bash
npm run cli -- config show
npm run cli -- auth-check
```

Expected:
- `config show` redacts `appSecret` as `***`。
- `auth-check` dry-run passes. This is only a guard, not E2E completion.

- [ ] **Step 5: 做真实飞书 E2E**

Run:

```bash
npm run cli -- watch --desktop
npm run desktop:dev
```

Then:
1. From the configured listener contact/chat, send: `这个方案我下午能看一下吗？`
2. Wait until desktop pet shows the original message and suggested reply.
3. Type `语气软一点` in the desktop pet input.
4. Confirm pet enters `思考中`.
5. Wait for new suggestion.
6. Click `发送`.

Expected:
- Feishu original message receives a real user reply.
- Desktop pet returns to `空闲` or next `待处理`.
- Logs show `SENT`.

- [ ] **Step 6: 回读 SQLite 证据**

Run:

```bash
npm run cli -- logs list --limit 10
npm run cli -- logs show --request-id <request-id>
```

Expected:
- request status is `SENT`.
- request includes `sentMessageId`.
- logs include instruction/rewrite events if rewrite was used.

- [ ] **Step 7: 更新 README 验收说明**

Add:

````markdown
### Desktop Pet E2E Evidence

The desktop pet path is considered verified only when all of these are true:

- A real configured Lark message creates a pending request.
- The desktop pet shows the message and suggested reply after drafting finishes.
- A rewrite instruction shows the pet's thinking state and produces a new draft.
- Sending from the desktop pet creates a real user reply in Lark.
- `logs show` confirms `SENT` and `sentMessageId`.

Dry-run auth checks, local API health, mock tests, and Tauri window launch are separate checks and do not count as real Lark E2E completion.
````

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs(desktop): 补充桌宠真实验收说明" -m "AI: Codex"
```

---

## 自查记录

**规格覆盖：**
- 桌宠视觉：Task 7。
- 五个状态及思考中语义：Task 7、Task 9。
- 规则解释器：Task 2、Task 4。
- 审批器边界：Task 4、Task 5。
- SQLite 状态中心：Task 3、Task 4。
- Tauri 桌宠壳：Task 7。
- 旧飞书 bot fallback：Task 5、Task 8。
- 真实验收边界：End-to-End Acceptance Plan、Task 9。

**占位扫描：**
本文档每个任务都包含具体文件、命令和期望结果，未留下需要执行者自行补全的步骤。

**E2E：**
适用，并已写清真实飞书触发、桌面 UI controller 需求、发送副作用 guard 和远端回读证据。

**类型一致性：**
计划中统一使用 `ApprovalController`、`ApprovalSurface`、`DesktopApprovalSurface`、`LarkBotApprovalSurface`、`DesktopEventBus`、`interpretApprovalInstruction`、`uiState`、`approval.allowDirectSendByInstruction`。
