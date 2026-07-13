// apps/extension/tests/funding/cross-context.test.ts
// Simulates BOTH surfaces (sidepanel + trading panel) driving the funding
// controller/machine against ONE shared background: one real
// createPortfolioFundAttemptStore + one real
// createPortfolioFundIdempotencyCoordinator over one shared in-memory
// storage. This is the only test that exercises the attempt store and the
// idempotency coordinator TOGETHER (Task 2's two background modules), which
// is exactly the combination that protects a user from a duplicate transfer
// when two surfaces submit the same deposit intent at once.
import { describe, expect, it } from "vitest";
import {
  createPortfolioFundAttemptStore,
  type PortfolioFundAttemptStorage,
} from "../../src/background/portfolio-fund-attempts";
import { createPortfolioFundIdempotencyCoordinator } from "../../src/background/portfolio-fund-idempotency";
import {
  createFundingController,
  type FundingController,
} from "../../src/funding/controller";
import type { FundingGateway } from "../../src/funding/gateway";
import type { FundingState } from "../../src/funding/machine";
import type {
  FundingAttempt,
  FundingCommand,
  FundingToken,
} from "../../src/funding/types";
import type { PortfolioFundIntentInput } from "../../src/types/portfolio-fund-intent";

const ADDRESS = `0x${"a".repeat(40)}`;

const TOKEN: FundingToken = {
  symbol: "USDC.e",
  name: "USD Coin",
  address: `0x${"1".repeat(40)}`,
  decimals: 6,
  balanceRaw: "100000000",
  balanceDisplay: "100",
  usdValue: "100",
  minUsd: "0",
  minAmount: "0",
  depositSupported: true,
  depositDisabledReason: null,
};

/** Same in-memory pattern as tests/background/portfolio-fund-attempts.test.ts,
 * shared by BOTH the attempt store and the idempotency coordinator (their
 * storage interfaces are structurally identical: get/set/remove). */
