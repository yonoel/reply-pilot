export class MemoryApprovalStore {
  constructor() {
    this.records = new Map();
    this.entries = [];
    this.watermarks = new Map();
  }

  create(record) {
    this.records.set(record.id, { ...record });
    this.log(record.id, "created", { status: record.status });
    return this.get(record.id);
  }

  get(id) {
    const record = this.records.get(id);
    return record ? { ...record } : undefined;
  }

  update(id, patch) {
    const current = this.records.get(id);
    if (!current) {
      throw new Error(`approval request not found: ${id}`);
    }
    const updated = { ...current, ...patch };
    this.records.set(id, updated);
    this.log(id, "updated", patch);
    return this.get(id);
  }

  log(requestId, event, data = {}) {
    this.entries.push({
      requestId,
      event,
      data
    });
  }

  logs(requestId) {
    return this.entries.filter((entry) => entry.requestId === requestId).map((entry) => ({ ...entry }));
  }

  pendingRequests() {
    return [...this.records.values()]
      .map((record) => ({ ...record }))
      .reverse()
      .filter(isVisibleDesktopRequest);
  }

  getWatermark(targetUserId) {
    const watermark = this.watermarks.get(targetUserId);
    return watermark ? { ...watermark } : undefined;
  }

  setWatermark(targetUserId, watermark) {
    this.watermarks.set(targetUserId, { ...watermark });
    return this.getWatermark(targetUserId);
  }
}

function isVisibleDesktopRequest(record) {
  return record.status === "PENDING_APPROVAL" || (record.status === "RECEIVED" && record.uiState === "thinking");
}
