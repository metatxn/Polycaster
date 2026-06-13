import assert from "node:assert/strict";
import { test } from "vitest";
import { logWarn } from "../../../../packages/logger/src/index";

test("structured warning logs include nested Error details", () => {
  const originalWarn = console.warn;
  const lines: string[] = [];

  console.warn = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    logWarn("test.error", { error: new Error("balance fetch failed") });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(lines.length, 1);
  const payload = JSON.parse(lines[0]) as {
    error?: { message?: string; name?: string };
  };
  assert.equal(payload.error?.name, "Error");
  assert.equal(payload.error?.message, "balance fetch failed");
});
