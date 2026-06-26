const SEND_PHRASES = new Set(["发吧", "发送", "就这么发", "可以发"]);
const IGNORE_PHRASES = new Set(["忽略", "不用回", "先不回", "这个先不用回"]);

export function interpretApprovalInstruction(text = "") {
  const instruction = String(text).trim();
  if (!instruction) {
    return { action: "empty" };
  }
  if (SEND_PHRASES.has(instruction)) {
    return { action: "send" };
  }
  if (IGNORE_PHRASES.has(instruction)) {
    return { action: "ignore" };
  }
  return {
    action: "rewrite",
    instruction
  };
}
