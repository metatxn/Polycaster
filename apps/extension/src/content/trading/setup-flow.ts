import {
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
} from "@knoww/shared-types/contracts";
import { DEFAULT_APPROVAL_AMOUNT } from "@knoww/shared-types/trading";

import {
  hasDeployedTradingWallet,
  type TradingWalletSetupState,
} from "./setup-gates";
import type { TradingContext } from "./trading-service";

export type SetupStepId = "connect" | "vault" | "approve" | "credentials";

export type SetupStepStatus = "done" | "now" | "pending";
export type SetupSurfaceMode = "wizard" | "banner" | "complete";

export interface SetupFlowState extends TradingWalletSetupState {
  /** A portfolio/wallet session is resolved (connect step). */
  hasSession: boolean;
  /** On-chain allowance is positive (approve step). */
  hasApproval: boolean;
  /** CLOB credentials exist (credentials step). */
  hasCredentials: boolean;
  /** Spendable cash balance in USD. Not part of setup completion. */
  cashBalance: number;
}

export interface SetupStep {
  id: SetupStepId;
  index: number; // 1-based
  label: string;
  helper: string;
  status: SetupStepStatus;
}

export interface SetupFlow {
  steps: SetupStep[];
  currentStepId: SetupStepId | null;
  currentIndex: number; // 1-based; equals totalSteps when complete
  totalSteps: number;
  isComplete: boolean;
}

/** Default ERC-20 approval cap shown in the allowance input (USDC). */
export const SETUP_APPROVAL_DEFAULT = DEFAULT_APPROVAL_AMOUNT;

export function isApprovalSufficientForSetup(allowanceUsd: number): boolean {
  return Number.isFinite(allowanceUsd) && allowanceUsd > 0;
}

export type TradingSetupAllowanceMap = Record<string, number | undefined>;
export type TradingSetupAllowanceReadStatus = "complete" | "degraded";
export type SetupApprovalReadStatus =
  | TradingSetupAllowanceReadStatus
  | "unknown";

export interface TradingSetupApprovalStatus {
  hasTradingApproval: boolean;
  usdcAllowance: number;
  usdcAllowanceNegRisk: number;
  allowanceReadStatus: TradingSetupAllowanceReadStatus;
}

export interface TradingSetupAllowancesResponse {
  allowances?: TradingSetupAllowanceMap | null;
  degraded?: boolean;
  degradedKeys?: string[];
}

/**
 * Only non-consumable approvals may gate setup completion. The exchange /
 * adapter pUSD allowances are granted at maxUint256 and the ERC-1155 operator
 * approvals are booleans, so none of them deplete through trading. The
 * USDC.e→onramp and pUSD→CTF allowances are finite and *spent* by auto-wrap /
 * split flows (each wrap re-approves the exact amount and consumes it to 0),
 * so requiring them here would flip a fully-onboarded user back into the
 * setup wizard after every wrap-funded BUY.
 */
const REQUIRED_TRADING_SETUP_APPROVAL_KEYS = [
  `pusd:${CTF_EXCHANGE_ADDRESS}`,
  `pusd:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`,
  `pusd:${NEG_RISK_ADAPTER_ADDRESS}`,
  `erc1155:${CTF_EXCHANGE_ADDRESS}`,
  `erc1155:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`,
  `erc1155:${NEG_RISK_ADAPTER_ADDRESS}`,
] as const;
const REQUIRED_TRADING_SETUP_APPROVAL_KEY_SET = new Set<string>(
  REQUIRED_TRADING_SETUP_APPROVAL_KEYS
);

export const SETUP_DEGRADED_LATCH_TRUST_LIMIT = 3;

/**
 * The one trust window for degraded allowance reads. `consecutiveDegradedReads`
 * counts INCLUDING the read being judged — a caller deciding whether to
 * preserve last-known-good state for a read that may turn out degraded passes
 * `counter + 1`. Every degraded-trust decision (preserve-approval, completion
 * unknown, card and side panel alike) must go through this single predicate;
 * the previous pair of predicates with `<`/`<=` operators straddling the
 * counter increment desynchronized the moment call order changed.
 */
export function isWithinDegradedSetupTrustWindow(
  consecutiveDegradedReads: number,
  trustLimit = SETUP_DEGRADED_LATCH_TRUST_LIMIT
): boolean {
  return consecutiveDegradedReads <= trustLimit;
}

export function isSetupCompletionUnknownFromDegradedRead(args: {
  consecutiveDegradedReads: number;
  flowAssumingApproval: SetupFlow;
  trustLimit?: number;
}): boolean {
  return (
    isWithinDegradedSetupTrustWindow(
      args.consecutiveDegradedReads,
      args.trustLimit
    ) && args.flowAssumingApproval.isComplete
  );
}

export function isSetupApprovalReadKnown(
  status: SetupApprovalReadStatus
): boolean {
  return status !== "degraded" && status !== "unknown";
}

export function isTradingSetupApprovalComplete(
  allowances: TradingSetupAllowanceMap | null | undefined
): boolean {
  if (!allowances) return false;
  return REQUIRED_TRADING_SETUP_APPROVAL_KEYS.every((key) =>
    isApprovalSufficientForSetup(Number(allowances[key] ?? 0))
  );
}

