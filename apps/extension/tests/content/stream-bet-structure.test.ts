import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function readCss(): string {
  return readFileSync(
    join(process.cwd(), "src/content/knoww-inline.css"),
    "utf8"
  );
}

test("compact stream CSS defines the new toggle/stepper/footer/pill selectors", () => {
  const css = readCss();
  for (const sel of [
    ".knoww-stream-head",
    ".knoww-stream-title",
    ".knoww-stream-buysell",
    ".knoww-stream-bs-opt",
    ".knoww-stream-actionrow",
    ".knoww-stream-stepper",
    ".knoww-stream-step-btn",
    ".knoww-stream-step-val",
    ".knoww-stream-hold",
    ".knoww-stream-hold-sell",
    ".knoww-stream-pill",
    ".knoww-stream-pill-hold",
  ]) {
    assert.ok(css.includes(sel), `expected CSS to define ${sel}`);
  }
});

test("the old preset-chips CSS is removed", () => {
  const css = readCss();
  assert.ok(
    !css.includes(".knoww-stream-chip"),
    "expected .knoww-stream-chip* to be gone"
  );
});
