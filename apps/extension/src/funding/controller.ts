// apps/extension/src/funding/controller.ts
// Effect runner for the pure funding machine. Owns the current FundingState
// plus a listener set, drives every FundingEffect the reducer emits through
// a FundingGateway, and dispatches the gateway's outcome back in as the
// matching result event. The reducer's epoch/effectId correlation guard
// (see machine.ts) is the single source of truth for staleness — this
// module only threads the effect's own {epoch, effectId} into the event it
// constructs; it never re-derives them from "current" state.
import { createLogger } from "@knoww/logger";
import { type FundingGateway, FundingGatewayError } from "./gateway";
import {
  type FundingEffect,
  type FundingEvent,
  type FundingState,
  initialFundingState,
  reduceFunding,
} from "./machine";
import type { FundingError } from "./types";

const log = createLogger("funding.controller");

const DEFAULT_QUOTE_DEBOUNCE_MS = 300;
const DEFAULT_STATUS_POLL_MS = 4000;

const GENERIC_EXECUTION_MESSAGE =
  "Something went wrong. Your funds have not been moved twice.";
const GENERIC_READ_MESSAGE = "Could not load data.";

const EXECUTION_EFFECT_KINDS = new Set<FundingEffect["kind"]>([
  "beginAttempt",
  "execute",
]);

/** Consecutive transport failures of one confirmation-polling effect before
 * the controller stops rescheduling and dispatches CONFIRMATION_UNAVAILABLE. */
const MAX_CONFIRMATION_FAILURES = 5;

/** Consecutive "pending" withdraw-status resolutions for one polling effect
 * before the controller stops rescheduling and dispatches
 * CONFIRMATION_UNAVAILABLE, so a stuck bridge can't spin forever. Matches
 * the old sidepanel's 40-poll cap for parity. */
const MAX_STATUS_PENDING_POLLS = 40;

export interface FundingController {
  getState(): FundingState;
  dispatch(event: FundingEvent): void;
  subscribe(listener: (state: FundingState) => void): () => void;
  dispose(): void;
}

export interface FundingControllerOptions {
  quoteDebounceMs?: number;
  statusPollMs?: number;
}

type FetchQuoteEffect = Extract<FundingEffect, { kind: "fetchQuote" }>;
type AwaitDepositCreditEffect = Extract<
  FundingEffect,
  { kind: "awaitDepositCredit" }
>;
type PollWithdrawStatusEffect = Extract<
  FundingEffect,
  { kind: "pollWithdrawStatus" }
>;

type PollingKind = "awaitDepositCredit" | "pollWithdrawStatus";

interface PollingTracker {
  epoch: number;
  effectId: number;
  /** Consecutive transport failures for this exact effect identity. */
  failures: number;
  /** Consecutive "pending" resolutions for this exact effect identity.
   * Only meaningful for the pollWithdrawStatus kind. */
  pendingPolls: number;
}

/**
 * Maps a gateway rejection to the FundingError the reducer expects.
 * `FundingGatewayError` carries its own payload verbatim; anything else
 * becomes a generic, safe message — the raw error is logged (never
 * rendered) via the scoped `funding.controller` logger.
 */
function toFundingError(
  kind: FundingEffect["kind"],
  reason: unknown
): FundingError {
  if (reason instanceof FundingGatewayError) {
    return reason.funding;
  }
  log.error(`${kind}.rejected`, reason);
  if (EXECUTION_EFFECT_KINDS.has(kind)) {
    return {
      code: "EXECUTION_FAILED",
      message: GENERIC_EXECUTION_MESSAGE,
      retryable: false,
    };
  }
  if (kind === "fetchQuote") {
    return {
      code: "QUOTE_FAILED",
      message: GENERIC_READ_MESSAGE,
      retryable: false,
    };
  }
  return {
    code: "LOAD_FAILED",
    message: GENERIC_READ_MESSAGE,
    retryable: false,
  };
}

/** Compile-time exhaustiveness for runEffect: adding a FundingEffect kind
 * without a case above fails to type-check the call site. */
function assertNeverEffect(effect: never): void {
  log.error("effect.unhandled", effect);
}

