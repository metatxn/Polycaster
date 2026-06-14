import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function streamMarketsSource(): string {
  return readFileSync(
    join(process.cwd(), "src/content/streaming/stream-markets.ts"),
    "utf8"
  );
}

test("stream markets refetch current-game prices when the refresh interval elapses", () => {
  const src = streamMarketsSource();
  assert.ok(
    src.includes("REFRESH_OK_MS - sinceLast"),
    "expected same-game refresh branch to wait only until the refresh interval elapses"
  );
  assert.ok(
    !/if\s*\(renderedKey === key\)\s*\{\s*schedule\(REFRESH_OK_MS\);\s*return;\s*\}/.test(
      src
    ),
    "expected same-game refresh branch not to reschedule forever without fetching"
  );
});