export function getTradingOrderAllowance(
  allowances: TradingSetupAllowanceMap | null | undefined,
  negRisk: boolean
): number {
  if (!allowances) return 0;

  const exchangeKey = negRisk
    ? `pusd:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`
    : `pusd:${CTF_EXCHANGE_ADDRESS}`;
  const exchangeAllowance = Number(allowances[exchangeKey] ?? 0);
  if (!negRisk) return exchangeAllowance;

  const adapterAllowance = Number(
    allowances[`pusd:${NEG_RISK_ADAPTER_ADDRESS}`] ?? 0
  );
  return Math.min(exchangeAllowance, adapterAllowance);
}

export function deriveTradingSetupApprovalStatus(
  allowances: TradingSetupAllowanceMap | null | undefined,
  options: { degraded?: boolean; degradedKeys?: string[] } = {}
): TradingSetupApprovalStatus {
  const hasTradingApproval = isTradingSetupApprovalComplete(allowances);
  const degradedKeys = options.degradedKeys ?? [];
  const hasUnknownRequiredApproval =
    degradedKeys.length > 0
      ? degradedKeys.some((key) =>
          REQUIRED_TRADING_SETUP_APPROVAL_KEY_SET.has(key)
        )
      : options.degraded === true && !hasTradingApproval;

  return {
    hasTradingApproval,
    usdcAllowance: getTradingOrderAllowance(allowances, false),
    usdcAllowanceNegRisk: getTradingOrderAllowance(allowances, true),
    allowanceReadStatus:
      !hasTradingApproval && hasUnknownRequiredApproval
        ? "degraded"
        : "complete",
  };
}

export async function fetchTradingSetupApprovalStatus(
  ownerAddress: string,
  fetchAllAllowances: (
    ownerAddress: string
  ) => Promise<TradingSetupAllowancesResponse | null | undefined>
): Promise<TradingSetupApprovalStatus> {
  const payload = await fetchAllAllowances(ownerAddress);
  return deriveTradingSetupApprovalStatus(payload?.allowances, {
    degraded: payload?.degraded === true,
    degradedKeys: payload?.degradedKeys,
  });
}

interface StepDef {
  id: SetupStepId;
  label: string;
  helper: string;
  done: (s: SetupFlowState) => boolean;
}

const STEP_DEFS: StepDef[] = [
  {
    id: "connect",
    label: "Connect wallet",
    helper: "Link the wallet you'll fund and trade with.",
    done: (s) => s.hasSession && Boolean(s.address),
  },
  {
    id: "vault",
    label: "Create trading vault",
    helper:
      "Deploy your gas-free Knoww vault — Knoww settles trades through it.",
    done: (s) => hasDeployedTradingWallet(s),
  },
  {
    id: "approve",
    label: "Approve permissions",
    helper: "Allow Knoww to move USDC for your trades. One signature.",
    done: (s) => s.hasApproval,
  },
  {
    id: "credentials",
    label: "Generate API keys",
    helper: "Sign once to mint your private trading keys.",
    done: (s) => s.hasCredentials,
  },
];

export function deriveSetupFlow(state: SetupFlowState): SetupFlow {
  let currentStepId: SetupStepId | null = null;
  let currentIndex = STEP_DEFS.length;
  let foundIncomplete = false;

  const steps: SetupStep[] = STEP_DEFS.map((def, i) => {
    const isDone = !foundIncomplete && def.done(state);
    let status: SetupStepStatus;
    if (isDone) {
      status = "done";
    } else if (!foundIncomplete) {
      status = "now";
      currentStepId = def.id;
      currentIndex = i + 1;
      foundIncomplete = true;
    } else {
      status = "pending";
    }
    return {
      id: def.id,
      index: i + 1,
      label: def.label,
      helper: def.helper,
      status,
    };
  });

  return {
    steps,
    currentStepId,
    currentIndex,
    totalSteps: STEP_DEFS.length,
    isComplete: currentStepId === null,
  };
}

export function resolveSetupSurfaceMode(args: {
  flow: SetupFlow;
  persistedComplete: boolean;
  dismissed: boolean;
  liveCompleteKnown?: boolean;
}): SetupSurfaceMode {
  if (args.flow.isComplete) return "complete";
  if (args.persistedComplete && args.liveCompleteKnown === false) {
    return "complete";
  }
  return args.dismissed ? "banner" : "wizard";
}

/**
 * Map a TradingContext to a SetupFlow.
 * Lives here (not trading-panel.ts) so it can be imported in node test
 * environments — trading-panel.ts touches document/React at module load time.
 */
export function cardSetupFlow(ctx: TradingContext): SetupFlow {
  return deriveSetupFlow({
    hasSession: Boolean(ctx.address),
    address: ctx.address,
    proxyAddress: ctx.proxyAddress,
    walletMode: ctx.walletMode,
    isDeployed: ctx.isDeployed,
    hasApproval: ctx.hasTradingApproval,
    hasCredentials: ctx.hasCredentials,
    cashBalance: ctx.balance,
  });
}
