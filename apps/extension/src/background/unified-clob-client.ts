import type { Address, WalletClient } from "viem";

type ClobApiCredentials = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
};

type ExtensionUnifiedClobClientDeps = {
  createSecureClient(input: {
    signer: unknown;
    wallet: Address;
    credentials: ClobApiCredentials;
  }): Promise<{ client: unknown }>;
  createViemSigner(walletClient: WalletClient): unknown;
  adaptClient(client: unknown, options: { builderCode?: string }): unknown;
};

async function loadDefaultExtensionUnifiedClobClientDeps(): Promise<ExtensionUnifiedClobClientDeps> {
  // NOTE: must be a string LITERAL, not a variable. A variable request makes
  // webpack treat this as an expression dependency ("Critical dependency: the
  // request of a dependency is an expression") and it does NOT bundle the
  // module — so at runtime every order fails with "Cannot find module
  // '@knoww/shared-types/polymarket-unified'". The literal lets webpack
  // code-split it into a loadable chunk.
  const sdk = await import("@knoww/shared-types/polymarket-unified");
  return {
    createSecureClient: sdk.createUnifiedPolymarketSecureClient,
    createViemSigner: sdk.createUnifiedPolymarketViemSigner,
    adaptClient: sdk.adaptUnifiedSecureClientForLegacyClob,
  };
}

export async function createExtensionLegacyClobClient(
  input: {
    walletClient: WalletClient;
    funderAddress: Address;
    credentials: ClobApiCredentials;
    builderCode?: string;
  },
  deps?: ExtensionUnifiedClobClientDeps
) {
  const resolvedDeps =
    deps ?? (await loadDefaultExtensionUnifiedClobClientDeps());
  const { client: unifiedClient } = await resolvedDeps.createSecureClient({
    signer: resolvedDeps.createViemSigner(input.walletClient),
    wallet: input.funderAddress,
    credentials: input.credentials,
  });

  return resolvedDeps.adaptClient(unifiedClient, {
    builderCode: input.builderCode,
  });
}
