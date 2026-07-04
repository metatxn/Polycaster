import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function readSource(path) {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

test("proxy wallet deployment detection falls back to relayer deployed status", () => {
  const source = readSource("src/hooks/use-proxy-wallet.ts");

  assert.equal(/getDeployed as relayerGetDeployed/.test(source), true);
  assert.equal(
    /rpcCheckIsDeployed\(proxyAddress[\s\S]*relayerGetDeployed\(\s*proxyAddress,\s*mode === "deposit" \? "WALLET" : "SAFE"/.test(
      source
    ),
    true
  );
});
