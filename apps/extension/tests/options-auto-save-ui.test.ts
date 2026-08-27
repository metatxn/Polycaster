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
