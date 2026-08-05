/**
 * Store-build read-only portfolio handlers.
 *
 * The store-compliant build ships no offscreen trading runtime, so the
 * service worker answers the two read-only trading messages the portfolio
 * sidepanel depends on directly:
 *
 * - trading:derive-proxy-address — pure create2 math plus an eth_getCode
 *   deployment probe. Without it the sidepanel silently falls back to the
 *   EOA and every balance/history read keys to the wrong address.
 * - trading:get-balance — the CASH figure (pUSD/USDC.e/POL balanceOf reads).
 *
 * Everything else in the trading:* namespace stays disabled. The relayer
 * getDeployed fallback is intentionally absent here (relayer-client is
 * excluded from the store bundle); bytecode is authoritative for every
 * deployed wallet, and isDeployed only gates setup surfaces that are
 * store-gated anyway.
 */

import {
  POLYGON_WALLET_TOKENS,
  readTradingWalletBalance,
} from "@knoww/shared-types/balances";
import { POLYGON_CHAIN } from "@knoww/shared-types/chains";
import {
  derivePolymarketDepositWallet,
  derivePolymarketSafe,
} from "@knoww/shared-types/relayer";
import {
  type Address,
  createPublicClient,
  getAddress,
  http,
  type PublicClient,
} from "viem";
import { normalizeExtensionTradingWalletMode } from "../content/trading/setup-gates";
import type {
  TradingDeriveProxyAddressMessage,
  TradingErrorResponse,
  TradingGetBalanceMessage,
  TradingSuccessResponse,
} from "../types/chrome-messages";

type TradingResponse = TradingSuccessResponse | TradingErrorResponse;

const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";

let cachedClient: PublicClient | null = null;

function getPublicClient(): PublicClient {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      chain: POLYGON_CHAIN,
      transport: http(POLYGON_RPC),
    }) as PublicClient;
  }
  return cachedClient;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handleDeriveProxyAddress(
  msg: TradingDeriveProxyAddressMessage
): Promise<TradingResponse> {
  const owner = getAddress(msg.eoaAddress) as Address;
  const walletMode = normalizeExtensionTradingWalletMode(msg.walletMode);
  const proxyAddress =
    walletMode === "eoa"
      ? owner
      : walletMode === "deposit"
        ? derivePolymarketDepositWallet(owner)
        : derivePolymarketSafe(owner);

  const code = await getPublicClient().getBytecode({ address: proxyAddress });
  return {
    ok: true,
    data: { proxyAddress, isDeployed: !!code && code !== "0x" },
  };
}

async function handleGetBalance(
  msg: TradingGetBalanceMessage
): Promise<TradingResponse> {
  const owner = getAddress(msg.proxyAddress) as Address;
  const balance = await readTradingWalletBalance(getPublicClient(), owner, {
    tokens: POLYGON_WALLET_TOKENS,
    includeNative: true,
    includeDeployment: true,
  });
  return { ok: true, data: balance };
}

/**
 * Answer a read-only trading message inline in the service worker.
 * Returns true when the message was handled (sendResponse will be called
 * asynchronously); false when the caller should fall through to the
 * store-disabled response.
 */
export function handleStorePortfolioRead(
  message: unknown,
  sendResponse: (response: TradingResponse) => void
): boolean {
  const type = (message as { type?: unknown } | null)?.type;
  if (
    type !== "trading:derive-proxy-address" &&
    type !== "trading:get-balance"
  ) {
    return false;
  }

  void (async () => {
    try {
      const response =
        type === "trading:derive-proxy-address"
          ? await handleDeriveProxyAddress(
              message as TradingDeriveProxyAddressMessage
            )
          : await handleGetBalance(message as TradingGetBalanceMessage);
      sendResponse(response);
    } catch (error) {
      sendResponse({ ok: false, error: getErrorMessage(error) });
    }
  })();
  return true;
}
