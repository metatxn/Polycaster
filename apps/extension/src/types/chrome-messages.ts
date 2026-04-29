/**
 * Message types for communication with background script
 */

// ── Sentinel error used by builder-config (background) and trading-service (content)
// to signal that re-authentication is needed. ──
export const EXTENSION_AUTH_REQUIRED_ERROR = "Extension auth required";
export const TRADING_SESSION_DISCONNECTED_MESSAGE =
  "trading:session-disconnected";

// ── Existing fetch messages ──

export interface FetchTextMessage {
  type: "fetch-text";
  url: string;
}

export interface FetchJsonMessage {
  type: "fetch-json";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ScoreMarketsMessage {
  type: "score-markets";
  postText: string;
  marketTexts: string[];
  gateTexts?: string[];
  includeEmbeddings?: boolean;
  includeBm25?: boolean;
  includeContextGate?: boolean;
  includeRerank?: boolean;
}

export interface ScoringPrewarmMessage {
  type: "scoring:prewarm-offscreen";
}

export interface ContextGateResult {
  pass: boolean;
  sharedNouns: number;
  meaningfulNouns: number;
  sharedEntities: number;
  details: string;
}

// ── Order types (from shared package) ──

import type { ClobOrderType } from "@knoww/shared-types/polymarket";

export type { ClobOrderType };
export type TradingWalletMode = "safe" | "eoa";

// ── Trading messages (content → background) ──

export interface TradingDeriveCredentialsMessage {
  type: "trading:derive-credentials";
  address: string;
  signature: string;
  timestamp: string;
  nonce: number;
}

export interface TradingGetBalanceMessage {
  type: "trading:get-balance";
  proxyAddress: string;
}

export interface TradingPlaceOrderMessage {
  type: "trading:place-order";
  tokenId: string;
  conditionId?: string;
  outcomeIndex: number;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  amount?: number;
  orderType?: ClobOrderType;
  expiration?: number;
  negRisk?: boolean;
  address: string;
  proxyAddress: string;
  walletMode?: TradingWalletMode;
  credentials: { apiKey: string; apiSecret: string; apiPassphrase: string };
}

export interface TradingGetAllowanceMessage {
  type: "trading:get-allowance";
  ownerAddress: string;
  negRisk?: boolean;
}

export interface TradingGetAllAllowancesMessage {
  type: "trading:get-all-allowances";
  ownerAddress: string;
}

export interface TradingGetOrderBookMessage {
  type: "trading:get-orderbook";
  tokenId: string;
}

export interface TradingSplitPositionMessage {
  type: "trading:split-position";
  conditionId: string;
  amount: number;
  address: string;
  negRisk?: boolean;
  proxyAddress?: string;
  walletMode?: TradingWalletMode;
  credentials?: { apiKey: string; apiSecret: string; apiPassphrase: string };
  yesTokenId?: string;
  noTokenId?: string;
}

export interface TradingMergePositionsMessage {
  type: "trading:merge-positions";
  conditionId: string;
  amount: number;
  address: string;
  negRisk?: boolean;
  proxyAddress?: string;
  walletMode?: TradingWalletMode;
  credentials?: { apiKey: string; apiSecret: string; apiPassphrase: string };
  yesTokenId?: string;
  noTokenId?: string;
}

export interface TradingGetOutcomeBalancesMessage {
  type: "trading:get-outcome-balances";
  yesTokenId: string;
  noTokenId: string;
  ownerAddress: string;
}

export interface TradingRelayerApproveMessage {
  type: "trading:relayer-approve";
  address: string;
  walletMode?: TradingWalletMode;
  approvalAmount?: string;
}

export interface TradingDeploySafeMessage {
  type: "trading:deploy-safe";
  address: string;
}

export interface TradingPrewarmOffscreenMessage {
  type: "trading:prewarm-offscreen";
}

// ── Signing delegation (background ↔ content) ──

export interface SigningRequestMessage {
  type: "trading:signing-request";
  id: string;
  method: string;
  params: unknown[];
}

export interface SigningResponseMessage {
  type: "trading:signing-response";
  id: string;
  result?: unknown;
  error?: string;
}

export interface AnalyticsTrackMessage {
  type: "analytics:track";
  event: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
}

// ── Union types ──

export type TradingMessage =
  | TradingDeriveCredentialsMessage
  | TradingGetBalanceMessage
  | TradingPlaceOrderMessage
  | TradingGetAllowanceMessage
  | TradingGetAllAllowancesMessage
  | TradingGetOrderBookMessage
  | TradingSplitPositionMessage
  | TradingMergePositionsMessage
  | TradingGetOutcomeBalancesMessage
  | TradingRelayerApproveMessage
  | TradingDeploySafeMessage
  | TradingPrewarmOffscreenMessage;

export type BackgroundMessage =
  | FetchTextMessage
  | FetchJsonMessage
  | ScoreMarketsMessage
  | ScoringPrewarmMessage
  | TradingMessage
  | SigningResponseMessage
  | AnalyticsTrackMessage;

// ── Responses ──

export interface FetchTextSuccessResponse {
  ok: true;
  status: number;
  text: string;
}

export interface FetchJsonSuccessResponse {
  ok: true;
  status: number;
  data: unknown;
}

export interface FetchErrorResponse {
  ok: false;
  error: string;
  status?: number;
}

export interface TradingSuccessResponse {
  ok: true;
  data: unknown;
}

export interface TradingErrorResponse {
  ok: false;
  error: string;
}

export interface ScoreMarketsSuccessResponse {
  ok: true;
  similarities: number[];
  bm25Scores: number[];
  rerankScores?: number[];
  rerankMetrics?: {
    count: number;
    elapsedMs: number;
    queueWaitMs: number;
    model: string;
    dtype: string;
    device: "webgpu" | "wasm";
  };
  contextGateResults: ContextGateResult[];
  usedEmbeddings: boolean;
  usedRerank?: boolean;
}

export type BackgroundResponse =
  | FetchTextSuccessResponse
  | FetchJsonSuccessResponse
  | FetchErrorResponse
  | TradingSuccessResponse
  | TradingErrorResponse
  | ScoreMarketsSuccessResponse;

export interface SettingsUpdateMessage {
  type: "KNOWW_SETTINGS_UPDATED";
  settings: import("./settings").UserSettings;
}

export type MessageHandler = (
  message: BackgroundMessage | SettingsUpdateMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse | { success: boolean }) => void
) => boolean | undefined;
