import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globals = readFileSync("src/app/globals.css", "utf8");
const landing = readFileSync("src/app/landing-page-client.tsx", "utf8");
const sections = readFileSync(
  "src/components/landing/knoww-sections.tsx",
  "utf8"
);
const themePicker = readFileSync("src/components/kw-theme.tsx", "utf8");
const bloombergMock = readFileSync(
  "src/components/tweet-overlay-bloomberg.tsx",
  "utf8"
);
const redditMock = readFileSync(
  "src/components/tweet-overlay-reddit.tsx",
  "utf8"
);
const heroMock = readFileSync("src/components/tweet-overlay-hero.tsx", "utf8");

test("landing accent text token clears the readability contrast target", () => {
  assert.match(globals, /--kw-accent-text:\s*#166534;/);
  assert.doesNotMatch(globals, /--kw-accent-text:\s*#15803d;/);
});

test("theme picker accessible name includes the visible theme label", () => {
  assert.match(themePicker, /aria-label=\{[^}]*activeTheme\?\.label/s);
  assert.doesNotMatch(themePicker, /aria-label="Select theme"/);
  assert.match(themePicker, /hidden min-w-0 truncate sm:inline/);
});

test("ticker exposes motion controls", () => {
  assert.match(landing, /hover:\[animation-play-state:paused\]/);
  assert.match(landing, /motion-reduce:animate-none/);
});

test("decorative hero mock feeds do not add document headings", () => {
  assert.doesNotMatch(bloombergMock, /<h[1-6][^>]*className="kwt-bb-headline"/);
  assert.doesNotMatch(redditMock, /<h[1-6][^>]*className="kwt-rd-title"/);
  assert.match(bloombergMock, /<div className="kwt-bb-headline">/);
  assert.match(redditMock, /<div className="kwt-rd-title">/);
});

test("decorative hero mock is hidden from assistive tech", () => {
  assert.match(heroMock, /aria-hidden="true"/);
  assert.match(heroMock, /\binert\b/);
});

test("landing narrative copy uses the upgraded readability classes", () => {
  assert.doesNotMatch(
    sections,
    /text-\[15px\]\s+leading-\[1\.6\]\s+text-\(--kw-fg\)\/70/
  );
  assert.doesNotMatch(
    sections,
    /text-\[14px\]\s+leading-\[1\.6\]\s+text-\(--kw-fg\)\/65/
  );
  assert.doesNotMatch(
    sections,
    /text-\[13\.5px\]\s+leading-\[1\.55\]\s+text-\(--kw-fg\)\/65/
  );
  assert.match(sections, /text-base\s+leading-\[1\.6\]\s+text-\(--kw-fg\)\/80/);
  assert.match(
    sections,
    /text-\[15px\]\s+leading-\[1\.6\]\s+text-\(--kw-fg\)\/75/
  );
  assert.match(
    sections,
    /text-\[14px\]\s+leading-\[1\.55\]\s+text-\(--kw-fg\)\/75/
  );
});

test("landing nav and footer metadata are not rendered as low-contrast microcopy", () => {
  assert.match(
    landing,
    /<nav className="hidden lg:flex items-center gap-8 text-\[14px\] font-medium"/
  );
  assert.match(landing, /inline-flex items-center py-1/);
  assert.match(landing, /aria-label="Add to Chrome"/);
  assert.match(landing, /hidden sm:inline">Add to Chrome/);
  assert.doesNotMatch(landing, /text-\[12px\]\s+text-\(--kw-fg\)\/60/);
  assert.match(landing, /text-\[12px\]\s+text-\(--kw-fg\)\/70/);
});

test("landing focus-visible outline clears the stronger focus target", () => {
  assert.match(
    globals,
    /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--kw-accent-text\);[^}]*outline-offset:\s*2px;/s
  );
});

test("hero mock card uses compact laptop fit constraints", () => {
  assert.match(landing, /kw-hero-inner/);
  assert.match(
    globals,
    /@media \(min-width: 1280px\) and \(max-width: 1535px\)\s*\{[\s\S]*?\.kw-hero-inner\s*\{[\s\S]*?padding-top:\s*2\.5rem;[\s\S]*?padding-bottom:\s*2\.5rem;/s
  );
  assert.match(
    globals,
    /@media \(min-width: 1280px\) and \(max-width: 1535px\)\s*\{[\s\S]*?\.kwt-card\s*\{[\s\S]*?height:\s*min\(656px,\s*calc\(100svh - 161px\)\);/s
  );
});
