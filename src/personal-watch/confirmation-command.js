export function parseConfirmationCommand(text = "") {
  const trimmed = text.trim();
  const send = trimmed.match(/^(?:send|发送)\s+(\S+)$/i);
  if (send) {
    return {
      action: "send",
      requestId: send[1]
    };
  }

  const rewrite = trimmed.match(/^(?:rewrite|改写)\s+(\S+)\s+(.+)$/i);
  if (rewrite) {
    return {
      action: "rewrite",
      requestId: rewrite[1],
      instruction: rewrite[2].trim()
    };
  }

  const ignore = trimmed.match(/^(?:ignore|忽略)\s+(\S+)$/i);
  if (ignore) {
    return {
      action: "ignore",
      requestId: ignore[1]
    };
  }

  return undefined;
}
