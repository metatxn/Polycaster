import {
  type Address,
  createWalletClient,
  custom,
  type WalletClient,
} from "viem";
import { polygon } from "@/lib/chains";

type Eip1193Provider = Parameters<typeof custom>[0];
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

async function ensurePolygonChain(provider: RequestProvider) {
  const activeChainId = await provider.request({ method: "eth_chainId" });
  if (activeChainId === POLYGON_CHAIN_ID_HEX) return;

  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: POLYGON_CHAIN_ID_HEX }],
  });
}

export function hasViemWalletProvider(walletClient?: WalletClient | null) {
  return Boolean(walletClient);
}

export async function getViemWalletClient(
  walletClient?: WalletClient | null,
  account?: Address
): Promise<PolygonViemWalletClient> {
  if (!walletClient) {
    throw new Error("Wallet not connected. Please reconnect and try again.");
  }

  await ensurePolygonChain(walletClient as unknown as RequestProvider);
  const client = createPolygonWalletClient(
    walletClient as unknown as RequestProvider,
    account
  );
  if (!account) {
    await client.requestAddresses();
  }
  return client;
}
