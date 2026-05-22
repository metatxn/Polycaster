import assert from "node:assert/strict";
import test from "node:test";
import {
  getKwColorScheme,
  getKwThemeFromAppTheme,
  KW_THEMES,
} from "./kw-theme-state.ts";

test("landing theme preserves supported app theme names", () => {
  assert.equal(getKwThemeFromAppTheme("dark"), "dark");
  assert.equal(getKwThemeFromAppTheme("midnight"), "midnight");
  assert.equal(getKwThemeFromAppTheme("softpop"), "softpop");
  assert.equal(getKwThemeFromAppTheme("light"), "light");
  assert.equal(getKwThemeFromAppTheme("forest"), "forest");
  assert.equal(getKwThemeFromAppTheme("lavender"), "lavender");
  assert.equal(getKwThemeFromAppTheme("system"), "light");
  assert.equal(getKwThemeFromAppTheme(null), "light");
});

test("landing exposes all app themes to the dropdown", () => {
  assert.deepEqual(
    KW_THEMES.map((theme) => theme.value),
    [
      "light",
      "dark",
      "midnight",
      "ocean",
      "slate",
      "softpop",
      "sunset",
      "forest",
      "lavender",
    ]
  );
});

test("landing derives browser color-scheme from selected theme", () => {
  assert.equal(getKwColorScheme("light"), "light");
  assert.equal(getKwColorScheme("forest"), "light");
  assert.equal(getKwColorScheme("lavender"), "light");
  assert.equal(getKwColorScheme("dark"), "dark");
  assert.equal(getKwColorScheme("midnight"), "dark");
  assert.equal(getKwColorScheme("softpop"), "dark");
});
