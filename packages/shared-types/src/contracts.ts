/**
 * Contract Addresses on Polygon Mainnet
 *
 * Official Polymarket contract addresses used for trading.
 *
 * Reference: https://github.com/Polymarket/wagmi-safe-builder-example
 * Docs: https://docs.polymarket.com
 */

/** USDC.e (Bridged USDC) - ERC20 token used for trading */
export const USDC_E_ADDRESS =
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
export const USDC_E_DECIMALS = 6;

/** Conditional Tokens Framework (CTF) - ERC1155 outcome tokens */
export const CTF_ADDRESS =
  "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" as const;

/** CTF Exchange - Standard binary markets */
export const CTF_EXCHANGE_ADDRESS =
  "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as const;

/** Neg Risk CTF Exchange - Negative risk (mutually exclusive outcomes) markets */
export const NEG_RISK_CTF_EXCHANGE_ADDRESS =
  "0xC5d563A36AE78145C45a50134d48A1215220f80a" as const;

/** Neg Risk Adapter - Converts between neg risk and standard markets */
export const NEG_RISK_ADAPTER_ADDRESS =
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const;

/** Polymarket Safe Factory - Custom factory for deploying user Safe wallets */
export const SAFE_FACTORY_ADDRESS =
  "0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b" as const;

/** Safe init code hash for CREATE2 address derivation */
export const SAFE_INIT_CODE_HASH =
  "0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf" as const;

export const CONTRACTS = {
  USDC_E: USDC_E_ADDRESS,
  CTF: CTF_ADDRESS,
  CTF_EXCHANGE: CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE: NEG_RISK_CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER: NEG_RISK_ADAPTER_ADDRESS,
  SAFE_FACTORY: SAFE_FACTORY_ADDRESS,
} as const;

/** Contracts that need USDC.e approval (ERC-20) */
export const USDC_APPROVAL_TARGETS = [
  CTF_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
] as const;

/** Contracts that need outcome token approval (ERC-1155) */
export const CTF_APPROVAL_OPERATORS = [
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
] as const;
