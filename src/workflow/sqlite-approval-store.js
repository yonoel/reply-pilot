import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class SqliteApprovalStore {
  constructor(path = "reply-pilot.sqlite") {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        event TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS watch_watermarks (
        target_user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
  }

  create(record) {
    this.db
      .prepare("INSERT INTO approval_requests (id, data) VALUES (?, ?)")
      .run(record.id, JSON.stringify(record));
    this.log(record.id, "created", { status: record.status });
    return this.get(record.id);
  }

  get(id) {
    const row = this.db.prepare("SELECT data FROM approval_requests WHERE id = ?").get(id);
    return row ? JSON.parse(String(row.data)) : undefined;
  }

  update(id, patch) {
    const current = this.get(id);
    if (!current) {
      throw new Error(`approval request not found: ${id}`);
    }
    const updated = { ...current, ...patch };
    this.db.prepare("UPDATE approval_requests SET data = ? WHERE id = ?").run(JSON.stringify(updated), id);
    this.log(id, "updated", patch);
    return updated;
  }

  log(requestId, event, data = {}) {
    this.db
      .prepare("INSERT INTO execution_logs (request_id, event, data) VALUES (?, ?, ?)")
      .run(requestId, event, JSON.stringify(data));
  }

  logs(requestId) {
    return this.db
      .prepare("SELECT request_id, event, data FROM execution_logs WHERE request_id = ? ORDER BY id")
      .all(requestId)
      .map((row) => ({
        requestId: row.request_id,
        event: row.event,
        data: JSON.parse(String(row.data))
      }));
  }

  recentLogs(limit = 20) {
    return this.db
      .prepare("SELECT request_id, event, data, created_at FROM execution_logs ORDER BY id DESC LIMIT ?")
      .all(limit)
      .map((row) => ({
        requestId: row.request_id,
        event: row.event,
        data: JSON.parse(String(row.data)),
        createdAt: row.created_at
      }));
  }

  recentRequests(limit = 20) {
    return this.db
      .prepare("SELECT id, data FROM approval_requests ORDER BY rowid DESC LIMIT ?")
      .all(limit)
      .map((row) => ({
        id: row.id,
        ...JSON.parse(String(row.data))
      }));
  }

  pendingRequests() {
    return this.db
      .prepare("SELECT id, data FROM approval_requests ORDER BY rowid DESC")
      .all()
      .map((row) => ({
        id: row.id,
        ...JSON.parse(String(row.data))
      }))
      .filter(isVisibleDesktopRequest);
  }

  getWatermark(targetUserId) {
    const row = this.db.prepare("SELECT data FROM watch_watermarks WHERE target_user_id = ?").get(targetUserId);
    return row ? JSON.parse(String(row.data)) : undefined;
  }

  setWatermark(targetUserId, watermark) {
    this.db
      .prepare(
        "INSERT INTO watch_watermarks (target_user_id, data) VALUES (?, ?) ON CONFLICT(target_user_id) DO UPDATE SET data = excluded.data"
      )
      .run(targetUserId, JSON.stringify(watermark));
    return this.getWatermark(targetUserId);
  }

  close() {
    this.db.close();
  }
}

function isVisibleDesktopRequest(record) {
  return record.status === "PENDING_APPROVAL" || (record.status === "RECEIVED" && record.uiState === "thinking");
}
