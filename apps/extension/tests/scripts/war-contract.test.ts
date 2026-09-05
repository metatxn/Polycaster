import assert from "node:assert/strict";
import { test } from "vitest";

// @ts-expect-error Task 11 intentionally introduces this plain-ESM helper.
import { validateLazyWarContract } from "../../scripts/lib/war-contract.mjs";

const supportedPatterns = [
  "https://example.com/feed/*",
  "https://*.news.example/*",
];
const canonicalEntry = {
  resources: ["platforms/*.js", "content-trading.js"],
  matches: ["https://example.com/*", "https://*.news.example/*"],
};

test("accepts one canonical lazy WAR owner with exact normalized matches", () => {
  assert.deepEqual(
    validateLazyWarContract([canonicalEntry], supportedPatterns),
    []
  );
});

test.each(["content-trading.js", "content-wallet.js"])(
  "allows only the declared onboarding origin for %s",
  (runtimeChunk) => {
    const entry = {
      resources: ["platforms/*.js", runtimeChunk],
      matches: [...canonicalEntry.matches, "https://knoww.app/*"],
    };
    const setupPatterns = ["https://knoww.app/extension/connect"];
    assert.deepEqual(
      validateLazyWarContract(
        [entry],
        supportedPatterns,
        runtimeChunk,
        setupPatterns
      ),
      []
    );
    for (const origin of [
      "http://localhost/*",
      "https://unexpected.example/*",
      "https://*.knoww.app/*",
    ]) {
      assert.match(
        validateLazyWarContract(
          [{ ...entry, matches: [...entry.matches, origin] }],
          supportedPatterns,
          runtimeChunk,
          setupPatterns
        ).join("\n"),
        /unexpected match/
      );
    }
    assert.match(
      validateLazyWarContract(
        [{ ...entry, matches: canonicalEntry.matches }],
        supportedPatterns,
        runtimeChunk,
        setupPatterns
      ).join("\n"),
      /missing match https:\/\/knoww.app\/\*/
    );
  }
);

test("rejects duplicate or split content-trading WAR ownership", () => {
  assert.match(
    validateLazyWarContract(
      [canonicalEntry, { resources: ["content-trading.js"], matches: [] }],
      supportedPatterns
    ).join("\n"),
    /exactly one.*content-trading/i
  );
  assert.match(
    validateLazyWarContract(
      [
        { resources: ["platforms/*.js"], matches: canonicalEntry.matches },
        { resources: ["content-trading.js"], matches: canonicalEntry.matches },
      ],
      supportedPatterns
    ).join("\n"),
    /same canonical/i
  );
});

test("rejects broad, missing, duplicate, or drifted canonical matches", () => {
  for (const matches of [
    ["<all_urls>"],
    ["https://example.com/*"],
    [...canonicalEntry.matches, "https://unexpected.example/*"],
    [...canonicalEntry.matches, canonicalEntry.matches[0]],
  ]) {
    assert.notDeepEqual(
      validateLazyWarContract(
        [{ resources: canonicalEntry.resources, matches }],
        supportedPatterns
      ),
      []
    );
  }
});
