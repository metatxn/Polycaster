/**
 * Polymarket Bridge API client shared by web and extension.
 *
 * Keep framework concerns outside this module. Callers pass app-specific
 * builder codes through BridgeRequestOptions.
 *
 * @see https://docs.polymarket.com/api-reference/bridge
 */

import { PUSD_ADDRESS, USDC_E_ADDRESS, USDC_E_DECIMALS } from "./contracts.ts";

export const BRIDGE_API_URL = "https://bridge.polymarket.com";
export const POLYGON_BRIDGE_CHAIN_ID = "137";

export type BridgeHeaders = Record<string, string>;

export interface BridgeFetchInit {
  method?: string;
  headers?: BridgeHeaders;
  body?: string;
}

export interface BridgeFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type BridgeFetch = (
  input: string,
  init?: BridgeFetchInit
) => Promise<BridgeFetchResponse>;

export interface BridgeRequestOptions {
  builderCode?: string;
  fetchImpl?: BridgeFetch;
  headers?: BridgeHeaders;
}

export interface SupportedAsset {
  chainId: string;
  chainName: string;
  token: {
    name: string;
    symbol: string;
    address: string;
    decimals: number;
  };
  minCheckoutUsd: number;
}

export interface DepositAddress {
  chainId: string;
  chainName: string;
  tokenAddress: string;
  tokenSymbol: string;
  depositAddress: string;
}

export interface CreateDepositResponse {
  address: { evm: string; svm: string; btc: string; tvm?: string };
  supportedChains?: string[];
  supported_chain_ids?: string[];
  note?: string;
}

export interface SupportedAssetsResponse {
  supportedAssets: SupportedAsset[];
}

export interface QuoteRequest {
  fromAmountBaseUnit: string;
  fromChainId: string;
  fromTokenAddress: string;
  recipientAddress: string;
  toChainId: string;
  toTokenAddress: string;
}

export interface FeeBreakdown {
  appFeeLabel: string;
  appFeePercent: number;
  appFeeUsd: number;
  fillCostPercent: number;
  fillCostUsd: number;
  gasUsd: number;
  maxSlippage: number;
  minReceived: number;
  swapImpact: number;
  swapImpactUsd: number;
  totalImpact: number;
  totalImpactUsd: number;
}

export interface QuoteResponse {
  estCheckoutTimeMs: number;
  estFeeBreakdown: FeeBreakdown;
  estInputUsd: number;
  estOutputUsd: number;
  estToTokenBaseUnit: string;
  quoteId: string;
}

export type DepositStatus =
  | "DEPOSIT_DETECTED"
  | "PROCESSING"
  | "ORIGIN_TX_CONFIRMED"
  | "SUBMITTED"
  | "COMPLETED"
  | "FAILED";

export interface DepositTransaction {
  fromChainId: string;
  fromTokenAddress: string;
  fromAmountBaseUnit: string;
  toChainId: string;
  toTokenAddress: string;
  status: DepositStatus;
  txHash?: string;
  createdTimeMs?: number;
}

export interface DepositStatusResponse {
  transactions: DepositTransaction[];
}

export interface WithdrawalRequest {
  address: string;
  toChainId: string;
  toTokenAddress: string;
  recipientAddr: string;
}

export interface WithdrawalAddressesResponse {
  address: {
    evm: string;
    svm: string;
    btc: string;
    tvm?: string;
  };
  note?: string;
}

export interface BridgeChainMetadata {
  name: string;
  icon: string;
  color: string;
  gradient?: string;
  rpc?: string;
  url?: string;
  tokenSymbol?: string;
}

export type DepositStatusTone = "info" | "warn" | "success" | "error";

export interface DepositStatusDisplay {
  text: string;
  color: string;
  tone: DepositStatusTone;
}

export type WalletDepositRouteKind = "bridge" | "direct";

export interface WalletDepositRoute {
  /** `direct` means send pUSD straight to the recipient wallet on Polygon. */
  kind: WalletDepositRouteKind;
  depositAddress: string;
  minUsd: number;
}

export interface ResolveWalletDepositRouteInput {
  chainId: string;
  tokenSymbol: string;
  tokenAddress: string;
  recipientAddress?: string;
  supportedAssets: SupportedAsset[];
  depositAddresses: DepositAddress[];
}

