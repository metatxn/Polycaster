// apps/extension/src/funding/machine.ts
// Pure funding (deposit/withdraw) state machine. No DOM, no chrome.*, no
// Date/crypto/timers — reduceFunding(state, event) only ever computes from
// its two arguments and returns plain data (state + effect descriptors).
import Decimal from "decimal.js";
import type {
  FundingAttempt,
  FundingBridgeAsset,
  FundingCommand,
  FundingError,
  FundingErrorCode,
  FundingFlow,
  FundingMethod,
  FundingQuote,
  FundingStatusResult,
  FundingToken,
} from "./types";

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;

/** Returns the canonical decimal string, or null when invalid/non-positive. */
export function normalizeFundingAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  const value = new Decimal(trimmed);
  if (!value.isFinite() || value.lte(0)) return null;
  return value.toFixed();
}

// Polymarket's collateral (pUSD) settles on Polygon; the wallet (direct,
// non-bridge) deposit method defaults to a same-chain Polygon transfer.
// Cross-chain executable deposits set FundingToken.chainId per token, which
// overrides this default in the SUBMIT command. The passive bridge method
// carries its own chain per FundingBridgeAsset and never builds a
// FundingCommand (that branch is passive — see below).
const WALLET_DEPOSIT_CHAIN_ID = "137";

interface Correlation {
  epoch: number;
  /** Latest effectId issued per effect kind; stale results are dropped. */
  latest: Partial<Record<FundingEffect["kind"], number>>;
  nextEffectId: number;
  /**
   * Session-scoped values (connected wallet address / wallet mode) supplied
   * by the caller via START. The pure machine has no way to source these
   * itself (no chrome/session access); they are threaded here — rather than
   * duplicated across every step's fields — because `corr` is the one field
   * every FundingState step already carries. Not part of the epoch/effectId
   * correlation mechanism proper.
   */
  address: string;
  walletMode: string | undefined;
}

export type FundingState =
  | { step: "idle"; corr: Correlation }
  | { step: "method"; flow: "deposit"; corr: Correlation }
  | {
      step: "select-token";
      loading: boolean;
      tokens: FundingToken[];
      error: FundingError | null;
      corr: Correlation;
    }
  | {
      step: "select-bridge-asset";
      loading: boolean;
      assets: FundingBridgeAsset[];
      /** Full loaded set, unfiltered; `assets` is the query-filtered view. */
      allAssets: FundingBridgeAsset[];
      query: string;
      error: FundingError | null;
      corr: Correlation;
    }
  | {
      step: "bridge-address-ready";
      asset: FundingBridgeAsset;
      loading: boolean;
      depositAddress: string | null;
      error: FundingError | null;
      corr: Correlation;
    }
  | {
      step: "amount";
      flow: FundingFlow;
      token: FundingToken | null;
      amount: string;
      destination: string;
      chainKey: string;
      tokenId: string;
      quote: FundingQuote | null;
      quoteLoading: boolean;
      error: FundingError | null;
      corr: Correlation;
    }
  | {
      step: "confirm";
      command: FundingCommand;
      quote: FundingQuote | null;
      /**
       * The selected deposit token, carried forward so BACK can rebuild a
       * fully valid "amount" state (whose SUBMIT/quote need `token`).
       * Null for withdraw (that flow has no token selection).
       */
      token: FundingToken | null;
      corr: Correlation;
    }
  | {
      step: "submitting";
      command: FundingCommand;
      attempt: FundingAttempt | null;
      corr: Correlation;
    }
  | {
      step: "confirming";
      command: FundingCommand;
      attempt: FundingAttempt;
      phase: "on-chain" | "credit" | "status";
      corr: Correlation;
    }
  | { step: "done"; txHash: string | null; corr: Correlation }
  | {
      step: "error";
      error: FundingError;
      command: FundingCommand | null;
      attempt: FundingAttempt | null;
      corr: Correlation;
    };

/**
 * Which deposit token list `loadTokens` should load. "wallet" (default) is
 * the connected wallet's Polygon balances; "cross-chain" is the executable
 * cross-chain deposit token set (per-token `chainId`).
 */
