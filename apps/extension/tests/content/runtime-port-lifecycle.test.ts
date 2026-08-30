import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { installRuntimePortDisconnectHandler } from "../../src/content/runtime-port-lifecycle";

test("runtime port disconnects consume lastError before running cleanup", () => {
  let disconnectListener: (() => void) | undefined;
  let lastErrorReads = 0;
  let cleanupCalls = 0;
  const runtime = Object.defineProperty({}, "lastError", {
    configurable: true,
    get() {
      lastErrorReads += 1;
      return {
        message:
          "The page keeping the extension port is moved into back/forward cache, so the message channel is closed.",
      };
    },
  });

  installRuntimePortDisconnectHandler(
    {
      onDisconnect: {
        addListener(listener) {
          disconnectListener = listener;
        },
      },
    },
    () => {
      cleanupCalls += 1;
    },
    runtime
  );

  assert.ok(disconnectListener);
  disconnectListener();

  assert.equal(lastErrorReads, 1);
  assert.equal(cleanupCalls, 1);
});

test("runtime port disconnect cleanup also runs when there is no error", () => {
  let disconnectListener: (() => void) | undefined;
  let cleanupCalls = 0;

  installRuntimePortDisconnectHandler(
    {
      onDisconnect: {
        addListener(listener) {
          disconnectListener = listener;
        },
      },
    },
    () => {
      cleanupCalls += 1;
    },
    { lastError: undefined }
  );

  assert.ok(disconnectListener);
  disconnectListener();

  assert.equal(cleanupCalls, 1);
});

test("notification stack routes its long-lived port through the guarded disconnect handler", () => {
  const source = readFileSync(
    new URL("../../src/content/ui/notifications.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /installRuntimePortDisconnectHandler\(port, \(\) => \{/);
  assert.doesNotMatch(source, /port\.onDisconnect\.addListener/);
});