export const SOLANA_CHAIN_ID = "1151111081099710";

export const SUPPORTED_BRIDGE_CHAIN_IDS = [
  "1",
  "137",
  "42161",
  "10",
  "8453",
  "43114",
  "56",
  "324",
] as const;

export const CHAIN_METADATA: Record<string, BridgeChainMetadata> = {
  "1": {
    name: "Ethereum",
    icon: "⟠",
    color: "#627EEA",
    gradient: "from-blue-500 to-indigo-600",
  },
  "137": {
    name: "Polygon",
    icon: "⬡",
    color: "#8247E5",
    gradient: "from-purple-500 to-violet-600",
  },
  "42161": {
    name: "Arbitrum",
    icon: "🔷",
    color: "#28A0F0",
    gradient: "from-sky-400 to-blue-600",
  },
  "10": {
    name: "Optimism",
    icon: "🔴",
    color: "#FF0420",
    gradient: "from-red-500 to-rose-600",
  },
  "8453": {
    name: "Base",
    icon: "🔵",
    color: "#0052FF",
    gradient: "from-blue-500 to-blue-700",
  },
  "43114": {
    name: "Avalanche",
    icon: "🔺",
    color: "#E84142",
    gradient: "from-red-500 to-red-700",
  },
  "56": {
    name: "BNB Chain",
    icon: "⛓️",
    color: "#F0B90B",
    gradient: "from-yellow-400 to-amber-600",
  },
  "324": {
    name: "zkSync",
    icon: "⚡",
    color: "#8C8DFC",
    gradient: "from-sky-400 to-indigo-500",
  },
  [SOLANA_CHAIN_ID]: {
    name: "Solana",
    icon: "◎",
    color: "#9945FF",
    gradient: "from-purple-500 to-violet-600",
    rpc: "https://api.mainnet-beta.solana.com",
    url: "https://solana.com",
    tokenSymbol: "USDC",
  },
};

function getFetch(options?: BridgeRequestOptions): BridgeFetch {
  const fetchImpl =
    options?.fetchImpl ?? (globalThis as { fetch?: BridgeFetch }).fetch;

  if (!fetchImpl) {
    throw new Error("Bridge fetch implementation unavailable");
  }

  return fetchImpl;
}

