/**
 * Polymarket Bridge API client — framework-agnostic fetch wrappers.
 *
 * Types and fetch helpers are aligned with the web app's `use-bridge.ts`
 * so both apps share the same deposit semantics.
 *
 * @see https://docs.polymarket.com/api-reference/bridge
 */

const BRIDGE_API_URL = "https://bridge.polymarket.com";

function getBridgeHeaders(extraHeaders?: HeadersInit): HeadersInit {
  const builderCode = process.env.POLY_BUILDER_CODE;
  return {
    ...(extraHeaders ?? {}),
    ...(builderCode ? { "X-Builder-Code": builderCode } : {}),
  };
}

// ── Types (mirrors web's use-bridge.ts) ──

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

interface CreateDepositResponse {
  address: { evm: string; svm: string; btc: string };
  supportedChains?: string[];
  supported_chain_ids?: string[];
  note?: string;
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

interface DepositStatusResponse {
  transactions: DepositTransaction[];
}

interface SupportedAssetsResponse {
  supportedAssets: SupportedAsset[];
}

// ── Chain metadata (same as web) ──

const SOLANA_CHAIN_ID = "1151111081099710";

const SUPPORTED_BRIDGE_CHAIN_IDS = [
  "1",
  "137",
  "42161",
  "10",
  "8453",
  "43114",
  "56",
  "324",
];

export const CHAIN_METADATA: Record<
  string,
  {
    name: string;
    icon: string;
    color: string;
    gradient: string;
    rpc?: string;
    url?: string;
    tokenSymbol?: string;
  }
> = {
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

// ── API helpers ──

export async function fetchSupportedAssets(): Promise<SupportedAsset[]> {
  const res = await fetch(`${BRIDGE_API_URL}/supported-assets`, {
    headers: getBridgeHeaders(),
  });
  if (!res.ok)
    throw new Error(`Failed to fetch supported assets: ${res.status}`);
  const data: SupportedAssetsResponse = await res.json();
  return data.supportedAssets;
}

function convertToDepositAddresses(
  data: CreateDepositResponse
): DepositAddress[] {
  const addresses: DepositAddress[] = [];
  const supportedChainIds = new Set<string>(
    data.supportedChains ??
      data.supported_chain_ids ??
      SUPPORTED_BRIDGE_CHAIN_IDS
  );

  // Map supported EVM chains in CHAIN_METADATA to the bridge's EVM deposit address
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

  // Solana uses the SVM deposit address
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

export async function createDepositAddresses(
  walletAddress: string
): Promise<DepositAddress[]> {
  const res = await fetch(`${BRIDGE_API_URL}/deposit`, {
    method: "POST",
    headers: getBridgeHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ address: walletAddress }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      err.message || `Failed to create deposit addresses: ${res.status}`
    );
  }
  const data: CreateDepositResponse = await res.json();
  return convertToDepositAddresses(data);
}

export async function fetchQuote(params: QuoteRequest): Promise<QuoteResponse> {
  const res = await fetch(`${BRIDGE_API_URL}/quote`, {
    method: "POST",
    headers: getBridgeHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Failed to fetch quote: ${res.status}`);
  }
  return res.json();
}

export async function fetchDepositStatus(
  depositAddress: string
): Promise<DepositTransaction[]> {
  const res = await fetch(
    `${BRIDGE_API_URL}/status/${encodeURIComponent(depositAddress)}`,
    { headers: getBridgeHeaders() }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      err.error || `Failed to fetch deposit status: ${res.status}`
    );
  }
  const data: DepositStatusResponse = await res.json();
  return data.transactions;
}

export function getMinDepositForToken(
  assets: SupportedAsset[],
  tokenSymbol: string
): number {
  const matching = assets.filter(
    (a) =>
      a.token.symbol.toUpperCase() === tokenSymbol.toUpperCase() ||
      (tokenSymbol.toUpperCase() === "USDC.E" &&
        a.token.symbol.toUpperCase() === "USDC") ||
      (tokenSymbol.toUpperCase() === "USDC" &&
        a.token.symbol.toUpperCase() === "USDC")
  );
  if (matching.length === 0) return 45;
  return Math.min(...matching.map((a) => a.minCheckoutUsd));
}

export function getDefaultMinDeposit(assets: SupportedAsset[]): number {
  if (assets.length === 0) return 45;
  return Math.min(...assets.map((a) => a.minCheckoutUsd));
}

export function formatCheckoutTime(ms: number): string {
  if (ms < 60000) return `~${Math.ceil(ms / 1000)}s`;
  return `~${Math.ceil(ms / 60000)} min`;
}

export function getDepositStatusDisplay(status: DepositStatus): {
  text: string;
  color: string;
} {
  switch (status) {
    case "DEPOSIT_DETECTED":
      return { text: "Deposit detected", color: "#3b82f6" };
    case "PROCESSING":
      return { text: "Processing", color: "#f59e0b" };
    case "ORIGIN_TX_CONFIRMED":
      return { text: "Origin confirmed", color: "#f59e0b" };
    case "SUBMITTED":
      return { text: "Submitted", color: "#3b82f6" };
    case "COMPLETED":
      return { text: "Completed", color: "#22c55e" };
    case "FAILED":
      return { text: "Failed", color: "#ef4444" };
    default:
      return { text: status, color: "#888" };
  }
}
