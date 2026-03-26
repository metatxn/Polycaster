/**
 * Message types for communication with background script
 */

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

// ── Order types (from shared package) ──

import type { ClobOrderType } from "@knoww/shared-types/polymarket";

export type { ClobOrderType };

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
  credentials: { apiKey: string; apiSecret: string; apiPassphrase: string };
}

export interface TradingGetFeeRateMessage {
  type: "trading:get-fee-rate";
  tokenId: string;
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
  proxyAddress?: string;
  credentials?: { apiKey: string; apiSecret: string; apiPassphrase: string };
  yesTokenId?: string;
  noTokenId?: string;
}

export interface TradingMergePositionsMessage {
  type: "trading:merge-positions";
  conditionId: string;
  amount: number;
  address: string;
  proxyAddress?: string;
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

// ── Union types ──

export type TradingMessage =
  | TradingDeriveCredentialsMessage
  | TradingGetBalanceMessage
  | TradingPlaceOrderMessage
  | TradingGetFeeRateMessage
  | TradingGetAllowanceMessage
  | TradingGetAllAllowancesMessage
  | TradingGetOrderBookMessage
  | TradingSplitPositionMessage
  | TradingMergePositionsMessage
  | TradingGetOutcomeBalancesMessage
  | TradingRelayerApproveMessage;

export type BackgroundMessage =
  | FetchTextMessage
  | FetchJsonMessage
  | TradingMessage
  | SigningResponseMessage;

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

export interface EmbeddingsSuccessResponse {
  ok: true;
  similarities: number[];
}

export type BackgroundResponse =
  | FetchTextSuccessResponse
  | FetchJsonSuccessResponse
  | FetchErrorResponse
  | TradingSuccessResponse
  | TradingErrorResponse
  | EmbeddingsSuccessResponse;

export interface SettingsUpdateMessage {
  type: "KNOWW_SETTINGS_UPDATED";
  settings: import("./settings").UserSettings;
}

export type MessageHandler = (
  message: BackgroundMessage | SettingsUpdateMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse | { success: boolean }) => void
) => boolean | void;
