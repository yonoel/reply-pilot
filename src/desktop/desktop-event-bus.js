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
