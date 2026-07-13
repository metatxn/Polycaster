import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFundingController,
  type FundingController,
} from "../../src/funding/controller";
import {
  type FundingGateway,
  FundingGatewayError,
} from "../../src/funding/gateway";
import type { FundingState } from "../../src/funding/machine";
import type {
  FundingAttempt,
  FundingQuote,
  FundingStatusResult,
  FundingToken,
} from "../../src/funding/types";

const ADDRESS = `0x${"a".repeat(40)}`;

const token: FundingToken = {
  symbol: "USDC.e",
  name: "USD Coin",
  address: `0x${"1".repeat(40)}`,
  decimals: 6,
  balanceRaw: "100000000",
  balanceDisplay: "100",
  usdValue: "100",
  minUsd: "1",
  minAmount: "1", // USD-pegged: token-unit floor equals the USD floor
  depositSupported: true,
  depositDisabledReason: null,
};

function makeAttempt(overrides: Partial<FundingAttempt> = {}): FundingAttempt {
  return {
    attemptId: "attempt-1",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    fingerprint: "fingerprint-1",
    txHash: null,
    phase: "none",
    ...overrides,
  };
}

function makeQuote(overrides: Partial<FundingQuote> = {}): FundingQuote {
  return {
    quoteId: "quote-1",
    estOutputPusd: "9.9",
    estInputUsd: "10",
    totalImpactUsd: "0.1",
    ...overrides,
  };
}

/** Fake gateway: every method is a plain `vi.fn()` with no default
 * implementation — each test wires up exactly the calls it expects via
 * `mockResolvedValueOnce`/`mockRejectedValueOnce`/`mockReturnValueOnce`. */
