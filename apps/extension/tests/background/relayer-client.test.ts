import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

test("extension checks active deposit wallet deployment with WALLET relayer type", () => {
  const source = readSource("src/background/relayer-client.ts");

  assert.equal(
    /executeViaDepositWallet[\s\S]*getDeployed\?\.\(\s*depositWallet,\s*"WALLET"\s*\)/.test(
      source
    ),
    true
  );
});

test("extension deposit wallet deployment delegates preflight to the shared helper", () => {
  const source = readSource("src/background/relayer-client.ts");
  const deployFunction =
    source.match(
      /export async function deployDepositWallet[\s\S]*?\n}\n/
    )?.[0] ?? "";

  assert.equal(
    /getDeployed\?\.\(\s*walletAddress,\s*"WALLET"\s*\)/.test(deployFunction),
    false
  );
  assert.equal(
    /deployDepositWalletRelayerWallet\([\s\S]*options:\s*\{[\s\S]*checkDeployed:\s*true/.test(
      deployFunction
    ),
    true
  );
});

test("extension proxy derivation falls back to relayer deployment status", () => {
  const handlerSource = readSource("src/background/trading-handler.ts");
  const relayerSource = readSource("src/background/relayer-client.ts");

  assert.equal(
    /export async function isRelayerWalletDeployed/.test(relayerSource),
    true
  );
  assert.equal(
    /publicClient\.getBytecode[\s\S]*isRelayerWalletDeployed\(\s*proxyAddress,\s*walletType/.test(
      handlerSource
    ),
    true
  );
});
