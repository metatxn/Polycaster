import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("unified Polymarket adapter does not import SDK viem chain barrel helper", () => {
  const source = readFileSync(
    new URL("./polymarket-unified.ts", import.meta.url),
    "utf8"
  );

  assert.equal(source.includes('"@polymarket/client/viem"'), false);
  assert.equal(source.includes("'@polymarket/client/viem'"), false);
});