function createFakeGateway() {
  return {
    loadWalletTokens: vi.fn(),
    loadBridgeAssets: vi.fn(),
    resolveBridgeAddress: vi.fn(),
    fetchQuote: vi.fn(),
    beginAttempt: vi.fn(),
    execute: vi.fn(),
    awaitDepositCredit: vi.fn(),
    pollWithdrawStatus: vi.fn(),
    completeAttempt: vi.fn(),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drains the microtask queue via a real macrotask boundary. Every
 * gateway-call -> dispatch cascade in the controller is microtask-only
 * (no timers), so Node/V8 fully processes the whole chain — however many
 * hops — before this resolves. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertStep<S extends FundingState["step"]>(
  state: FundingState,
  step: S
): asserts state is Extract<FundingState, { step: S }> {
  if (state.step !== step) {
    throw new Error(`expected step "${step}" but got "${state.step}"`);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

async function driveToDepositAmount(
  gateway: FundingGateway,
  controller: FundingController,
  tokens: FundingToken[] = [token]
): Promise<void> {
  (gateway.loadWalletTokens as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    tokens
  );
  controller.dispatch({ type: "START", flow: "deposit", address: ADDRESS });
  controller.dispatch({ type: "SELECT_METHOD", method: "wallet" });
  await flush();
  controller.dispatch({ type: "SELECT_TOKEN", token: tokens[0] });
}

/** Drains chained microtasks under FAKE timers (where `flush()`'s real
 * setTimeout would never fire). Each loop iteration yields one microtask
 * hop; the longest controller cascade is well under 25 hops. */
async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

/**
 * Fake-timer variant: drives a withdraw flow to "confirming". Requires
 * `vi.useFakeTimers()` active and a `quoteDebounceMs: 0` controller.
 * `pollWithdrawStatus` mocks must be configured BEFORE calling this — the
 * first poll fires during the final settle. Returns the attempt as it looks
 * after execution (phase "submitted", txHash "0xw1").
 */
async function driveWithdrawToConfirming(
  gw: ReturnType<typeof createFakeGateway>,
  controller: FundingController
): Promise<FundingAttempt> {
  controller.dispatch({ type: "START", flow: "withdraw", address: ADDRESS });
  controller.dispatch({
    type: "SET_DESTINATION",
    destination: `0x${"d".repeat(40)}`,
    chainKey: "137",
    tokenId: "usdc-poly",
  });
  controller.dispatch({ type: "SET_AMOUNT", amount: "10" });

  gw.fetchQuote.mockResolvedValueOnce(makeQuote());
  controller.dispatch({ type: "REQUEST_QUOTE" });
  await vi.advanceTimersByTimeAsync(0); // fire the 0ms quote debounce
  await settleMicrotasks();
  assertStep(controller.getState(), "confirm");

  const attempt = makeAttempt({ attemptId: "attempt-w1" });
  gw.beginAttempt.mockResolvedValueOnce(attempt);
  gw.execute.mockResolvedValueOnce({ txHash: "0xw1" });
  controller.dispatch({ type: "SUBMIT" });
  await settleMicrotasks();
  assertStep(controller.getState(), "confirming");
  return { ...attempt, phase: "submitted", txHash: "0xw1" };
}

describe("createFundingController", () => {
  it("happy deposit: beginAttempt -> execute -> awaitDepositCredit -> completeAttempt(credited), ending in done", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw);

    await driveToDepositAmount(gw, controller);
    controller.dispatch({ type: "SET_AMOUNT", amount: "10" });
    controller.dispatch({ type: "SUBMIT" }); // amount -> confirm

    const confirmState = controller.getState();
    assertStep(confirmState, "confirm");
    const command = confirmState.command;

    const attempt = makeAttempt();
    gw.beginAttempt.mockResolvedValueOnce(attempt);
    gw.execute.mockResolvedValueOnce({ txHash: "0xexec" });
    gw.awaitDepositCredit.mockResolvedValueOnce("credited");
    gw.completeAttempt.mockResolvedValueOnce(undefined);

    controller.dispatch({ type: "SUBMIT" }); // confirm -> submitting
    await flush();

    expect(gw.beginAttempt).toHaveBeenCalledWith(command);
    expect(gw.execute).toHaveBeenCalledWith(command, attempt);
    expect(gw.awaitDepositCredit).toHaveBeenCalledWith({
      ...attempt,
      txHash: "0xexec",
      phase: "submitted",
    });
    expect(gw.completeAttempt).toHaveBeenCalledWith(
      { ...attempt, txHash: "0xexec", phase: "submitted" },
      "credited"
    );

    const finalState = controller.getState();
    assertStep(finalState, "done");
    expect(finalState.txHash).toBe("0xexec");
  });

  it("resume: beginAttempt resolves an already-submitted attempt so execute is never called", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw);

    await driveToDepositAmount(gw, controller);
    controller.dispatch({ type: "SET_AMOUNT", amount: "10" });
    controller.dispatch({ type: "SUBMIT" });

    const resumedAttempt = makeAttempt({ phase: "submitted", txHash: "0xabc" });
    gw.beginAttempt.mockResolvedValueOnce(resumedAttempt);
    gw.awaitDepositCredit.mockResolvedValueOnce("credited");
    gw.completeAttempt.mockResolvedValueOnce(undefined);

    controller.dispatch({ type: "SUBMIT" });
    await flush();

    expect(gw.execute).not.toHaveBeenCalled();
    expect(gw.awaitDepositCredit).toHaveBeenCalledWith(resumedAttempt);

    const finalState = controller.getState();
    assertStep(finalState, "done");
    expect(finalState.txHash).toBe("0xabc");
  });

  it("ambiguous: execute rejects AMBIGUOUS_OUTCOME -> retryable error; RETRY re-issues beginAttempt with the same command and resumes without a second execute", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw);

    await driveToDepositAmount(gw, controller);
    controller.dispatch({ type: "SET_AMOUNT", amount: "10" });
    controller.dispatch({ type: "SUBMIT" });

    const confirmState = controller.getState();
    assertStep(confirmState, "confirm");
    const command = confirmState.command;

    const freshAttempt = makeAttempt();
    gw.beginAttempt.mockResolvedValueOnce(freshAttempt);
    gw.execute.mockRejectedValueOnce(
      new FundingGatewayError({
        code: "AMBIGUOUS_OUTCOME",
        message: "Could not confirm whether the transaction was sent.",
        retryable: true,
      })
    );
    controller.dispatch({ type: "SUBMIT" });
    await flush();

    const errorState = controller.getState();
    assertStep(errorState, "error");
    expect(errorState.error.code).toBe("AMBIGUOUS_OUTCOME");
    expect(errorState.error.retryable).toBe(true);

    const resumedAttempt = makeAttempt({ phase: "submitted", txHash: "0xabc" });
    gw.beginAttempt.mockResolvedValueOnce(resumedAttempt);
    gw.awaitDepositCredit.mockResolvedValueOnce("credited");
    gw.completeAttempt.mockResolvedValueOnce(undefined);

    controller.dispatch({ type: "RETRY" });
    await flush();

    expect(gw.beginAttempt).toHaveBeenCalledTimes(2);
    expect(gw.beginAttempt).toHaveBeenNthCalledWith(2, command);
    expect(gw.execute).toHaveBeenCalledTimes(1);

    const finalState = controller.getState();
    assertStep(finalState, "done");
  });

  it("PENDING_RECONCILIATION rejection from beginAttempt is a non-retryable error and RETRY does nothing", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw);

    await driveToDepositAmount(gw, controller);
    controller.dispatch({ type: "SET_AMOUNT", amount: "10" });
    controller.dispatch({ type: "SUBMIT" });

    gw.beginAttempt.mockRejectedValueOnce(
      new FundingGatewayError({
        code: "PENDING_RECONCILIATION",
        message: "A prior attempt is still reconciling.",
        retryable: false,
      })
    );
    controller.dispatch({ type: "SUBMIT" });
    await flush();

    const errorState = controller.getState();
    assertStep(errorState, "error");
    expect(errorState.error.code).toBe("PENDING_RECONCILIATION");
    expect(errorState.error.retryable).toBe(false);

    controller.dispatch({ type: "RETRY" });
    await flush();

    expect(gw.beginAttempt).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual(errorState);
  });

  it("IDEMPOTENCY_FINGERPRINT_MISMATCH rejection from beginAttempt is a non-retryable error and RETRY does nothing", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw);

    await driveToDepositAmount(gw, controller);
    controller.dispatch({ type: "SET_AMOUNT", amount: "10" });
    controller.dispatch({ type: "SUBMIT" });

    gw.beginAttempt.mockRejectedValueOnce(
      new FundingGatewayError({
        code: "IDEMPOTENCY_FINGERPRINT_MISMATCH",
        message: "This command no longer matches the stored attempt.",
        retryable: false,
      })
    );
    controller.dispatch({ type: "SUBMIT" });
    await flush();

    const errorState = controller.getState();
    assertStep(errorState, "error");
    expect(errorState.error.code).toBe("IDEMPOTENCY_FINGERPRINT_MISMATCH");
    expect(errorState.error.retryable).toBe(false);

    controller.dispatch({ type: "RETRY" });
    await flush();

    expect(gw.beginAttempt).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual(errorState);
  });

  it("dispose() prevents listener calls even after a pending quote promise later resolves", async () => {
    vi.useFakeTimers();
    const gw = createFakeGateway();
    const controller = createFundingController(gw, { quoteDebounceMs: 10 });
    const listener = vi.fn();
    controller.subscribe(listener);

    gw.loadWalletTokens.mockResolvedValueOnce([token]);
    controller.dispatch({ type: "START", flow: "deposit", address: ADDRESS });
    controller.dispatch({ type: "SELECT_METHOD", method: "wallet" });
    await vi.advanceTimersByTimeAsync(0);
    controller.dispatch({ type: "SELECT_TOKEN", token });
    controller.dispatch({ type: "SET_AMOUNT", amount: "10" });

    const quotePromise = deferred<FundingQuote>();
    gw.fetchQuote.mockReturnValueOnce(quotePromise.promise);
    controller.dispatch({ type: "REQUEST_QUOTE" });
    await vi.advanceTimersByTimeAsync(10); // fires the debounce timer

    expect(gw.fetchQuote).toHaveBeenCalledTimes(1);

    const callsBeforeDispose = listener.mock.calls.length;
    controller.dispose();

    quotePromise.resolve(makeQuote());
    await vi.advanceTimersByTimeAsync(0);

    expect(listener.mock.calls.length).toBe(callsBeforeDispose);
  });

  it("quote debounce: two SET_AMOUNT+REQUEST_QUOTE bursts within the window produce one fetchQuote call", async () => {
    vi.useFakeTimers();
    const gw = createFakeGateway();
    const controller = createFundingController(gw, { quoteDebounceMs: 50 });

    gw.loadWalletTokens.mockResolvedValueOnce([token]);
    controller.dispatch({ type: "START", flow: "deposit", address: ADDRESS });
    controller.dispatch({ type: "SELECT_METHOD", method: "wallet" });
    await vi.advanceTimersByTimeAsync(0);
    controller.dispatch({ type: "SELECT_TOKEN", token });

    gw.fetchQuote.mockResolvedValue(makeQuote({ quoteId: "quote-final" }));

    controller.dispatch({ type: "SET_AMOUNT", amount: "10" });
    controller.dispatch({ type: "REQUEST_QUOTE" });
    await vi.advanceTimersByTimeAsync(20); // still inside the debounce window

    controller.dispatch({ type: "SET_AMOUNT", amount: "20" });
    controller.dispatch({ type: "REQUEST_QUOTE" });
    await vi.advanceTimersByTimeAsync(50); // now the (reset) timer fires

    expect(gw.fetchQuote).toHaveBeenCalledTimes(1);
    expect(gw.fetchQuote).toHaveBeenCalledWith({
      tokenAddress: token.address,
      tokenDecimals: token.decimals,
      amount: "20",
    });
  });

  it("stale poll: an older pollWithdrawStatus resolution arriving after RETRY does not transition the resumed attempt", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw, { quoteDebounceMs: 0 });

    controller.dispatch({ type: "START", flow: "withdraw", address: ADDRESS });
    controller.dispatch({
      type: "SET_DESTINATION",
      destination: `0x${"d".repeat(40)}`,
      chainKey: "137",
      tokenId: "usdc-poly",
    });
    controller.dispatch({ type: "SET_AMOUNT", amount: "10" });

    gw.fetchQuote.mockResolvedValueOnce(makeQuote());
    controller.dispatch({ type: "REQUEST_QUOTE" });
    await flush();

    assertStep(controller.getState(), "confirm");

    const attempt1 = makeAttempt({ attemptId: "attempt-w1" });
    gw.beginAttempt.mockResolvedValueOnce(attempt1);
    gw.execute.mockResolvedValueOnce({ txHash: "0xw1" });
    const poll1 = deferred<FundingStatusResult>();
    gw.pollWithdrawStatus.mockReturnValueOnce(poll1.promise);

    controller.dispatch({ type: "SUBMIT" });
    await flush();

    const confirmingState = controller.getState();
    assertStep(confirmingState, "confirming");
    const staleEpoch = confirmingState.corr.epoch;
    const staleEffectId = confirmingState.corr.latest.pollWithdrawStatus;
    expect(staleEffectId).toBeTypeOf("number");

    // Resolve the first poll as "failed" -> reaches a retryable error state.
    poll1.resolve({ status: "failed", detail: "boom" });
    await flush();

    const errorState = controller.getState();
    assertStep(errorState, "error");
    expect(errorState.error.retryable).toBe(true);

    const resumedAttempt = {
      ...attempt1,
      phase: "submitted" as const,
      txHash: "0xw1",
    };
    gw.beginAttempt.mockResolvedValueOnce(resumedAttempt);
    const poll2 = deferred<FundingStatusResult>(); // deliberately left pending
    gw.pollWithdrawStatus.mockReturnValueOnce(poll2.promise);

    controller.dispatch({ type: "RETRY" });
    await flush();

    const confirming2 = controller.getState();
    assertStep(confirming2, "confirming");
    expect(confirming2.corr.latest.pollWithdrawStatus).not.toBe(staleEffectId);
    expect(confirming2.attempt).toEqual(resumedAttempt);

    // A duplicate/delayed resolution for the OLD (pre-RETRY) poll effect
    // arrives late, carrying the stale {epoch, effectId} captured above.
    controller.dispatch({
      type: "STATUS_UPDATE",
      status: { status: "completed", detail: null },
      epoch: staleEpoch,
      effectId: staleEffectId as number,
    });
    await flush();

    const finalState = controller.getState();
    assertStep(finalState, "confirming");
    expect(finalState.attempt).toEqual(resumedAttempt);
  });

  it("a non-FundingGatewayError rejection from execute surfaces as the generic safe copy, not the raw message", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw);

    await driveToDepositAmount(gw, controller);
    controller.dispatch({ type: "SET_AMOUNT", amount: "10" });
    controller.dispatch({ type: "SUBMIT" });

    gw.beginAttempt.mockResolvedValueOnce(makeAttempt());
    gw.execute.mockRejectedValueOnce(
      new Error("stack trace with internal implementation details")
    );
    controller.dispatch({ type: "SUBMIT" });
    await flush();

    const errorState = controller.getState();
    assertStep(errorState, "error");
    expect(errorState.error.code).toBe("EXECUTION_FAILED");
    expect(errorState.error.message).toBe(
      "Something went wrong. Your funds have not been moved twice."
    );
    expect(errorState.error.message).not.toContain("internal implementation");
  });

  it("a non-FundingGatewayError rejection from a read (loadWalletTokens) surfaces as the generic safe copy, not the raw message", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw);

    gw.loadWalletTokens.mockRejectedValueOnce(
      new Error("internal connection string leaked")
    );
    controller.dispatch({ type: "START", flow: "deposit", address: ADDRESS });
    controller.dispatch({ type: "SELECT_METHOD", method: "wallet" });
    await flush();

    const state = controller.getState();
    assertStep(state, "select-token");
    expect(state.error?.code).toBe("LOAD_FAILED");
    expect(state.error?.message).toBe("Could not load data.");
    expect(state.error?.message).not.toContain("leaked");
  });

  it("threads the loadTokens effect's source into gateway.loadWalletTokens", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw);

    gw.loadWalletTokens.mockResolvedValueOnce([token]);
    controller.dispatch({ type: "START", flow: "deposit", address: ADDRESS });
    controller.dispatch({
      type: "SELECT_METHOD",
      method: "wallet",
      source: "cross-chain",
    });
    await flush();

    expect(gw.loadWalletTokens).toHaveBeenCalledWith("cross-chain");
    assertStep(controller.getState(), "select-token");
  });

  it("subscribe returns an unsubscribe function that stops further notifications", async () => {
    const gw = createFakeGateway();
    const controller = createFundingController(gw);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.dispatch({ type: "START", flow: "withdraw", address: ADDRESS });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    controller.dispatch({ type: "SET_AMOUNT", amount: "1" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("five consecutive poll transport failures surface a retryable AMBIGUOUS_OUTCOME error with the safe message; RETRY resumes", async () => {
    vi.useFakeTimers();
    const gw = createFakeGateway();
    const controller = createFundingController(gw, {
      quoteDebounceMs: 0,
      statusPollMs: 100,
    });
    gw.pollWithdrawStatus.mockRejectedValue(new Error("relayer unreachable"));

    const resumedAttempt = await driveWithdrawToConfirming(gw, controller);
    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(1); // failure 1

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(100);
      await settleMicrotasks();
      // failures 2..4 keep silently rescheduling, no error yet
      assertStep(controller.getState(), "confirming");
    }
    await vi.advanceTimersByTimeAsync(100); // failure 5: gives up
    await settleMicrotasks();

    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(5);
    const errorState = controller.getState();
    assertStep(errorState, "error");
    expect(errorState.error).toEqual({
      code: "AMBIGUOUS_OUTCOME",
      message:
        "We could not confirm the transaction status. Your funds have not been moved twice.",
      retryable: true,
    });

    // RETRY re-runs beginAttempt with the SAME command; the resumed
    // already-submitted attempt re-enters confirming without re-executing.
    const command = errorState.command;
    gw.beginAttempt.mockResolvedValueOnce(resumedAttempt);
    controller.dispatch({ type: "RETRY" });
    await settleMicrotasks();

    expect(gw.beginAttempt).toHaveBeenCalledTimes(2);
    expect(gw.beginAttempt).toHaveBeenNthCalledWith(2, command);
    expect(gw.execute).toHaveBeenCalledTimes(1);
    const confirming2 = controller.getState();
    assertStep(confirming2, "confirming");
    expect(confirming2.attempt).toEqual(resumedAttempt);
  });

  it("a successful poll resolution resets the consecutive-failure counter (4 fails + success + 4 fails never errors)", async () => {
    vi.useFakeTimers();
    const gw = createFakeGateway();
    const controller = createFundingController(gw, {
      quoteDebounceMs: 0,
      statusPollMs: 100,
    });

    const transportError = new Error("relayer unreachable");
    const pending: FundingStatusResult = { status: "pending", detail: null };
    for (let i = 0; i < 4; i++) {
      gw.pollWithdrawStatus.mockRejectedValueOnce(transportError);
    }
    gw.pollWithdrawStatus.mockResolvedValueOnce(pending);
    for (let i = 0; i < 4; i++) {
      gw.pollWithdrawStatus.mockRejectedValueOnce(transportError);
    }
    gw.pollWithdrawStatus.mockResolvedValue(pending); // safety default

    await driveWithdrawToConfirming(gw, controller); // poll #1: failure 1
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(100);
      await settleMicrotasks();
    }

    // 4 failures, then a success (streak reset), then 4 more failures:
    // never 5 consecutive, so confirmation was never given up on.
    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(9);
    assertStep(controller.getState(), "confirming");
  });

  it("40 consecutive pending withdraw-status polls give up with a retryable AMBIGUOUS_OUTCOME error; RETRY resumes", async () => {
    vi.useFakeTimers();
    const gw = createFakeGateway();
    const controller = createFundingController(gw, {
      quoteDebounceMs: 0,
      statusPollMs: 100,
    });
    const pending: FundingStatusResult = { status: "pending", detail: null };
    gw.pollWithdrawStatus.mockResolvedValue(pending);

    const resumedAttempt = await driveWithdrawToConfirming(gw, controller);
    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(1); // pending 1

    for (let i = 0; i < 38; i++) {
      await vi.advanceTimersByTimeAsync(100);
      await settleMicrotasks();
      // pendings 2..39 keep silently rescheduling, no error yet
      assertStep(controller.getState(), "confirming");
    }
    await vi.advanceTimersByTimeAsync(100); // pending 40: gives up
    await settleMicrotasks();

    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(40);
    const errorState = controller.getState();
    assertStep(errorState, "error");
    expect(errorState.error).toEqual({
      code: "AMBIGUOUS_OUTCOME",
      message:
        "We could not confirm the transaction status. Your funds have not been moved twice.",
      retryable: true,
    });

    // RETRY re-runs beginAttempt with the SAME command; the resumed
    // already-submitted attempt re-enters confirming without re-executing.
    const command = errorState.command;
    gw.beginAttempt.mockResolvedValueOnce(resumedAttempt);
    controller.dispatch({ type: "RETRY" });
    await settleMicrotasks();

    expect(gw.beginAttempt).toHaveBeenCalledTimes(2);
    expect(gw.beginAttempt).toHaveBeenNthCalledWith(2, command);
    expect(gw.execute).toHaveBeenCalledTimes(1);
    const confirming2 = controller.getState();
    assertStep(confirming2, "confirming");
    expect(confirming2.attempt).toEqual(resumedAttempt);
  });

  it("a pending streak resets when RETRY starts a new polling identity: each attempt gets its own 40-poll budget", async () => {
    vi.useFakeTimers();
    const gw = createFakeGateway();
    const controller = createFundingController(gw, {
      quoteDebounceMs: 0,
      statusPollMs: 100,
    });
    const pending: FundingStatusResult = { status: "pending", detail: null };
    gw.pollWithdrawStatus.mockResolvedValue(pending);

    const attempt1 = await driveWithdrawToConfirming(gw, controller);
    for (let i = 0; i < 39; i++) {
      await vi.advanceTimersByTimeAsync(100);
      await settleMicrotasks();
    }
    // The pre-RETRY identity used its full 40-poll budget and gave up.
    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(40);
    assertStep(controller.getState(), "error");

    // RETRY starts a brand-new pollWithdrawStatus effect identity; its
    // pending streak must start back at zero, not resume from 40/40 (which
    // would give up on this very first poll instead of taking a full 40
    // more).
    const resumedAttempt = { ...attempt1, phase: "submitted" as const };
    gw.beginAttempt.mockResolvedValueOnce(resumedAttempt);
    gw.pollWithdrawStatus.mockClear();
    gw.pollWithdrawStatus.mockResolvedValue(pending);
    controller.dispatch({ type: "RETRY" });
    await settleMicrotasks();
    assertStep(controller.getState(), "confirming");
    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 38; i++) {
      await vi.advanceTimersByTimeAsync(100);
      await settleMicrotasks();
      assertStep(controller.getState(), "confirming");
    }
    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(39);

    await vi.advanceTimersByTimeAsync(100); // the new identity's 40th poll
    await settleMicrotasks();
    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(40);
    assertStep(controller.getState(), "error");
  });

  it("RESET clears a scheduled confirmation re-poll (no zombie gateway call)", async () => {
    vi.useFakeTimers();
    const gw = createFakeGateway();
    const controller = createFundingController(gw, {
      quoteDebounceMs: 0,
      statusPollMs: 100,
    });
    gw.pollWithdrawStatus.mockRejectedValue(new Error("network"));

    await driveWithdrawToConfirming(gw, controller);
    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(1); // re-poll pending

    controller.dispatch({ type: "RESET" });
    await vi.advanceTimersByTimeAsync(1000);
    await settleMicrotasks();

    expect(gw.pollWithdrawStatus).toHaveBeenCalledTimes(1); // timer cleared
    assertStep(controller.getState(), "idle");
  });
});
