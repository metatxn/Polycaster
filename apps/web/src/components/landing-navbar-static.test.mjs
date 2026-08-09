import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const landingStyles = readFileSync("src/app/styles/landing.css", "utf8");

test("landing navbar is opaque enough to mask content scrolling beneath it", () => {
  assert.match(
    landingStyles,
    /\.kw-landing \.kw-glass-bar \{\s*background: color-mix\(in srgb, var\(--kw-bg\) 84%, transparent\);/
  );
  assert.match(
    landingStyles,
    /\[data-scheme="light"\] \.kw-glass-bar \{\s*background: color-mix\(in srgb, var\(--kw-bg\) 92%, transparent\);/
  );
});

test("landing glass uses only supported media features", () => {
  assert.doesNotMatch(landingStyles, /prefers-reduced-transparency/);
});