export function createFundingController(
  gateway: FundingGateway,
  options: FundingControllerOptions = {}
): FundingController {
  const quoteDebounceMs = options.quoteDebounceMs ?? DEFAULT_QUOTE_DEBOUNCE_MS;
  const statusPollMs = options.statusPollMs ?? DEFAULT_STATUS_POLL_MS;

  let state: FundingState = initialFundingState;
  const listeners = new Set<(nextState: FundingState) => void>();
  let disposed = false;

  let quoteDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingQuoteEffect: FetchQuoteEffect | null = null;
  const rescheduleTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Latest confirmation-polling effect issued per kind, with its
   * consecutive-transport-failure count. Controller-local so the controller
   * never reads the machine's internal correlation bookkeeping. */
  const pollingTrackers = new Map<PollingKind, PollingTracker>();

  function notify(): void {
    if (disposed) return;
    for (const listener of listeners) listener(state);
  }

  function clearTransientWork(): void {
    if (quoteDebounceTimer !== null) {
      clearTimeout(quoteDebounceTimer);
      quoteDebounceTimer = null;
    }
    pendingQuoteEffect = null;
    for (const timer of rescheduleTimers) clearTimeout(timer);
    rescheduleTimers.clear();
    pollingTrackers.clear();
  }

  function dispatch(event: FundingEvent): void {
    if (disposed) return;
    if (event.type === "START" && state.step !== "idle") {
      // The machine drops START from any non-idle step (by design), and the
      // callers' screens render nothing new for a dropped one — a silent drop
      // here has surfaced as a stuck loading screen before. Make it visible.
      log.warn("START dropped: machine not idle", { step: state.step });
    }
    if (event.type === "RESET" || event.type === "ACCOUNT_CHANGED") {
      // The machine drops everything and bumps its epoch; kill any pending
      // debounced quote or scheduled re-poll so no zombie gateway call
      // fires for the abandoned flow.
      clearTransientWork();
    }
    const [next, effects] = reduceFunding(state, event);
    state = next;
    notify();
    for (const effect of effects) runEffect(effect);
  }

  function scheduleReschedule(fn: () => void): void {
    if (disposed) return;
    const timer = setTimeout(() => {
      rescheduleTimers.delete(timer);
      if (disposed) return;
      fn();
    }, statusPollMs);
    rescheduleTimers.add(timer);
  }

  /**
   * Records the machine issuing a fresh confirmation-polling effect: it
   * becomes the latest identity for its kind and its failure count resets.
   */
  function trackPollingEffect(
    kind: PollingKind,
    effect: AwaitDepositCreditEffect | PollWithdrawStatusEffect
  ): void {
    pollingTrackers.set(kind, {
      epoch: effect.epoch,
      effectId: effect.effectId,
      failures: 0,
      pendingPolls: 0,
    });
  }

  /**
   * True while the given confirmation-polling effect is still the one the
   * controller most recently started for its kind AND the state is still
   * confirming. Used only to avoid pointless zombie network calls once a
   * RETRY has moved on to a new attempt — the reducer's own correlation
   * guard is what actually protects correctness regardless of this check.
   */
  function isStillAwaited(
    kind: PollingKind,
    epoch: number,
    effectId: number
  ): boolean {
    const tracker = pollingTrackers.get(kind);
    return (
      state.step === "confirming" &&
      tracker !== undefined &&
      tracker.epoch === epoch &&
      tracker.effectId === effectId
    );
  }

  /** A polling gateway call resolved for the still-current effect: any
   * consecutive-failure streak is over. */
  function resetPollingFailures(
    kind: PollingKind,
    epoch: number,
    effectId: number
  ): void {
    const tracker = pollingTrackers.get(kind);
    if (
      tracker !== undefined &&
      tracker.epoch === epoch &&
      tracker.effectId === effectId
    ) {
      tracker.failures = 0;
    }
  }

  /** A withdraw-status poll resolved to something other than "pending" (or
   * the identity has moved on): the consecutive-pending streak is over. */
  function resetPendingPolls(
    kind: PollingKind,
    epoch: number,
    effectId: number
  ): void {
    const tracker = pollingTrackers.get(kind);
    if (
      tracker !== undefined &&
      tracker.epoch === epoch &&
      tracker.effectId === effectId
    ) {
      tracker.pendingPolls = 0;
    }
  }

  /**
   * A withdraw-status poll resolved "pending" for the still-current effect:
   * bump and return its consecutive-pending count. Returns `null` if the
   * identity has moved on (a RETRY started a new attempt/effect), meaning
   * the caller must not reschedule or cap-check this stale streak.
   */
  function incrementPendingPolls(
    kind: PollingKind,
    epoch: number,
    effectId: number
  ): number | null {
    const tracker = pollingTrackers.get(kind);
    if (
      tracker === undefined ||
      tracker.epoch !== epoch ||
      tracker.effectId !== effectId
    ) {
      return null;
    }
    tracker.pendingPolls += 1;
    return tracker.pendingPolls;
  }

  /**
   * A polling gateway call rejected (transport failure — NOT a resolved
   * "reverted"/"failed" outcome). Reschedule the same effect while under
   * the cap; at MAX_CONFIRMATION_FAILURES consecutive failures, surface
   * CONFIRMATION_UNAVAILABLE so the machine can move to a retryable
   * AMBIGUOUS_OUTCOME error instead of silently spinning forever.
   */
  function handlePollingRejection(
    kind: PollingKind,
    effect: AwaitDepositCreditEffect | PollWithdrawStatusEffect,
    rerun: () => void
  ): void {
    if (!isStillAwaited(kind, effect.epoch, effect.effectId)) return;
    const tracker = pollingTrackers.get(kind);
    if (tracker === undefined) return;
    tracker.failures += 1;
    if (tracker.failures >= MAX_CONFIRMATION_FAILURES) {
      dispatch({
        type: "CONFIRMATION_UNAVAILABLE",
        epoch: effect.epoch,
        effectId: effect.effectId,
      });
      return;
    }
    scheduleReschedule(rerun);
  }

  function runAwaitDepositCredit(effect: AwaitDepositCreditEffect): void {
    gateway
      .awaitDepositCredit(effect.attempt)
      .then((outcome) => {
        resetPollingFailures(
          "awaitDepositCredit",
          effect.epoch,
          effect.effectId
        );
        dispatch({
          type: outcome === "credited" ? "CREDITED" : "REVERT_CONFIRMED",
          epoch: effect.epoch,
          effectId: effect.effectId,
        });
      })
      .catch((reason) => {
        log.error("awaitDepositCredit.rejected", reason);
        handlePollingRejection("awaitDepositCredit", effect, () =>
          runAwaitDepositCredit(effect)
        );
      });
  }

  function runPollWithdrawStatus(effect: PollWithdrawStatusEffect): void {
    gateway
      .pollWithdrawStatus(effect.attempt)
      .then((status) => {
        resetPollingFailures(
          "pollWithdrawStatus",
          effect.epoch,
          effect.effectId
        );
        dispatch({
          type: "STATUS_UPDATE",
          status,
          epoch: effect.epoch,
          effectId: effect.effectId,
        });
        if (status.status !== "pending") {
          resetPendingPolls(
            "pollWithdrawStatus",
            effect.epoch,
            effect.effectId
          );
          return;
        }
        if (
          !isStillAwaited("pollWithdrawStatus", effect.epoch, effect.effectId)
        ) {
          return;
        }
        const pendingPolls = incrementPendingPolls(
          "pollWithdrawStatus",
          effect.epoch,
          effect.effectId
        );
        if (pendingPolls !== null && pendingPolls >= MAX_STATUS_PENDING_POLLS) {
          dispatch({
            type: "CONFIRMATION_UNAVAILABLE",
            epoch: effect.epoch,
            effectId: effect.effectId,
          });
          return;
        }
        scheduleReschedule(() => runPollWithdrawStatus(effect));
      })
      .catch((reason) => {
        log.error("pollWithdrawStatus.rejected", reason);
        handlePollingRejection("pollWithdrawStatus", effect, () =>
          runPollWithdrawStatus(effect)
        );
      });
  }

  function runFetchQuote(effect: FetchQuoteEffect): void {
    gateway
      .fetchQuote({
        tokenAddress: effect.tokenAddress,
        tokenDecimals: effect.tokenDecimals,
        amount: effect.amount,
      })
      .then((quote) => {
        dispatch({
          type: "QUOTE_OK",
          quote,
          epoch: effect.epoch,
          effectId: effect.effectId,
        });
      })
      .catch((reason) => {
        dispatch({
          type: "QUOTE_FAILED",
          error: toFundingError("fetchQuote", reason),
          epoch: effect.epoch,
          effectId: effect.effectId,
        });
      });
  }

  /** `fetchQuote` is debounced: only the most recently issued effect within
   * the window is ever actually sent to the gateway. */
  function scheduleQuote(effect: FetchQuoteEffect): void {
    pendingQuoteEffect = effect;
    if (quoteDebounceTimer !== null) clearTimeout(quoteDebounceTimer);
    quoteDebounceTimer = setTimeout(() => {
      quoteDebounceTimer = null;
      const toRun = pendingQuoteEffect;
      pendingQuoteEffect = null;
      if (toRun) runFetchQuote(toRun);
    }, quoteDebounceMs);
  }

  function runEffect(effect: FundingEffect): void {
    switch (effect.kind) {
      case "loadTokens":
        gateway
          .loadWalletTokens(effect.source)
          .then((tokens) => {
            dispatch({
              type: "TOKENS_LOADED",
              tokens,
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          })
          .catch((reason) => {
            dispatch({
              type: "LOAD_FAILED",
              error: toFundingError(effect.kind, reason),
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          });
        return;

      case "loadBridgeAssets":
        gateway
          .loadBridgeAssets()
          .then((assets) => {
            dispatch({
              type: "ASSETS_LOADED",
              assets,
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          })
          .catch((reason) => {
            dispatch({
              type: "LOAD_FAILED",
              error: toFundingError(effect.kind, reason),
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          });
        return;

      case "resolveBridgeAddress":
        gateway
          .resolveBridgeAddress(effect.asset)
          .then((depositAddress) => {
            dispatch({
              type: "BRIDGE_ADDRESS_READY",
              depositAddress,
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          })
          .catch((reason) => {
            dispatch({
              type: "LOAD_FAILED",
              error: toFundingError(effect.kind, reason),
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          });
        return;

      case "fetchQuote":
        scheduleQuote(effect);
        return;

      case "beginAttempt":
        gateway
          .beginAttempt(effect.command)
          .then((attempt) => {
            dispatch({
              type: "ATTEMPT_READY",
              attempt,
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          })
          .catch((reason) => {
            dispatch({
              type: "EXECUTION_FAILED",
              error: toFundingError(effect.kind, reason),
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          });
        return;

      case "execute":
        gateway
          .execute(effect.command, effect.attempt)
          .then((result) => {
            dispatch({
              type: "EXECUTED",
              txHash: result.txHash,
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          })
          .catch((reason) => {
            dispatch({
              type: "EXECUTION_FAILED",
              error: toFundingError(effect.kind, reason),
              epoch: effect.epoch,
              effectId: effect.effectId,
            });
          });
        return;

      case "awaitDepositCredit":
        trackPollingEffect("awaitDepositCredit", effect);
        runAwaitDepositCredit(effect);
        return;

      case "pollWithdrawStatus":
        trackPollingEffect("pollWithdrawStatus", effect);
        runPollWithdrawStatus(effect);
        return;

      case "completeAttempt":
        // Fire-and-forget: the machine has already reached done/error, so a
        // transport failure here must not change UI state. The background
        // store prunes/no-ops idempotently (Task 2) — just log it.
        gateway
          .completeAttempt(effect.attempt, effect.outcome)
          .catch((reason) => {
            log.error("completeAttempt.rejected", reason);
          });
        return;

      default:
        assertNeverEffect(effect);
        return;
    }
  }

  return {
    getState() {
      return state;
    },
    dispatch,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      clearTransientWork();
    },
  };
}
