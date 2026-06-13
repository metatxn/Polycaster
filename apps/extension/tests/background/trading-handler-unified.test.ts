import assert from "node:assert/strict";
import { test } from "vitest";
import { createExtensionLegacyClobClient } from "../../src/background/unified-clob-client";

test("createExtensionLegacyClobClient wires unified SDK auth into the legacy CLOB adapter", async () => {
  const walletClient = { account: "wallet-client" };
  const signer = { signer: "viem-signer" };
  const unifiedClient = { client: "unified-sdk-client" };
  const legacyClient = { client: "legacy-adapter-client" };
  const calls: Array<{ name: string; args: unknown[] }> = [];

  const client = await createExtensionLegacyClobClient(
    {
      walletClient: walletClient as never,
      funderAddress: "0x0000000000000000000000000000000000000002",
      credentials: {
        apiKey: "api-key",
        apiSecret: "api-secret",
        apiPassphrase: "api-passphrase",
      },
      builderCode: "builder-code",
    },
    {
      createViemSigner: (input) => {
        calls.push({ name: "createViemSigner", args: [input] });
        return signer as never;
      },
      createSecureClient: async (input) => {
        calls.push({ name: "createSecureClient", args: [input] });
        return { client: unifiedClient } as never;
      },
      adaptClient: (input, options) => {
        calls.push({ name: "adaptClient", args: [input, options] });
        return legacyClient as never;
      },
    }
  );

  assert.equal(client, legacyClient);
  assert.deepEqual(calls, [
    {
      name: "createViemSigner",
      args: [walletClient],
    },
    {
      name: "createSecureClient",
      args: [
        {
          signer,
          wallet: "0x0000000000000000000000000000000000000002",
          credentials: {
            apiKey: "api-key",
            apiSecret: "api-secret",
            apiPassphrase: "api-passphrase",
          },
        },
      ],
    },
    {
      name: "adaptClient",
      args: [unifiedClient, { builderCode: "builder-code" }],
    },
  ]);
});
