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
  const moduleName = "@knoww/shared-types/polymarket-unified";
  const sdk = await import(moduleName);
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