export type FundingTokenSource = "wallet" | "cross-chain";

export type FundingEffect =
  | {
      kind: "loadTokens";
      effectId: number;
      epoch: number;
      /** Threaded verbatim from SELECT_METHOD; absent elsewhere (gateways
       * fall back to their surface's current source). */
      source?: FundingTokenSource;
    }
  | { kind: "loadBridgeAssets"; effectId: number; epoch: number }
  | {
      kind: "resolveBridgeAddress";
      effectId: number;
      epoch: number;
      asset: FundingBridgeAsset;
    }
  | {
      kind: "fetchQuote";
      effectId: number;
      epoch: number;
      tokenAddress: string;
      tokenDecimals: number;
      amount: string;
    }
  | {
      kind: "beginAttempt";
      effectId: number;
      epoch: number;
      command: FundingCommand;
    }
  | {
      kind: "execute";
      effectId: number;
      epoch: number;
      command: FundingCommand;
      attempt: FundingAttempt;
    }
  | {
      kind: "awaitDepositCredit";
      effectId: number;
      epoch: number;
      attempt: FundingAttempt;
    }
  | {
      kind: "pollWithdrawStatus";
      effectId: number;
      epoch: number;
      attempt: FundingAttempt;
    }
  | {
      kind: "completeAttempt";
      effectId: number;
      epoch: number;
      attempt: FundingAttempt;
      outcome: "credited" | "reverted";
    };

interface ResultMeta {
  epoch: number;
  effectId: number;
}

export type FundingEvent =
  | { type: "START"; flow: FundingFlow; address?: string; walletMode?: string }
  | {
      type: "SELECT_METHOD";
      method: FundingMethod;
      /** For method "wallet": which token list to load (default "wallet"). */
      source?: FundingTokenSource;
    }
  | { type: "SELECT_TOKEN"; token: FundingToken }
  | { type: "SELECT_BRIDGE_ASSET"; asset: FundingBridgeAsset }
  | { type: "SET_AMOUNT"; amount: string }
  | { type: "SET_QUERY"; query: string }
  | {
      type: "SET_DESTINATION";
      destination: string;
      chainKey: string;
      tokenId: string;
    }
  | { type: "REQUEST_QUOTE" }
  | { type: "BACK" }
  | { type: "SUBMIT" }
  | { type: "RETRY" }
  | { type: "RESET" }
  | { type: "ACCOUNT_CHANGED" }
  | ({ type: "TOKENS_LOADED"; tokens: FundingToken[] } & ResultMeta)
  | ({ type: "LOAD_FAILED"; error: FundingError } & ResultMeta)
  | ({ type: "ASSETS_LOADED"; assets: FundingBridgeAsset[] } & ResultMeta)
  | ({ type: "BRIDGE_ADDRESS_READY"; depositAddress: string } & ResultMeta)
  | ({ type: "QUOTE_OK"; quote: FundingQuote } & ResultMeta)
  | ({ type: "QUOTE_FAILED"; error: FundingError } & ResultMeta)
  | ({ type: "ATTEMPT_READY"; attempt: FundingAttempt } & ResultMeta)
  | ({ type: "EXECUTED"; txHash: string } & ResultMeta)
  | ({ type: "EXECUTION_FAILED"; error: FundingError } & ResultMeta)
  | ({ type: "CREDITED" } & ResultMeta)
  | ({ type: "REVERT_CONFIRMED" } & ResultMeta)
  | ({ type: "STATUS_UPDATE"; status: FundingStatusResult } & ResultMeta)
  /** Controller gave up confirming (repeated transport failures); the
   * on-chain outcome is unknown — not confirmed failed. */
  | ({ type: "CONFIRMATION_UNAVAILABLE" } & ResultMeta);

export const initialFundingState: FundingState = {
  step: "idle",
  corr: {
    epoch: 0,
    latest: {},
    nextEffectId: 1,
    address: "",
    walletMode: undefined,
  },
};

