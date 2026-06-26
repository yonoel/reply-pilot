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

  async notifyDrafting(request) {
    this.eventBus.publish({
      type: "drafting",
      request
    });
    return { surface: "desktop-pet" };
  }

  async notifyExpired(requestId, request = undefined) {
    this.eventBus.publish({
      type: "expired",
      requestId,
      request
    });
  }
}
