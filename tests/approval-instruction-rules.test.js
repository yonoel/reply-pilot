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
