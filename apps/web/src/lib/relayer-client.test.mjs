import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function readSource(path) {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

test("web deposit wallet deployment preflights existing wallets", () => {
  const source = readSource("src/lib/relayer-client.ts");

  assert.equal(
    /const relayerTransport:[\s\S]*getDeployed,[\s\S]*submit:/.test(source),
    true
  );
  assert.equal(
    /deployDepositWallet[\s\S]*options:\s*\{\s*checkDeployed:\s*true\s*\}/.test(
      source
    ),
    true
  );
});