function issue(
  corr: Correlation,
  kind: FundingEffect["kind"]
): [Correlation, number] {
  const effectId = corr.nextEffectId;
  return [
    {
      ...corr,
      nextEffectId: effectId + 1,
      latest: { ...corr.latest, [kind]: effectId },
    },
    effectId,
  ];
}

function staleResult(
  corr: Correlation,
  kind: FundingEffect["kind"],
  meta: ResultMeta
): boolean {
  return meta.epoch !== corr.epoch || corr.latest[kind] !== meta.effectId;
}

/**
 * Drops the outstanding effect of `kind` from the correlation so its result
 * (already in flight) is rejected as stale on arrival. Used when a form edit
 * outdates an in-flight quote: without this, a quote requested for the
 * previous amount/destination could resolve after the edit and advance the
 * withdraw flow to "confirm" with a command built from mixed old/new inputs.
 */
function invalidatePending(
  corr: Correlation,
  kind: FundingEffect["kind"]
): Correlation {
  if (corr.latest[kind] === undefined) return corr;
  const latest = { ...corr.latest };
  delete latest[kind];
  return { ...corr, latest };
}

const RETRYABLE_EXECUTION_ERROR_CODES: ReadonlySet<FundingErrorCode> = new Set([
  "AMBIGUOUS_OUTCOME",
  "QUOTE_FAILED",
  "LOAD_FAILED",
  "EXECUTION_FAILED",
]);

function executionRetryable(code: FundingErrorCode): boolean {
  return RETRYABLE_EXECUTION_ERROR_CODES.has(code);
}

function filterBridgeAssets(
  assets: FundingBridgeAsset[],
  query: string
): FundingBridgeAsset[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return assets;
  return assets.filter(
    (asset) =>
      asset.symbol.toLowerCase().includes(needle) ||
      asset.name.toLowerCase().includes(needle) ||
      asset.chainName.toLowerCase().includes(needle)
  );
}

/**
 * The minimum-deposit floor compares TOKEN units against `token.minAmount`
 * (token units), which the gateway derived from the USD floor and the
 * token's price at the boundary — the machine stays dumb about prices. The
 * error copy leads with the USD figure (`minUsd`) since that is what users
 * understand, appending the token-unit floor when the two differ (i.e. for
 * non-USD-pegged tokens).
 */
function validateDepositAmount(
  token: FundingToken,
  rawAmount: string
): FundingError | null {
  const normalized = normalizeFundingAmount(rawAmount);
  if (normalized === null) {
    return {
      code: "VALIDATION",
      message: "Enter a valid amount.",
      retryable: false,
    };
  }
  const amountDec = new Decimal(normalized);
  // Empty balanceDisplay = balance UNKNOWN (cross-chain source wallets we
  // cannot read) — skip the over-balance check; the wallet itself rejects an
  // over-balance transfer at signing time.
  if (token.balanceDisplay !== "") {
    const balanceDec = new Decimal(token.balanceDisplay);
    if (amountDec.gt(balanceDec)) {
      return {
        code: "VALIDATION",
        message: "Amount exceeds available balance.",
        retryable: false,
      };
    }
  }
  const minAmountDec = new Decimal(token.minAmount || "0");
  if (minAmountDec.gt(0) && amountDec.lt(minAmountDec)) {
    const minUsdDec = new Decimal(token.minUsd || "0");
    const message = minAmountDec.eq(minUsdDec)
      ? `Minimum deposit is $${token.minUsd}.`
      : `Minimum deposit is $${token.minUsd} (≈${minAmountDec
          .toSignificantDigits(4)
          .toFixed()} ${token.symbol}).`;
    return {
      code: "VALIDATION",
      message,
      retryable: false,
    };
  }
  return null;
}

