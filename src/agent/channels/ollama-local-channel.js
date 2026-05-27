import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildAgentPrompt } from "./prompt-rendering.js";

const execFileAsync = promisify(execFile);

export class OllamaLocalChannel {
  constructor({
    command = "ollama",
    model = "",
    promptTemplate = undefined,
    persona = "",
    timeoutSeconds = 90,
    runCommand = runExecFile
  } = {}) {
    if (!command) {
      throw new Error("ollama local channel requires command");
    }
    if (!model) {
      throw new Error("ollama local channel requires model");
    }
    this.name = "ollama";
    this.command = command;
    this.model = model;
    this.promptTemplate = promptTemplate;
    this.persona = persona;
    this.timeoutSeconds = timeoutSeconds;
    this.runCommand = runCommand;
  }

  async send(request) {
    const prompt = buildAgentPrompt({
      ...request,
      promptTemplate: this.promptTemplate,
      persona: this.persona
    });
    const args = ["run", this.model, prompt];

    let result;
    try {
      result = await withTimeout(
        this.runCommand(this.command, args, { timeoutSeconds: this.timeoutSeconds }),
        this.timeoutSeconds
      );
    } catch (error) {
      if (error.message === "timeout") {
        throw new Error(`ollama local channel timed out after ${this.timeoutSeconds}s`);
      }
      throw new Error(`ollama local channel failed: ${error.message}`);
    }

    const text = String(result.stdout ?? "").trim();
    if (!text) {
      throw new Error("ollama local channel returned empty output");
    }
    return { text };
  }
}

function withTimeout(promise, timeoutSeconds) {
  if (!timeoutSeconds || timeoutSeconds <= 0) {
    return promise;
  }
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("timeout")), timeoutSeconds * 1000);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function runExecFile(file, args, options = {}) {
  const timeoutSeconds = options.timeoutSeconds;
  return execFileAsync(file, args, {
    maxBuffer: 1024 * 1024,
    timeout: timeoutSeconds ? timeoutSeconds * 1000 : undefined
  });
}
