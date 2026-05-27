import assert from "node:assert/strict";
import test from "node:test";

import { LarkCliContactClient } from "../src/lark/lark-cli-contact-client.js";

test("LarkCliContactClient resolves open_id to a display name with user identity", async () => {
  const calls = [];
  const client = new LarkCliContactClient({
    async runCommand(file, args) {
      calls.push({ file, args });
      return {
        stdout: JSON.stringify({
          users: [
            {
              open_id: "ou-target",
              name: "张三"
            }
          ]
        })
      };
    }
  });

  const name = await client.getDisplayName("ou-target");

  assert.equal(name, "张三");
  assert.deepEqual(calls[0], {
    file: "lark-cli",
    args: ["contact", "+search-user", "--as", "user", "--user-ids", "ou-target", "--format", "json"]
  });
});

test("LarkCliContactClient falls back to open_id when no name is visible", async () => {
  const client = new LarkCliContactClient({
    async runCommand() {
      return { stdout: JSON.stringify({ users: [] }) };
    }
  });

  assert.equal(await client.getDisplayName("ou-target"), "ou-target");
});