function memoryStorage(): PortfolioFundAttemptStorage & {
  data: Map<string, unknown>;
} {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string | null) {
      if (key === null) return Object.fromEntries(data);
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

/** Drains the microtask queue via a real macrotask boundary — every hop in
 * the controller -> gateway -> attemptStore/coordinator chain is
 * microtask-only (no timers), so this resolves only once the whole cascade
 * (however many hops) has settled. Same pattern as controller.test.ts. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function commandToIntentInput(
  command: FundingCommand
): PortfolioFundIntentInput {
  if (command.flow === "deposit") {
    return {
      action: "deposit",
      address: command.address,
      walletMode: command.walletMode,
      amount: command.amount,
      chainId: command.chainId,
      tokenSymbol: command.tokenSymbol,
      tokenAddress: command.tokenAddress,
      tokenDecimals: command.tokenDecimals,
    };
  }
  return {
    action: "withdraw",
    address: command.address,
    walletMode: command.walletMode,
    amount: command.amount,
    destination: command.destination,
    chainKey: command.chainKey,
    tokenId: command.tokenId,
  };
}

interface BackgroundDeps {
  attemptStore: ReturnType<typeof createPortfolioFundAttemptStore>;
  coordinator: ReturnType<typeof createPortfolioFundIdempotencyCoordinator>;
  onTransfer: () => void;
}

/** A minimal FundingGateway whose money-moving methods route into the ONE
 * shared background (attempt store + idempotency coordinator) exactly as
 * the real sidepanel/trading-panel gateways' background-only methods do
 * (Task 3's gateway contract). Read-only methods (`loadBridgeAssets`,
 * `resolveBridgeAddress`, `fetchQuote`, `pollWithdrawStatus`) are unused by
 * the deposit-only flow this test drives, so they throw if ever called. */
function createBackgroundGateway(deps: BackgroundDeps): FundingGateway {
  return {
    async loadWalletTokens() {
      return [TOKEN];
    },
    async loadBridgeAssets() {
      throw new Error("not exercised by this test");
    },
    async resolveBridgeAddress() {
      throw new Error("not exercised by this test");
    },
    async fetchQuote() {
      throw new Error("not exercised by this test");
    },
    async beginAttempt(command) {
      return deps.attemptStore.begin(commandToIntentInput(command));
    },
    async execute(_command, attempt) {
      const result = await deps.coordinator.run({
        idempotencyKey: attempt.idempotencyKey,
        fingerprint: attempt.fingerprint,
        execute: async ({ markMoneyMovementStarted }) => {
          markMoneyMovementStarted();
          deps.onTransfer();
          return { txHash: "0xshared" };
        },
      });
      await deps.attemptStore.recordExecution(
        attempt.attemptId,
        result.txHash,
        attempt.idempotencyKey
      );
      return result;
    },
    async awaitDepositCredit() {
      return "credited";
    },
    async pollWithdrawStatus() {
      throw new Error("not exercised by this test");
    },
    async completeAttempt(attempt, outcome) {
      await deps.attemptStore.complete(
        attempt.attemptId,
        outcome,
        attempt.idempotencyKey
      );
    },
  };
}

/** Drives a controller from idle to the "confirm" step of a wallet deposit
 * of `amount` for the connected `address` (SELECT_METHOD wallet ->
 * TOKENS_LOADED -> SELECT_TOKEN -> SET_AMOUNT -> SUBMIT). */
async function driveToConfirm(
  controller: FundingController,
  address: string,
  amount: string
): Promise<void> {
  controller.dispatch({ type: "START", flow: "deposit", address });
  controller.dispatch({ type: "SELECT_METHOD", method: "wallet" });
  await flush();
  const loaded = controller.getState();
  if (loaded.step !== "select-token") {
    throw new Error(`expected step "select-token", got "${loaded.step}"`);
  }
  const token = loaded.tokens[0];
  controller.dispatch({ type: "SELECT_TOKEN", token });
  controller.dispatch({ type: "SET_AMOUNT", amount });
  controller.dispatch({ type: "SUBMIT" }); // amount -> confirm
}

/** Captures the FundingAttempt as soon as beginAttempt resolves it — the
 * "submitting"/"confirming"/"error" steps are the only ones that carry a
 * non-null attempt. Used to prove which idempotencyKey each surface got. */
function captureAttempt(state: FundingState, sink: FundingAttempt[]): void {
  if (
    (state.step === "submitting" ||
      state.step === "confirming" ||
      state.step === "error") &&
    state.attempt
  ) {
    sink.push(state.attempt);
  }
}

function isSettledDoneOrPendingReconciliation(state: FundingState): boolean {
  return (
    state.step === "done" ||
    (state.step === "error" && state.error.code === "PENDING_RECONCILIATION")
  );
}

describe("cross-context: both surfaces against one background", () => {
  it("two controllers submitting the SAME deposit intent concurrently execute the money movement at most once", async () => {
    const storage = memoryStorage();
    const attemptStore = createPortfolioFundAttemptStore(storage);
    const coordinator = createPortfolioFundIdempotencyCoordinator(storage);
    let transfers = 0;

    const gatewayA = createBackgroundGateway({
      attemptStore,
      coordinator,
      onTransfer: () => {
        transfers += 1;
      },
    });
    const gatewayB = createBackgroundGateway({
      attemptStore,
      coordinator,
      onTransfer: () => {
        transfers += 1;
      },
    });
    const controllerA = createFundingController(gatewayA);
    const controllerB = createFundingController(gatewayB);

    const attemptsSeenA: FundingAttempt[] = [];
    const attemptsSeenB: FundingAttempt[] = [];
    controllerA.subscribe((state) => captureAttempt(state, attemptsSeenA));
    controllerB.subscribe((state) => captureAttempt(state, attemptsSeenB));

    // Same address/token/amount => same normalized fingerprint.
    await driveToConfirm(controllerA, ADDRESS, "5");
    await driveToConfirm(controllerB, ADDRESS, "5");
    expect(controllerA.getState().step).toBe("confirm");
    expect(controllerB.getState().step).toBe("confirm");

    // Fire SUBMIT (confirm -> submitting: issues the beginAttempt effect)
    // back-to-back so both surfaces race against the SAME shared background.
    controllerA.dispatch({ type: "SUBMIT" });
    controllerB.dispatch({ type: "SUBMIT" });
    await flush();
    await flush();

    // The core at-most-once guarantee: the shared execute() body (which
    // increments `transfers` inside coordinator.run) never ran twice.
    expect(transfers).toBe(1);

    // Never a second execution: both surfaces land in "done" (the common
    // case here, since attemptStore.begin() serializes both callers onto
    // the SAME attempt before either ever reaches execute()), OR one is
    // "done" and the other is the PENDING_RECONCILIATION error state.
    const stateA = controllerA.getState();
    const stateB = controllerB.getState();
    expect(isSettledDoneOrPendingReconciliation(stateA)).toBe(true);
    expect(isSettledDoneOrPendingReconciliation(stateB)).toBe(true);

    // Both surfaces received the SAME idempotencyKey from begin() — proof
    // the attempt store's internal queue serialized allocation onto one
    // record rather than minting two independent keys for one fingerprint.
    const keyA = attemptsSeenA.at(-1)?.idempotencyKey;
    const keyB = attemptsSeenB.at(-1)?.idempotencyKey;
    expect(keyA).toBeDefined();
    expect(keyB).toBe(keyA);
  });

  it("a second surface beginning AFTER the first attempt's terminal completion gets a FRESH idempotency key and legitimately re-executes", async () => {
    const storage = memoryStorage();
    const attemptStore = createPortfolioFundAttemptStore(storage);
    const coordinator = createPortfolioFundIdempotencyCoordinator(storage);
    let transfers = 0;

    const gatewayA = createBackgroundGateway({
      attemptStore,
      coordinator,
      onTransfer: () => {
        transfers += 1;
      },
    });
    const gatewayB = createBackgroundGateway({
      attemptStore,
      coordinator,
      onTransfer: () => {
        transfers += 1;
      },
    });
    const controllerA = createFundingController(gatewayA);
    const controllerB = createFundingController(gatewayB);

    const attemptsSeenA: FundingAttempt[] = [];
    const attemptsSeenB: FundingAttempt[] = [];
    controllerA.subscribe((state) => captureAttempt(state, attemptsSeenA));
    controllerB.subscribe((state) => captureAttempt(state, attemptsSeenB));

    // Surface A completes an entire deposit of the intent first.
    await driveToConfirm(controllerA, ADDRESS, "6");
    controllerA.dispatch({ type: "SUBMIT" }); // confirm -> submitting
    await flush();
    expect(controllerA.getState().step).toBe("done");
    expect(transfers).toBe(1);

    // Surface B submits the IDENTICAL intent (same fingerprint) afterwards —
    // a legitimate repeat deposit, not a duplicate of the settled one.
    await driveToConfirm(controllerB, ADDRESS, "6");
    controllerB.dispatch({ type: "SUBMIT" });
    await flush();
    expect(controllerB.getState().step).toBe("done");

    // A genuinely NEW transfer happened (the attempt store allocated a
    // fresh attempt because A's was already terminal ("credited")).
    expect(transfers).toBe(2);

    const keyA = attemptsSeenA.at(-1)?.idempotencyKey;
    const keyB = attemptsSeenB.at(-1)?.idempotencyKey;
    expect(keyA).toBeDefined();
    expect(keyB).toBeDefined();
    expect(keyB).not.toBe(keyA);
  });
});
