import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  beginClobCredentialDerivation,
  endClobCredentialDerivation,
  getClobCredentialDerivationStatus,
  resolveClobCredentialDerivationBegin,
} from "../../src/background/clob-credential-derivation-lock";

const ADDRESS = "0x000000000000000000000000000000000000dEaD";

afterEach(() => {
  vi.useRealTimers();
});

test("credential derivation lock allows only one active signer per address", () => {
  const first = beginClobCredentialDerivation(ADDRESS);
  assert.equal(first.status, "claimed");
  assert.ok(first.status === "claimed");

  assert.deepEqual(getClobCredentialDerivationStatus(ADDRESS), {
    status: "busy",
  });
  assert.deepEqual(beginClobCredentialDerivation(ADDRESS), { status: "busy" });

  assert.equal(endClobCredentialDerivation(ADDRESS, "wrong-token"), false);
  assert.deepEqual(getClobCredentialDerivationStatus(ADDRESS), {
    status: "busy",
  });

  assert.equal(endClobCredentialDerivation(ADDRESS, first.token), true);
  assert.deepEqual(getClobCredentialDerivationStatus(ADDRESS), {
    status: "idle",
  });
});

test("credential derivation lock expires orphaned claims", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-21T00:00:00.000Z"));

  const address = "0x000000000000000000000000000000000000bEEF";
  assert.equal(beginClobCredentialDerivation(address).status, "claimed");
  assert.deepEqual(beginClobCredentialDerivation(address), { status: "busy" });

  vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
  const next = beginClobCredentialDerivation(address);

  assert.equal(next.status, "claimed");
});

test("credential derivation begin does not claim when credential presence check fails", async () => {
  const address = "0x000000000000000000000000000000000000Cafe";

  await assert.rejects(
    resolveClobCredentialDerivationBegin(address, {
      hasCredentials: async () => {
        throw new Error("storage unavailable");
      },
    }),
    /storage unavailable/
  );

  assert.deepEqual(getClobCredentialDerivationStatus(address), {
    status: "idle",
  });
});
