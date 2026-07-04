import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

function extractFunctionSource(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1);
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === "{") {
      opened = true;
      depth++;
    } else if (char === "}") {
      depth--;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

test("page bridge takeover guard is keyed by injection nonce, not a boolean latch", () => {
  const bridgeSource = readSource("src/page-bridge.ts");

  // The old boolean latch let a stale bridge (left in the MAIN world after an
  // extension update on a live tab) permanently block the fresh bridge from
  // installing — every re-injected request was then dropped on nonce mismatch
  // and hung until the 24h wallet-request timeout.
  assert.equal(
    /if \(window\.__KNOWW_BRIDGE__\) return;/.test(bridgeSource),
    false
  );
  assert.equal(
    /const takeoverKey = BRIDGE_NONCE \?\? true;/.test(bridgeSource),
    true
  );
  assert.equal(
    /if \(window\.__KNOWW_BRIDGE__ === takeoverKey\) return;/.test(
      bridgeSource
    ),
    true
  );
  assert.equal(
    /window\.__KNOWW_BRIDGE__ = takeoverKey;/.test(bridgeSource),
    true
  );
  assert.equal(
    /__KNOWW_BRIDGE__\?: boolean \| string;/.test(bridgeSource),
    true
  );
});

test("content script replaces a stale page-bridge tag instead of deferring to it", () => {
  const stylesSource = readSource("src/content/styles.ts");
  const injectSource = extractFunctionSource(
    stylesSource,
    "injectMetamaskBridge"
  );

  // A bridge tag without our isolated-world nonce comes from a previous
  // content-script incarnation (extension update + reinjectContentScript);
  // keeping it means our un-nonced messages are silently dropped.
  assert.equal(
    /if \(window\.__KNOWW_BRIDGE_NONCE__\) return;/.test(injectSource),
    true
  );
  assert.equal(/existing\.remove\(\);/.test(injectSource), true);
});

test("switchWallet falls back to connect on unsupported wallet_requestPermissions", () => {
  const bridgeSource = readSource("src/content/trading/bridge.ts");

  // A stale pre-nonce page bridge rejects wallet_requestPermissions with
  // "Method not allowed: …" — the shared classifier maps that to
  // unsupported-method so this catch falls through to plain connect.
  assert.equal(
    /catch \(err\) \{\s*if \(!isEip1193UnsupportedMethodError\(err\)\) throw err;/.test(
      bridgeSource
    ),
    true
  );
});
