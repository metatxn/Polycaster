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
    ".knoww-stream-step-input",
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

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function streamBetSource(): string {
  const src = readSource("src/content/ui/stream-bet-ui.ts");
  const start = src.indexOf("function buildStreamBetting");
  assert.ok(start !== -1, "expected buildStreamBetting to exist");
  const next = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

test("buildStreamBetting imports the pure stream-bet logic", () => {
  const src = readSource("src/content/ui/stream-bet-ui.ts");
  assert.ok(
    /from\s+"\.\/stream-bet-calc"/.test(src),
    "expected stream-bet-ui.ts to import stream-bet-calc"
  );
});

test("buildStreamBetting builds the compact head, stepper and footer", () => {
  const fn = streamBetSource();
  for (const cls of [
    "knoww-stream-head",
    "knoww-stream-buysell",
    "knoww-stream-actionrow",
    "knoww-stream-stepper",
    "knoww-stream-hold",
  ]) {
    assert.ok(fn.includes(cls), `expected buildStreamBetting to render ${cls}`);
  }
});

test("buildStreamBetting wires a SELL path", () => {
  const fn = streamBetSource();
  assert.ok(/side:\s*"SELL"/.test(fn), "expected a SELL order branch");
});

test("the old chips renderer is gone", () => {
  const fn = streamBetSource();
  assert.ok(
    !fn.includes("knoww-stream-chip"),
    "expected chip rendering removed"
  );
});

test("stream rows render the collapsed pill with the market title", () => {
  const src = readSource("src/content/ui/notifications.ts");
  assert.ok(src.includes("knoww-stream-pill-title"), "expected the pill title");
  assert.ok(
    /pillTitle\.textContent = streamShortTitle\(market\)/.test(src),
    "expected the pill title to be the market title"
  );
});

test("stream stake stepper is not capped by wallet balance", () => {
  const fn = streamBetSource();
  assert.ok(
    fn.includes('kind = "insufficient"'),
    "expected unaffordable stakes to render the deposit action"
  );
  assert.ok(
    !fn.includes("stakeCeiling"),
    "expected stream stake control not to use wallet balance as a ceiling"
  );
});

test("stream stake amount is directly editable", () => {
  const fn = streamBetSource();
  assert.ok(
    /document\.createElement\("input"\)/.test(fn),
    "expected stepper value to render an input"
  );
  assert.ok(
    fn.includes("parseStreamStakeInput"),
    "expected manual stake edits to use the stream stake parser"
  );
  assert.ok(
    fn.includes("knoww-stream-step-input"),
    "expected the input to use the stream step input class"
  );
});

test("stream trade CTA does not interpolate outcome names into innerHTML", () => {
  const fn = streamBetSource();
  assert.equal(
    /innerHTML\s*=\s*`[^`]*\$\{opt\.name\}/.test(fn),
    false,
    "expected external outcome names to be rendered as text, not HTML"
  );
  assert.ok(
    /textContent\s*=\s*`\$\{opt\.name\} · \$\{pct\}¢`/.test(fn),
    "expected stream outcome label to be assigned through textContent"
  );
});
