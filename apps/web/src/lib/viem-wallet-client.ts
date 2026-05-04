import {
  type Address,
  createWalletClient,
  custom,
  type WalletClient,
} from "viem";
import { polygon } from "viem/chains";

type Eip1193Provider = Parameters<typeof custom>[0];
type WindowWithEthereum = Window & { ethereum?: Eip1193Provider };
type RequestProvider = {
  request: Eip1193Provider["request"];
};

const POLYGON_CHAIN_ID_HEX = `0x${polygon.id.toString(16)}`;

function createPolygonWalletClient(
  provider: Eip1193Provider,
  account?: Address
) {
  return createWalletClient({
    chain: polygon,
    transport: custom(provider),
    ...(account ? { account } : {}),
  });
}

export type PolygonViemWalletClient = ReturnType<
  typeof createPolygonWalletClient
>;

function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return (window as WindowWithEthereum).ethereum ?? null;
}

async function ensurePolygonChain(provider: RequestProvider) {
  const activeChainId = await provider.request({ method: "eth_chainId" });
  if (activeChainId === POLYGON_CHAIN_ID_HEX) return;

  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: POLYGON_CHAIN_ID_HEX }],
  });
}

export function hasViemWalletProvider(walletClient?: WalletClient | null) {
  return Boolean(walletClient || getInjectedProvider());
}

export async function getViemWalletClient(
  walletClient?: WalletClient | null,
  account?: Address
): Promise<PolygonViemWalletClient> {
  if (walletClient) {
    await ensurePolygonChain(walletClient as unknown as RequestProvider);
    const client = createPolygonWalletClient(
      walletClient as unknown as RequestProvider,
      account
    );
    await client.requestAddresses();
    return client;
  }

  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("No wallet provider found");
  }

  await ensurePolygonChain(provider as RequestProvider);
  const client = createPolygonWalletClient(provider, account);

  await client.requestAddresses();
  return client;
}
