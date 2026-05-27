import assert from "node:assert/strict";
import test from "node:test";

import { parseConfirmationCommand } from "../src/personal-watch/confirmation-command.js";

test("parseConfirmationCommand parses send command", () => {
  assert.deepEqual(parseConfirmationCommand("send req-123"), {
    action: "send",
    requestId: "req-123"
  });
});

test("parseConfirmationCommand parses rewrite command with instruction", () => {
  assert.deepEqual(parseConfirmationCommand("rewrite req-123 make it warmer"), {
    action: "rewrite",
    requestId: "req-123",
    instruction: "make it warmer"
  });
});

test("parseConfirmationCommand parses ignore command", () => {
  assert.deepEqual(parseConfirmationCommand("ignore req-123"), {
    action: "ignore",
    requestId: "req-123"
  });
});

test("parseConfirmationCommand keeps Chinese command aliases", () => {
  assert.deepEqual(parseConfirmationCommand("发送 req-123"), {
    action: "send",
    requestId: "req-123"
  });
  assert.deepEqual(parseConfirmationCommand("改写 req-123 语气更客气一点"), {
    action: "rewrite",
    requestId: "req-123",
    instruction: "语气更客气一点"
  });
  assert.deepEqual(parseConfirmationCommand("忽略 req-123"), {
    action: "ignore",
    requestId: "req-123"
  });
});

test("parseConfirmationCommand returns undefined for ordinary messages", () => {
  assert.equal(parseConfirmationCommand("你好"), undefined);
});
