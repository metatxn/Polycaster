type LogLevel = "info" | "warn" | "error";

interface LogPayload {
  [key: string]: unknown;
}

function write(level: LogLevel, event: string, payload?: LogPayload): void {
  const entry = {
    ...(payload ?? {}),
    level,
    event,
    timestamp: new Date().toISOString(),
  };

  const serialized = JSON.stringify(entry);
  if (level === "info") {
    console.info(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.error(serialized);
}

export const logger = {
  info(event: string, payload?: LogPayload) {
    write("info", event, payload);
  },
  warn(event: string, payload?: LogPayload) {
    write("warn", event, payload);
  },
  error(event: string, payload?: LogPayload) {
    write("error", event, payload);
  },
};