function getBridgeHeaders(
  options?: BridgeRequestOptions,
  extraHeaders?: BridgeHeaders
): BridgeHeaders {
  return {
    ...(options?.headers ?? {}),
    ...(extraHeaders ?? {}),
    ...(options?.builderCode ? { "X-Builder-Code": options.builderCode } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function sameAddress(left: string, right: string): boolean {
  return (
    left.startsWith("0x") &&
    right.startsWith("0x") &&
    normalizeAddress(left) === normalizeAddress(right)
  );
}

export function isPusdToken(
  tokenSymbol: string,
  tokenAddress: string
): boolean {
  return (
    normalizeSymbol(tokenSymbol) === "PUSD" ||
    sameAddress(tokenAddress, PUSD_ADDRESS)
  );
}

export function findSupportedBridgeAsset(
  assets: SupportedAsset[],
  chainId: string,
  tokenSymbol: string,
  tokenAddress: string
): SupportedAsset | undefined {
  const requestedSymbol = normalizeSymbol(tokenSymbol);

  return assets.find((asset) => {
    if (asset.chainId !== chainId) return false;
    return (
      normalizeSymbol(asset.token.symbol) === requestedSymbol ||
      sameAddress(asset.token.address, tokenAddress)
    );
  });
}

export function findDepositAddressForChain(
  depositAddresses: DepositAddress[],
  chainId: string,
  asset?: SupportedAsset
): DepositAddress | undefined {
  if (asset) {
    const assetSymbol = normalizeSymbol(asset.token.symbol);
    const matching = depositAddresses.find(
      (address) =>
        address.chainId === chainId &&
        (normalizeSymbol(address.tokenSymbol) === assetSymbol ||
          sameAddress(address.tokenAddress, asset.token.address))
    );
    if (matching) return matching;
  }

  return depositAddresses.find((address) => address.chainId === chainId);
}

export function resolveWalletDepositRoute({
  chainId,
  tokenSymbol,
  tokenAddress,
  recipientAddress,
  supportedAssets,
  depositAddresses,
}: ResolveWalletDepositRouteInput): WalletDepositRoute | null {
  if (isPusdToken(tokenSymbol, tokenAddress)) {
    if (chainId !== POLYGON_BRIDGE_CHAIN_ID || !recipientAddress) return null;
    return {
      kind: "direct",
      depositAddress: recipientAddress,
      minUsd: 0,
    };
  }

  const asset = findSupportedBridgeAsset(
    supportedAssets,
    chainId,
    tokenSymbol,
    tokenAddress
  );
  const bridgeAddress = findDepositAddressForChain(
    depositAddresses,
    chainId,
    asset
  );

  if (asset && bridgeAddress) {
    return {
      kind: "bridge",
      depositAddress: bridgeAddress.depositAddress,
      minUsd: asset.minCheckoutUsd,
    };
  }

  return null;
}

async function readBridgeError(
  response: BridgeFetchResponse,
  fallback: string
): Promise<string> {
  const data = await response.json().catch(() => null);

  if (isRecord(data)) {
    if (typeof data.error === "string" && data.error) return data.error;
    if (typeof data.message === "string" && data.message) return data.message;
  }

  return fallback;
}

export function convertToDepositAddresses(
  data: CreateDepositResponse
): DepositAddress[] {
  const addresses: DepositAddress[] = [];
  const supportedChainIds = new Set<string>(
    data.supportedChains ??
      data.supported_chain_ids ??
      SUPPORTED_BRIDGE_CHAIN_IDS
  );

  if (data.address.evm) {
    for (const [chainId, meta] of Object.entries(CHAIN_METADATA)) {
      if (chainId === SOLANA_CHAIN_ID || !supportedChainIds.has(chainId)) {
        continue;
      }

      addresses.push({
        chainId,
        chainName: meta.name,
        tokenAddress: "",
        tokenSymbol: "USDC",
        depositAddress: data.address.evm,
      });
    }
  }

  if (data.address.svm) {
    const solanaMeta = CHAIN_METADATA[SOLANA_CHAIN_ID];
    addresses.push({
      chainId: SOLANA_CHAIN_ID,
      chainName: solanaMeta?.name || "Solana",
      tokenAddress: "",
      tokenSymbol: solanaMeta?.tokenSymbol || "USDC",
      depositAddress: data.address.svm,
    });
  }

  return addresses;
}

export async function fetchSupportedAssets(
  options?: BridgeRequestOptions
): Promise<SupportedAsset[]> {
  const response = await getFetch(options)(
    `${BRIDGE_API_URL}/supported-assets`,
    {
      headers: getBridgeHeaders(options),
    }
  );

  if (!response.ok) {
    throw new Error(
      await readBridgeError(
        response,
        `Failed to fetch supported assets: ${response.status}`
      )
    );
  }

  const data = (await response.json()) as SupportedAssetsResponse;
  return data.supportedAssets;
}

export async function createDepositAddresses(
  walletAddress: string,
  options?: BridgeRequestOptions
): Promise<DepositAddress[]> {
  const response = await getFetch(options)(`${BRIDGE_API_URL}/deposit`, {
    method: "POST",
    headers: getBridgeHeaders(options, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      address: walletAddress,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readBridgeError(
        response,
        `Failed to create deposit addresses: ${response.status}`
      )
    );
  }

  const data = (await response.json()) as CreateDepositResponse;
  return convertToDepositAddresses(data);
}

export async function fetchQuote(
  params: QuoteRequest,
  options?: BridgeRequestOptions
): Promise<QuoteResponse> {
  const response = await getFetch(options)(`${BRIDGE_API_URL}/quote`, {
    method: "POST",
    headers: getBridgeHeaders(options, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(
      await readBridgeError(
        response,
        `Failed to fetch quote: ${response.status}`
      )
    );
  }

  return (await response.json()) as QuoteResponse;
}

export async function fetchDepositStatus(
  depositAddress: string,
  options?: BridgeRequestOptions
): Promise<DepositTransaction[]> {
  const response = await getFetch(options)(
    `${BRIDGE_API_URL}/status/${encodeURIComponent(depositAddress)}`,
    {
      headers: getBridgeHeaders(options),
    }
  );

  if (!response.ok) {
    throw new Error(
      await readBridgeError(
        response,
        `Failed to fetch deposit status: ${response.status}`
      )
    );
  }

  const data = (await response.json()) as DepositStatusResponse;
  return data.transactions;
}

export async function fetchWithdrawalAddresses(
  params: WithdrawalRequest,
  options?: BridgeRequestOptions
): Promise<WithdrawalAddressesResponse> {
  const response = await getFetch(options)(`${BRIDGE_API_URL}/withdraw`, {
    method: "POST",
    headers: getBridgeHeaders(options, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(
      await readBridgeError(
        response,
        `Failed to create withdrawal addresses: ${response.status}`
      )
    );
  }

  return (await response.json()) as WithdrawalAddressesResponse;
}

export function getMinDepositForToken(
  assets: SupportedAsset[],
  tokenSymbol: string
): number {
  const normalizedTokenSymbol = tokenSymbol.toUpperCase();
  if (normalizedTokenSymbol === "PUSD") return 0;

  const matching = assets.filter((asset) => {
    const assetSymbol = asset.token.symbol.toUpperCase();
    return (
      assetSymbol === normalizedTokenSymbol ||
      (normalizedTokenSymbol === "USDC.E" && assetSymbol === "USDC") ||
      (normalizedTokenSymbol === "USDC" && assetSymbol === "USDC")
    );
  });

  if (matching.length === 0) return 45;

  return Math.min(...matching.map((asset) => asset.minCheckoutUsd));
}

export function getDefaultMinDeposit(assets: SupportedAsset[]): number {
  if (assets.length === 0) return 45;

  return Math.min(...assets.map((asset) => asset.minCheckoutUsd));
}

export function formatCheckoutTime(ms: number): string {
  if (ms < 60000) return `~${Math.ceil(ms / 1000)}s`;

  return `~${Math.ceil(ms / 60000)} min`;
}

export function getDepositStatusDisplay(
  status: DepositStatus
): DepositStatusDisplay {
  switch (status) {
    case "DEPOSIT_DETECTED":
      return { text: "Deposit detected", color: "#3b82f6", tone: "info" };
    case "PROCESSING":
      return { text: "Processing", color: "#f59e0b", tone: "warn" };
    case "ORIGIN_TX_CONFIRMED":
      return { text: "Origin confirmed", color: "#f59e0b", tone: "warn" };
    case "SUBMITTED":
      return { text: "Submitted", color: "#3b82f6", tone: "info" };
    case "COMPLETED":
      return { text: "Completed", color: "#22c55e", tone: "success" };
    case "FAILED":
      return { text: "Failed", color: "#ef4444", tone: "error" };
    default:
      return { text: status, color: "#888888", tone: "info" };
  }
}

// ============================================================================
// Multi-chain withdrawal token/chain model + helpers.
// Promoted from the web app so the extension reuses the same source of truth.
// Source for a withdrawal is always pUSD (V2 collateral on Polygon); these
// describe the DESTINATION token the user receives, resolved per chain from the
// live /supported-assets data.
// ============================================================================
export type WithdrawTokenId =
  | "usdc"
  | "usdc-e"
  | "usdt"
  | "dai"
  | "eth"
  | "pol"
  | "sol";

export interface WithdrawTokenConfig {
  id: WithdrawTokenId;
  symbol: string;
  name: string;
  /** Polygon contract address, for display/config; dest addresses resolve live. */
  address: string;
  decimals: number;
}

export const WITHDRAW_TOKEN_CONFIGS: Record<
  WithdrawTokenId,
  WithdrawTokenConfig
> = {
  "usdc-e": {
    id: "usdc-e",
    symbol: "USDC.e",
    name: "Bridged USDC",
    address: USDC_E_ADDRESS,
    decimals: USDC_E_DECIMALS,
  },
  usdc: {
    id: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
  usdt: {
    id: "usdt",
    symbol: "USDT",
    name: "Tether USD",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    decimals: 6,
  },
  dai: {
    id: "dai",
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    decimals: 18,
  },
  eth: {
    id: "eth",
    symbol: "ETH",
    name: "Ether",
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    decimals: 18,
  },
  pol: {
    id: "pol",
    symbol: "POL",
    name: "Polygon",
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    decimals: 18,
  },
  sol: {
    id: "sol",
    symbol: "SOL",
    name: "Solana",
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    decimals: 9,
  },
};

/** Chain key → Bridge API chain id. All chains route through the bridge. */
export const WITHDRAW_CHAIN_IDS: Record<string, string> = {
  polygon: "137",
  ethereum: "1",
  base: "8453",
  arbitrum: "42161",
  optimism: "10",
  bsc: "56",
  solana: "1151111081099710",
};

/** Bridge API token symbol → internal WithdrawTokenId. */
export const SYMBOL_TO_WITHDRAW_TOKEN_ID: Record<string, WithdrawTokenId> = {
  USDC: "usdc",
  "USDC.e": "usdc-e",
  USDT: "usdt",
  DAI: "dai",
  ETH: "eth",
  POL: "pol",
  SOL: "sol",
};

type BridgeAssetLike = {
  chainId: string;
  token: { symbol: string; address: string };
};

/**
 * Build a `chainId -> tokenId -> address` index from live supported-assets data.
 * First match wins (the API orders preferred contracts first).
 */
export function buildBridgeTokenIndex(
  supportedAssets: BridgeAssetLike[]
): Record<string, Partial<Record<WithdrawTokenId, string>>> {
  const index: Record<string, Partial<Record<WithdrawTokenId, string>>> = {};
  for (const asset of supportedAssets) {
    const tokenId = SYMBOL_TO_WITHDRAW_TOKEN_ID[asset.token.symbol];
    if (!tokenId) continue;
    if (!index[asset.chainId]) index[asset.chainId] = {};
    if (!index[asset.chainId][tokenId]) {
      index[asset.chainId][tokenId] = asset.token.address;
    }
  }
  return index;
}

/**
 * Resolve the destination token address for a chain + token, falling back to
 * USDC on that chain when the specific token isn't mapped.
 */
export function resolveDestTokenAddress(
  bridgeTokenIndex: Record<string, Partial<Record<WithdrawTokenId, string>>>,
  toChainId: string,
  tokenId: WithdrawTokenId
): string {
  const chainTokens = bridgeTokenIndex[toChainId];
  if (chainTokens?.[tokenId]) return chainTokens[tokenId] as string;
  if (chainTokens?.usdc) return chainTokens.usdc as string;
  return "";
}

function isSameBridgeAddress(left?: string, right?: string): boolean {
  return Boolean(
    left && right && left.trim().toLowerCase() === right.trim().toLowerCase()
  );
}

export function validateWithdrawBridgeDestination(input: {
  toTokenAddress?: string;
  bridgeAddress?: string;
  recipientAddress?: string;
  sourceAddress?: string;
}): void {
  if (isSameBridgeAddress(input.toTokenAddress, PUSD_ADDRESS)) {
    throw new Error(
      "Resolved withdrawal destination is pUSD. Select USDC or USDC.e so the Polymarket Bridge unwraps to the requested token."
    );
  }
  if (isSameBridgeAddress(input.bridgeAddress, input.recipientAddress)) {
    throw new Error(
      "Bridge returned the recipient address as the pUSD transfer target. Refusing to send direct pUSD."
    );
  }
  if (isSameBridgeAddress(input.bridgeAddress, input.sourceAddress)) {
    throw new Error(
      "Bridge returned the source wallet as the pUSD transfer target. Refusing to submit withdrawal."
    );
  }
}

/**
 * Tokens available for a chain, derived from live API data. Polygon always
 * offers usdc/usdc-e (relayer path) plus any bridge-supported tokens.
 */
export function getAvailableTokensForChain(
  bridgeTokenIndex: Record<string, Partial<Record<WithdrawTokenId, string>>>,
  chainKey: string
): WithdrawTokenId[] {
  const chainId = WITHDRAW_CHAIN_IDS[chainKey] || "1";
  const chainTokens = bridgeTokenIndex[chainId];
  if (chainKey === "polygon") {
    const bridgeTokenIds = chainTokens
      ? (Object.keys(chainTokens) as WithdrawTokenId[])
      : [];
    return [...new Set<WithdrawTokenId>(["usdc", "usdc-e", ...bridgeTokenIds])];
  }
  if (!chainTokens || Object.keys(chainTokens).length === 0) return ["usdc"];
  return Object.keys(chainTokens) as WithdrawTokenId[];
}
