/**
 * Extension wrapper around the shared Polymarket Bridge API client.
 *
 * The shared package owns API semantics and display helpers; this file only
 * injects extension-specific environment configuration.
 */

import {
  type BridgeRequestOptions,
  createDepositAddresses as createSharedDepositAddresses,
  type DepositAddress,
  type DepositTransaction,
  fetchDepositStatus as fetchSharedDepositStatus,
  fetchQuote as fetchSharedQuote,
  fetchSupportedAssets as fetchSharedSupportedAssets,
  fetchWithdrawalAddresses as fetchSharedWithdrawalAddresses,
  type QuoteRequest,
  type QuoteResponse,
  type SupportedAsset,
  type WithdrawalAddressesResponse,
  type WithdrawalRequest,
} from "@knoww/shared-types/bridge";

export type {
  DepositAddress,
  DepositStatus,
  DepositTransaction,
  FeeBreakdown,
  QuoteRequest,
  QuoteResponse,
  SupportedAsset,
  WalletDepositRoute,
  WithdrawalAddressesResponse,
  WithdrawalRequest,
} from "@knoww/shared-types/bridge";
export {
  BRIDGE_API_URL,
  CHAIN_METADATA,
  findSupportedBridgeAsset,
  formatCheckoutTime,
  getDefaultMinDeposit,
  getDepositStatusDisplay,
  getMinDepositForToken,
  isPusdToken,
  POLYGON_BRIDGE_CHAIN_ID,
  resolveWalletDepositRoute,
  SOLANA_CHAIN_ID,
  SUPPORTED_BRIDGE_CHAIN_IDS,
} from "@knoww/shared-types/bridge";

function getBridgeOptions(): BridgeRequestOptions {
  return {
    builderCode: process.env.POLY_BUILDER_CODE,
  };
}

export function fetchSupportedAssets(): Promise<SupportedAsset[]> {
  return fetchSharedSupportedAssets(getBridgeOptions());
}

export function createDepositAddresses(
  walletAddress: string
): Promise<DepositAddress[]> {
  return createSharedDepositAddresses(walletAddress, getBridgeOptions());
}

export function fetchQuote(params: QuoteRequest): Promise<QuoteResponse> {
  return fetchSharedQuote(params, getBridgeOptions());
}

export function fetchDepositStatus(
  depositAddress: string
): Promise<DepositTransaction[]> {
  return fetchSharedDepositStatus(depositAddress, getBridgeOptions());
}

export function fetchWithdrawalAddresses(
  params: WithdrawalRequest
): Promise<WithdrawalAddressesResponse> {
  return fetchSharedWithdrawalAddresses(params, getBridgeOptions());
}
