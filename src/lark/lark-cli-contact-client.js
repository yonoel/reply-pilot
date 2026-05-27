import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class LarkCliContactClient {
  constructor({ runCommand = runExecFile } = {}) {
    this.runCommand = runCommand;
    this.cache = new Map();
  }

  async getDisplayName(openId) {
    if (!openId) {
      return "";
    }
    if (this.cache.has(openId)) {
      return this.cache.get(openId);
    }
    try {
      const { stdout } = await this.runCommand("lark-cli", [
        "contact",
        "+search-user",
        "--as",
        "user",
        "--user-ids",
        openId,
        "--format",
        "json"
      ]);
      const body = JSON.parse(stdout || "{}");
      const user = firstUser(body);
      const name = user?.name ?? user?.user_name ?? user?.localized_name ?? user?.display_name ?? user?.nickname ?? openId;
      this.cache.set(openId, name);
      return name;
    } catch {
      this.cache.set(openId, openId);
      return openId;
    }
  }
}

function firstUser(body) {
  if (Array.isArray(body?.users)) {
    return body.users[0];
  }
  if (Array.isArray(body?.data?.users)) {
    return body.data.users[0];
  }
  if (Array.isArray(body?.items)) {
    return body.items[0];
  }
  if (Array.isArray(body?.data?.items)) {
    return body.data.items[0];
  }
  return undefined;
}

async function runExecFile(file, args) {
  return execFileAsync(file, args, {
    maxBuffer: 1024 * 1024
  });
}
