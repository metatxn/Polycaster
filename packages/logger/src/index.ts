type LogLevel = "debug" | "info" | "warn" | "error";
type LogPayload = unknown;

declare const __DEV_MODE__: boolean | undefined;
declare const process:
  | { env?: { NODE_ENV?: string | undefined } | undefined }
  | undefined;
declare const window: unknown;

/**
 * Dev-mode detection. Checked in order:
 *   1. `__DEV_MODE__` — build-time constant (apps/extension via webpack DefinePlugin)
 *   2. `process.env.NODE_ENV !== "production"` — Next.js, Node, most bundlers
 *   3. `false` — safe default
 */
function isDevMode(): boolean {
  try {
    if (typeof __DEV_MODE__ !== "undefined") return Boolean(__DEV_MODE__);
  } catch {
    // __DEV_MODE__ not defined in this runtime — fall through.
  }
  try {
    return (
      typeof process !== "undefined" && process.env?.NODE_ENV !== "production"
    );
  } catch {
    return false;
  }
}

function getExtensionDevMode(): boolean | null {
  try {
    if (typeof __DEV_MODE__ !== "undefined") return Boolean(__DEV_MODE__);
  } catch {
    // __DEV_MODE__ not defined in this runtime.
  }
  return null;
}

function getBrowserDebugMode(): boolean {
  try {
    if (typeof window === "undefined" || !window) return false;
    const browserWindow = window as {
      KNOWW_CONFIG?: {
        isDebugMode?: () => boolean;
        getUserSettings?: () => { debugMode?: boolean };
      };
    };

    if (browserWindow.KNOWW_CONFIG?.isDebugMode?.() === true) {
      return true;
    }

    return browserWindow.KNOWW_CONFIG?.getUserSettings?.().debugMode === true;
  } catch {
    return false;
  }
}

/**
 * Server/worker runtime = no `window` and `process` is defined. In these
 * environments log lines end up in a log drain (Cloudflare Workers, Node),
 * so structured JSON is more useful than the `[Knoww:event] { ... }` shape
 * that browser devtools prefer.
 */
function isServerRuntime(): boolean {
  try {
    if (typeof window !== "undefined") return false;
  } catch {
    // window not defined — continue; likely a server runtime.
  }
  try {
    return typeof process !== "undefined";
  } catch {
    return false;
  }
}

function shouldLog(level: LogLevel): boolean {
  const extensionDevMode = getExtensionDevMode();
  if (extensionDevMode !== null) {
    return extensionDevMode || getBrowserDebugMode();
  }

  if (isDevMode()) return true;
  return level === "warn" || level === "error";
}

function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function emitServer(
  level: LogLevel,
  event: string,
  payload?: LogPayload
): void {
  const payloadObj =
    payload && typeof payload === "object" && !(payload instanceof Error)
      ? (payload as Record<string, unknown>)
      : payload !== undefined
        ? { payload: serializeError(payload) }
        : {};
  const entry = {
    ...payloadObj,
    level,
    event,
    timestamp: new Date().toISOString(),
  };
  const serialized = JSON.stringify(entry);
  if (level === "debug") console.debug(serialized);
  else if (level === "info") console.info(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.error(serialized);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function emitBrowser(
  level: LogLevel,
  event: string,
  payload?: LogPayload
): void {
  const prefix = `[Knoww:${event}]`;

  // Pass Error instances natively so DevTools renders the stack trace.
  if (payload instanceof Error) {
    if (level === "warn") console.warn(prefix, payload);
    else console.error(prefix, payload);
    return;
  }

  // In dev, inline-stringify the payload so log rows are readable at a glance
  // without expanding each one. Production path keeps the object form for
  // richer inspection on the rare warn/error that surfaces.
  if (isDevMode()) {
    const tail = payload === undefined ? "" : ` ${safeStringify(payload)}`;
    const line = `${prefix}${tail}`;
    if (level === "debug") console.debug(line);
    else if (level === "info") console.info(line);
    else if (level === "warn") console.warn(line);
    else console.error(line);
    return;
  }

  const data = payload === undefined ? undefined : serializeError(payload);
  if (level === "debug") console.debug(prefix, data);
  else if (level === "info") console.info(prefix, data);
  else if (level === "warn") console.warn(prefix, data);
  else console.error(prefix, data);
}

function emitBrowserArgs(
  level: LogLevel,
  event: string,
  args: readonly unknown[]
): void {
  const prefix = `[Knoww:${event}]`;
  if (level === "debug") console.debug(prefix, ...args);
  else if (level === "info") console.info(prefix, ...args);
  else if (level === "warn") console.warn(prefix, ...args);
  else console.error(prefix, ...args);
}

function emit(level: LogLevel, event: string, payload?: LogPayload): void {
  if (!shouldLog(level)) return;
  if (isServerRuntime()) emitServer(level, event, payload);
  else emitBrowser(level, event, payload);
}

function emitArgs(
  level: LogLevel,
  event: string,
  args: readonly unknown[]
): void {
  if (!shouldLog(level)) return;
  if (isServerRuntime()) emitServer(level, event, { args });
  else emitBrowserArgs(level, event, args);
}

export function logDebug(event: string, payload?: LogPayload): void {
  emit("debug", event, payload);
}

export function logDebugArgs(event: string, ...args: unknown[]): void {
  emitArgs("debug", event, args);
}

export function logInfo(event: string, payload?: LogPayload): void {
  emit("info", event, payload);
}

export function logWarn(event: string, payload?: LogPayload): void {
  emit("warn", event, payload);
}

export function logError(event: string, payload?: LogPayload): void {
  emit("error", event, payload);
}

export interface Logger {
  debug(event: string, payload?: LogPayload): void;
  debugArgs(event: string, ...args: unknown[]): void;
  info(event: string, payload?: LogPayload): void;
  warn(event: string, payload?: LogPayload): void;
  error(event: string, payload?: LogPayload): void;
}

/**
 * Create a scoped logger. Events are prefixed with `<scope>.` so
 * `createLogger("trading").warn("order.failed", ...)` emits
 * `trading.order.failed` in the output.
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (event, payload) => logDebug(`${scope}.${event}`, payload),
    debugArgs: (event, ...args) => logDebugArgs(`${scope}.${event}`, ...args),
    info: (event, payload) => logInfo(`${scope}.${event}`, payload),
    warn: (event, payload) => logWarn(`${scope}.${event}`, payload),
    error: (event, payload) => logError(`${scope}.${event}`, payload),
  };
}

/**
 * Default unscoped logger. Convenient for server-side callers that prefer
 * a `logger.info(event, payload)` shape over the flat `logInfo` functions.
 */
export const logger: Logger = {
  debug: logDebug,
  debugArgs: logDebugArgs,
  info: logInfo,
  warn: logWarn,
  error: logError,
};
