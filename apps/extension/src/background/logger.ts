type LogPayload = unknown;

function shouldLog(level: "debug" | "info" | "warn" | "error"): boolean {
  if (__DEV_MODE__) return true;
  return level === "warn" || level === "error";
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return error;
}

function emit(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  payload?: LogPayload
): void {
  if (!shouldLog(level)) return;

  const prefix = `[Knoww:${event}]`;
  if (level === "debug") {
    console.debug(prefix, payload ? serializeError(payload) : undefined);
  } else if (level === "info") {
    console.info(prefix, payload ? serializeError(payload) : undefined);
  } else if (level === "warn") {
    console.warn(prefix, payload ? serializeError(payload) : undefined);
  } else {
    console.error(prefix, payload ? serializeError(payload) : undefined);
  }
}

export function logDebug(event: string, payload?: LogPayload): void {
  emit("debug", event, payload);
}

export function logInfo(event: string, payload?: LogPayload): void {
  emit("info", event, payload);
}

export function logWarn(event: string, payload?: LogPayload): void {
  emit("warn", event, payload);
}
