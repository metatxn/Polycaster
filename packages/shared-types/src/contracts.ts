/**
 * Contract Addresses on Polygon Mainnet
 *
 * Official Polymarket contract addresses used for trading.
 *
 * Reference: https://github.com/Polymarket/wagmi-safe-builder-example
 * Docs: https://docs.polymarket.com
 */

/** USDC.e (Bridged USDC) — kept for bridge flows and Onramp wrapping */
export const USDC_E_ADDRESS =
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
export const USDC_E_DECIMALS = 6;

/** Polymarket USD (pUSD) — V2 trading collateral */
export const PUSD_ADDRESS =
  "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as const;
export const PUSD_DECIMALS = 6;

/** Collateral Onramp — wraps USDC.e → pUSD */
export const COLLATERAL_ONRAMP_ADDRESS =
  "0x93070a847efEf7F70739046A929D47a521F5B8ee" as const;

/** pUSD → legacy CTF adapter — standard binary markets */
export const CTF_COLLATERAL_ADAPTER_ADDRESS =
  "0xAdA100Db00Ca00073811820692005400218FcE1f" as const;

/** pUSD → legacy NegRisk CTF adapter — negative-risk markets */
export const NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS =
  "0xadA2005600Dec949baf300f4C6120000bDB6eAab" as const;

/** Conditional Tokens Framework (CTF) — ERC1155 outcome tokens (unchanged) */
export const CTF_ADDRESS =
  "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" as const;

/** CTF Exchange V2 — Standard binary markets */
export const CTF_EXCHANGE_ADDRESS =
  "0xE111180000d2663C0091e4f400237545B87B996B" as const;

/** Neg Risk CTF Exchange V2 — Negative risk markets */
export const NEG_RISK_CTF_EXCHANGE_ADDRESS =
  "0xe2222d279d744050d28e00520010520000310F59" as const;

/** Neg Risk Adapter (unchanged) */
export const NEG_RISK_ADAPTER_ADDRESS =
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const;

/** Polymarket Safe Factory (unchanged) */
export const SAFE_FACTORY_ADDRESS =
  "0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b" as const;

/** Safe init code hash for CREATE2 (unchanged) */
export const SAFE_INIT_CODE_HASH =
  "0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf" as const;

export const CONTRACTS = {
  USDC_E: USDC_E_ADDRESS,
  PUSD: PUSD_ADDRESS,
  COLLATERAL_ONRAMP: COLLATERAL_ONRAMP_ADDRESS,
  CTF_COLLATERAL_ADAPTER: CTF_COLLATERAL_ADAPTER_ADDRESS,
  NEG_RISK_CTF_COLLATERAL_ADAPTER: NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
  CTF: CTF_ADDRESS,
  CTF_EXCHANGE: CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE: NEG_RISK_CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER: NEG_RISK_ADAPTER_ADDRESS,
  SAFE_FACTORY: SAFE_FACTORY_ADDRESS,
} as const;

/** USDC.e approval target — needed for the Onramp `wrap()` call */
export const USDC_E_ONRAMP_APPROVAL_TARGET = COLLATERAL_ONRAMP_ADDRESS;

/** pUSD approval target listed by Polymarket docs for direct CTF split/mint flows */
export const PUSD_CTF_APPROVAL_TARGET = CTF_ADDRESS;

/** pUSD approval targets tracked by the app, including CLOB and adapter flows */
export const PUSD_APPROVAL_TARGETS = [
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  CTF_COLLATERAL_ADAPTER_ADDRESS,
  NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
] as const;

/** ERC-1155 outcome token operator targets tracked by the app */
export const CTF_APPROVAL_OPERATORS = [
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  CTF_COLLATERAL_ADAPTER_ADDRESS,
  NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
] as const;
