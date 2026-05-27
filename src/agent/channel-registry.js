import { HermesLocalChannel } from "./channels/hermes-local-channel.js";
import { OllamaLocalChannel } from "./channels/ollama-local-channel.js";

export function createAgentChannel(config = {}) {
  switch (config.type) {
    case "hermes":
      return new HermesLocalChannel(config.hermes);
    case "ollama":
      return new OllamaLocalChannel(config.ollama);
    default:
      throw new Error(`unsupported agent channel: ${config.type ?? "unknown"}`);
  }
}
