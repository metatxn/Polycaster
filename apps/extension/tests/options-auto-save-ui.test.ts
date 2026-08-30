import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

test("options settings auto-save without a manual save button", () => {
  const optionsSource = readSource("src/options.tsx");
  const optionsHtml = readSource("options.html");

  assert.equal(/Save Settings/.test(optionsSource), false);
  assert.equal(/saveSettings/.test(optionsSource), false);
  assert.equal(/id="save-btn"/.test(optionsSource), false);
  assert.equal(
    /scheduleSettingsSave\(settings, persistSettings\)/.test(optionsSource),
    true
  );
  assert.equal(/\.save-btn\s*\{/.test(optionsHtml), false);
});

test("options hide the local model control until it is available", () => {
  const optionsSource = readSource("src/options.tsx");

  assert.match(
    optionsSource,
    /const productionRerankerAvailable = canUseProductionReranker\(\);/
  );
  assert.match(
    optionsSource,
    /\{productionRerankerAvailable && \([\s\S]*?label="Improve Matching Locally"/
  );
  assert.match(optionsSource, /about 24 MB/);
  assert.match(optionsSource, /runs on this device/);
  assert.doesNotMatch(
    optionsSource,
    /disabled=\{!canUseProductionReranker\(\)\}/
  );
});

test("AI matching settings use user-facing copy without exposing endpoints", () => {
  const optionsSource = readSource("src/options.tsx");

  assert.doesNotMatch(optionsSource, /\/api\//);
  assert.doesNotMatch(optionsSource, /\bendpoint\b/i);
  assert.match(optionsSource, /label="Improve Uncertain Matches"/);
  assert.match(optionsSource, /label="Verify Suggested Markets"/);
  assert.match(
    optionsSource,
    /Send post text to Knoww when local matching is uncertain/
  );
  assert.match(
    optionsSource,
    /Send post text and suggested market details to Knoww/
  );
});