export function reduceFunding(
  state: FundingState,
  event: FundingEvent
): [FundingState, FundingEffect[]] {
  // RESET / ACCOUNT_CHANGED: from any step, bump epoch, drop everything.
  if (event.type === "RESET" || event.type === "ACCOUNT_CHANGED") {
    return [
      {
        step: "idle",
        corr: {
          epoch: state.corr.epoch + 1,
          latest: {},
          nextEffectId: state.corr.nextEffectId,
          address: "",
          walletMode: undefined,
        },
      },
      [],
    ];
  }

  switch (state.step) {
    case "idle": {
      if (event.type === "START") {
        const corr: Correlation = {
          ...state.corr,
          address: event.address ?? "",
          walletMode: event.walletMode,
        };
        if (event.flow === "deposit") {
          return [{ step: "method", flow: "deposit", corr }, []];
        }
        return [
          {
            step: "amount",
            flow: "withdraw",
            token: null,
            amount: "",
            destination: "",
            chainKey: "",
            tokenId: "",
            quote: null,
            quoteLoading: false,
            error: null,
            corr,
          },
          [],
        ];
      }
      return [state, []];
    }

    case "method": {
      if (event.type === "SELECT_METHOD") {
        if (event.method === "wallet") {
          const [corr, effectId] = issue(state.corr, "loadTokens");
          return [
            {
              step: "select-token",
              loading: true,
              tokens: [],
              error: null,
              corr,
            },
            [
              {
                kind: "loadTokens",
                effectId,
                epoch: corr.epoch,
                source: event.source,
              },
            ],
          ];
        }
        const [corr, effectId] = issue(state.corr, "loadBridgeAssets");
        return [
          {
            step: "select-bridge-asset",
            loading: true,
            assets: [],
            allAssets: [],
            query: "",
            error: null,
            corr,
          },
          [{ kind: "loadBridgeAssets", effectId, epoch: corr.epoch }],
        ];
      }
      if (event.type === "BACK") {
        return [{ step: "idle", corr: state.corr }, []];
      }
      return [state, []];
    }

    case "select-token": {
      if (event.type === "TOKENS_LOADED") {
        if (staleResult(state.corr, "loadTokens", event)) return [state, []];
        return [
          { ...state, loading: false, tokens: event.tokens, error: null },
          [],
        ];
      }
      if (event.type === "LOAD_FAILED") {
        if (staleResult(state.corr, "loadTokens", event)) return [state, []];
        return [{ ...state, loading: false, error: event.error }, []];
      }
      if (event.type === "SELECT_TOKEN") {
        return [
          {
            step: "amount",
            flow: "deposit",
            token: event.token,
            amount: "",
            destination: "",
            chainKey: "",
            tokenId: "",
            quote: null,
            quoteLoading: false,
            error: null,
            corr: state.corr,
          },
          [],
        ];
      }
      if (event.type === "BACK") {
        return [{ step: "method", flow: "deposit", corr: state.corr }, []];
      }
      return [state, []];
    }

    case "select-bridge-asset": {
      if (event.type === "ASSETS_LOADED") {
        if (staleResult(state.corr, "loadBridgeAssets", event))
          return [state, []];
        return [
          {
            ...state,
            loading: false,
            allAssets: event.assets,
            assets: filterBridgeAssets(event.assets, state.query),
            error: null,
          },
          [],
        ];
      }
      if (event.type === "LOAD_FAILED") {
        if (staleResult(state.corr, "loadBridgeAssets", event))
          return [state, []];
        return [{ ...state, loading: false, error: event.error }, []];
      }
      if (event.type === "SET_QUERY") {
        return [
          {
            ...state,
            query: event.query,
            assets: filterBridgeAssets(state.allAssets, event.query),
          },
          [],
        ];
      }
      if (event.type === "SELECT_BRIDGE_ASSET") {
        const [corr, effectId] = issue(state.corr, "resolveBridgeAddress");
        return [
          {
            step: "bridge-address-ready",
            asset: event.asset,
            loading: true,
            depositAddress: null,
            error: null,
            corr,
          },
          [
            {
              kind: "resolveBridgeAddress",
              effectId,
              epoch: corr.epoch,
              asset: event.asset,
            },
          ],
        ];
      }
      if (event.type === "BACK") {
        return [{ step: "method", flow: "deposit", corr: state.corr }, []];
      }
      return [state, []];
    }

    case "bridge-address-ready": {
      // Passive branch: intentionally NO case handles SUBMIT here — it must
      // never reach "submitting" (see the exhaustive test in machine.test.ts).
      if (event.type === "BRIDGE_ADDRESS_READY") {
        if (staleResult(state.corr, "resolveBridgeAddress", event))
          return [state, []];
        return [
          {
            ...state,
            loading: false,
            depositAddress: event.depositAddress,
            error: null,
          },
          [],
        ];
      }
      if (event.type === "LOAD_FAILED") {
        if (staleResult(state.corr, "resolveBridgeAddress", event))
          return [state, []];
        return [{ ...state, loading: false, error: event.error }, []];
      }
      if (event.type === "BACK") {
        const [corr, effectId] = issue(state.corr, "loadBridgeAssets");
        return [
          {
            step: "select-bridge-asset",
            loading: true,
            assets: [],
            allAssets: [],
            query: "",
            error: null,
            corr,
          },
          [{ kind: "loadBridgeAssets", effectId, epoch: corr.epoch }],
        ];
      }
      return [state, []];
    }

    case "amount": {
      if (event.type === "SET_AMOUNT") {
        return [
          {
            ...state,
            amount: event.amount,
            error: null,
            quote: null,
            quoteLoading: false,
            corr: invalidatePending(state.corr, "fetchQuote"),
          },
          [],
        ];
      }
      if (event.type === "SET_DESTINATION") {
        return [
          {
            ...state,
            destination: event.destination,
            chainKey: event.chainKey,
            tokenId: event.tokenId,
            error: null,
            quote: null,
            quoteLoading: false,
            corr: invalidatePending(state.corr, "fetchQuote"),
          },
          [],
        ];
      }
      if (event.type === "REQUEST_QUOTE") {
        const normalized = normalizeFundingAmount(state.amount);
        if (normalized === null) {
          return [
            {
              ...state,
              error: {
                code: "VALIDATION",
                message: "Enter a valid amount.",
                retryable: false,
              },
            },
            [],
          ];
        }
        const tokenAddress = state.token ? state.token.address : state.tokenId;
        const tokenDecimals = state.token ? state.token.decimals : 0;
        const [corr, effectId] = issue(state.corr, "fetchQuote");
        return [
          { ...state, quoteLoading: true, error: null, corr },
          [
            {
              kind: "fetchQuote",
              effectId,
              epoch: corr.epoch,
              tokenAddress,
              tokenDecimals,
              amount: normalized,
            },
          ],
        ];
      }
      if (event.type === "QUOTE_OK") {
        if (staleResult(state.corr, "fetchQuote", event)) return [state, []];
        if (state.flow === "withdraw") {
          const normalized = normalizeFundingAmount(state.amount);
          if (normalized === null) {
            return [
              {
                ...state,
                quoteLoading: false,
                error: {
                  code: "VALIDATION",
                  message: "Enter a valid amount.",
                  retryable: false,
                },
              },
              [],
            ];
          }
          const command: FundingCommand = {
            flow: "withdraw",
            address: state.corr.address,
            walletMode: state.corr.walletMode,
            amount: normalized,
            destination: state.destination,
            chainKey: state.chainKey,
            tokenId: state.tokenId,
          };
          return [
            {
              step: "confirm",
              command,
              quote: event.quote,
              token: state.token,
              corr: state.corr,
            },
            [],
          ];
        }
        // Deposit: quote is a preview only; stay on "amount" until SUBMIT.
        return [
          { ...state, quote: event.quote, quoteLoading: false, error: null },
          [],
        ];
      }
      if (event.type === "QUOTE_FAILED") {
        if (staleResult(state.corr, "fetchQuote", event)) return [state, []];
        return [{ ...state, quoteLoading: false, error: event.error }, []];
      }
      if (event.type === "SUBMIT") {
        if (state.flow !== "deposit") return [state, []]; // withdraw goes via REQUEST_QUOTE
        if (!state.token) return [state, []];
        const validationError = validateDepositAmount(
          state.token,
          state.amount
        );
        if (validationError) {
          return [{ ...state, error: validationError }, []];
        }
        const normalized = normalizeFundingAmount(state.amount) as string;
        const command: FundingCommand = {
          flow: "deposit",
          address: state.corr.address,
          walletMode: state.corr.walletMode,
          amount: normalized,
          // Cross-chain deposit tokens carry their own source chain; the
          // default wallet flow is always the Polygon transfer.
          chainId: state.token.chainId ?? WALLET_DEPOSIT_CHAIN_ID,
          tokenSymbol: state.token.symbol,
          tokenAddress: state.token.address,
          tokenDecimals: state.token.decimals,
        };
        return [
          {
            step: "confirm",
            command,
            quote: state.quote,
            token: state.token,
            corr: state.corr,
          },
          [],
        ];
      }
      if (event.type === "BACK") {
        if (state.flow === "withdraw") {
          return [{ step: "idle", corr: state.corr }, []];
        }
        const [corr, effectId] = issue(state.corr, "loadTokens");
        return [
          {
            step: "select-token",
            loading: true,
            tokens: [],
            error: null,
            corr,
          },
          [{ kind: "loadTokens", effectId, epoch: corr.epoch }],
        ];
      }
      return [state, []];
    }

    case "confirm": {
      if (event.type === "SUBMIT") {
        const [corr, effectId] = issue(state.corr, "beginAttempt");
        return [
          { step: "submitting", command: state.command, attempt: null, corr },
          [
            {
              kind: "beginAttempt",
              effectId,
              epoch: corr.epoch,
              command: state.command,
            },
          ],
        ];
      }
      if (event.type === "BACK") {
        // Rebuild the "amount" state from the command plus the carried
        // `token` (deposit) so SUBMIT/quote work again after backing out —
        // without the token this would be a silent dead-end (SUBMIT in
        // "amount" no-ops when token is null).
        const command = state.command;
        return [
          {
            step: "amount",
            flow: command.flow,
            token: state.token,
            amount: command.amount,
            destination: command.flow === "withdraw" ? command.destination : "",
            chainKey: command.flow === "withdraw" ? command.chainKey : "",
            tokenId: command.flow === "withdraw" ? command.tokenId : "",
            quote: state.quote,
            quoteLoading: false,
            error: null,
            corr: state.corr,
          },
          [],
        ];
      }
      return [state, []];
    }

    case "submitting": {
      if (event.type === "ATTEMPT_READY") {
        if (staleResult(state.corr, "beginAttempt", event)) return [state, []];
        const attempt = event.attempt;
        if (attempt.phase === "submitted" && attempt.txHash) {
          const kind =
            state.command.flow === "deposit"
              ? "awaitDepositCredit"
              : "pollWithdrawStatus";
          const [corr, effectId] = issue(state.corr, kind);
          return [
            {
              step: "confirming",
              command: state.command,
              attempt,
              phase: state.command.flow === "deposit" ? "credit" : "status",
              corr,
            },
            [{ kind, effectId, epoch: corr.epoch, attempt }],
          ];
        }
        const [corr, effectId] = issue(state.corr, "execute");
        return [
          { step: "submitting", command: state.command, attempt, corr },
          [
            {
              kind: "execute",
              effectId,
              epoch: corr.epoch,
              command: state.command,
              attempt,
            },
          ],
        ];
      }
      if (event.type === "EXECUTED") {
        if (staleResult(state.corr, "execute", event)) return [state, []];
        if (!state.attempt) return [state, []];
        const attempt: FundingAttempt = {
          ...state.attempt,
          txHash: event.txHash,
          phase: "submitted",
        };
        const kind =
          state.command.flow === "deposit"
            ? "awaitDepositCredit"
            : "pollWithdrawStatus";
        const [corr, effectId] = issue(state.corr, kind);
        return [
          {
            step: "confirming",
            command: state.command,
            attempt,
            phase: state.command.flow === "deposit" ? "credit" : "status",
            corr,
          },
          [{ kind, effectId, epoch: corr.epoch, attempt }],
        ];
      }
      if (event.type === "EXECUTION_FAILED") {
        const kind = state.attempt === null ? "beginAttempt" : "execute";
        if (staleResult(state.corr, kind, event)) return [state, []];
        return [
          {
            step: "error",
            error: {
              ...event.error,
              retryable: executionRetryable(event.error.code),
            },
            command: state.command,
            attempt: state.attempt,
            corr: state.corr,
          },
          [],
        ];
      }
      // SUBMIT here (double-click) and BACK are both no-ops (BACK disabled
      // once submitting).
      return [state, []];
    }

    case "confirming": {
      if (event.type === "CREDITED" && state.command.flow === "deposit") {
        if (staleResult(state.corr, "awaitDepositCredit", event))
          return [state, []];
        const [corr, effectId] = issue(state.corr, "completeAttempt");
        return [
          { step: "done", txHash: state.attempt.txHash, corr },
          [
            {
              kind: "completeAttempt",
              effectId,
              epoch: corr.epoch,
              attempt: state.attempt,
              outcome: "credited",
            },
          ],
        ];
      }
      if (
        event.type === "REVERT_CONFIRMED" &&
        state.command.flow === "deposit"
      ) {
        if (staleResult(state.corr, "awaitDepositCredit", event))
          return [state, []];
        const [corr, effectId] = issue(state.corr, "completeAttempt");
        return [
          {
            step: "error",
            error: {
              code: "REVERTED",
              message: "The deposit transaction reverted on-chain.",
              retryable: false,
            },
            command: state.command,
            attempt: state.attempt,
            corr,
          },
          [
            {
              kind: "completeAttempt",
              effectId,
              epoch: corr.epoch,
              attempt: state.attempt,
              outcome: "reverted",
            },
          ],
        ];
      }
      if (event.type === "STATUS_UPDATE" && state.command.flow === "withdraw") {
        if (staleResult(state.corr, "pollWithdrawStatus", event))
          return [state, []];
        if (event.status.status === "pending") {
          return [state, []];
        }
        if (event.status.status === "completed") {
          const [corr, effectId] = issue(state.corr, "completeAttempt");
          return [
            { step: "done", txHash: state.attempt.txHash, corr },
            [
              {
                kind: "completeAttempt",
                effectId,
                epoch: corr.epoch,
                attempt: state.attempt,
                outcome: "credited",
              },
            ],
          ];
        }
        // status === "failed"
        const [corr, effectId] = issue(state.corr, "completeAttempt");
        return [
          {
            step: "error",
            error: {
              code: "EXECUTION_FAILED",
              message: event.status.detail ?? "Withdrawal failed.",
              retryable: true,
            },
            command: state.command,
            attempt: state.attempt,
            corr,
          },
          [
            {
              kind: "completeAttempt",
              effectId,
              epoch: corr.epoch,
              attempt: state.attempt,
              outcome: "reverted",
            },
          ],
        ];
      }
      if (event.type === "CONFIRMATION_UNAVAILABLE") {
        // The controller gave up polling for this attempt's outcome after
        // repeated transport failures. The attempt may or may not have
        // settled on-chain, so this is AMBIGUOUS_OUTCOME (retryable — RETRY
        // re-runs beginAttempt, which resumes the same submitted attempt
        // and re-enters confirming), never a confirmed failure.
        const kind =
          state.command.flow === "deposit"
            ? "awaitDepositCredit"
            : "pollWithdrawStatus";
        if (staleResult(state.corr, kind, event)) return [state, []];
        return [
          {
            step: "error",
            error: {
              code: "AMBIGUOUS_OUTCOME",
              message:
                "We could not confirm the transaction status. Your funds have not been moved twice.",
              retryable: true,
            },
            command: state.command,
            attempt: state.attempt,
            corr: state.corr,
          },
          [],
        ];
      }
      // SUBMIT/BACK are no-ops while confirming.
      return [state, []];
    }

    case "done": {
      return [state, []];
    }

    case "error": {
      if (event.type === "RETRY") {
        if (state.error.retryable && state.command) {
          const [corr, effectId] = issue(state.corr, "beginAttempt");
          return [
            { step: "submitting", command: state.command, attempt: null, corr },
            [
              {
                kind: "beginAttempt",
                effectId,
                epoch: corr.epoch,
                command: state.command,
              },
            ],
          ];
        }
        return [state, []];
      }
      return [state, []];
    }

    default:
      return [state, []];
  }
}
