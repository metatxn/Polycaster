/**
 * Polymarket Bridge API client shared by web and extension.
 *
 * Keep framework concerns outside this module. Callers pass app-specific
 * builder codes through BridgeRequestOptions.
 *
 * @see https://docs.polymarket.com/api-reference/bridge
 */

export const BRIDGE_API_URL = "https://bridge.polymarket.com";

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
