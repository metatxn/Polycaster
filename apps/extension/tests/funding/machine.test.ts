import { describe, expect, it } from "vitest";
import type { FundingEvent, FundingState } from "../../src/funding/machine";
import {
  initialFundingState,
  normalizeFundingAmount,
  reduceFunding,
} from "../../src/funding/machine";
import type {
  FundingAttempt,
  FundingBridgeAsset,
  FundingQuote,
  FundingToken,
} from "../../src/funding/types";

const ADDRESS = `0x${"a".repeat(40)}`;

const token: FundingToken = {
  symbol: "USDC.e",
  name: "USD Coin",
  address: `0x${"1".repeat(40)}`,
  decimals: 6,
  balanceRaw: "25000000",
  balanceDisplay: "25",
  usdValue: "25",
  minUsd: "1",
  minAmount: "1", // USD-pegged: token-unit floor equals the USD floor
  depositSupported: true,
  depositDisabledReason: null,
};
const asset: FundingBridgeAsset = {
  chainId: "1",
  chainName: "Ethereum",
  symbol: "ETH",
  name: "Ether",
  address: "native",
  decimals: 18,
  minCheckoutUsd: "20",
};
const assetTwo: FundingBridgeAsset = {
  chainId: "137",
  chainName: "Polygon",
  symbol: "MATIC",
  name: "Polygon Ecosystem Token",
  address: "native",
  decimals: 18,
  minCheckoutUsd: "5",
};
const quote: FundingQuote = {
  quoteId: "quote-1",
  estOutputPusd: "9.5",
  estInputUsd: "10",
  totalImpactUsd: "0.5",
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

function drive(events: FundingEvent[]): FundingState {
  let state = initialFundingState;
  for (const event of events) [state] = reduceFunding(state, event);
  return state;
}

function driveFrom(state: FundingState, events: FundingEvent[]): FundingState {
  let next = state;
  for (const event of events) [next] = reduceFunding(next, event);
  return next;
}

/** Type-narrows `state` for the rest of the test, failing with a clear
 * message (rather than a TS error further down) when the step is wrong. */
function assertStep<S extends FundingState["step"]>(
  state: FundingState,
  step: S
): asserts state is Extract<FundingState, { step: S }> {
  if (state.step !== step) {
    throw new Error(`expected step "${step}" but got "${state.step}"`);
  }
}

function depositToAmountEvents(amount = "5"): FundingEvent[] {
  return [
    { type: "START", flow: "deposit", address: ADDRESS },
    { type: "SELECT_METHOD", method: "wallet" },
    { type: "TOKENS_LOADED", tokens: [token], epoch: 0, effectId: 1 },
    { type: "SELECT_TOKEN", token },
    { type: "SET_AMOUNT", amount },
  ];
}

function depositToConfirmEvents(amount = "5"): FundingEvent[] {
  return [...depositToAmountEvents(amount), { type: "SUBMIT" }];
}

function depositToSubmittingEvents(amount = "5"): FundingEvent[] {
  return [...depositToConfirmEvents(amount), { type: "SUBMIT" }];
}

function depositConfirmingState(): FundingState {
  let state = drive(depositToSubmittingEvents());
  [state] = reduceFunding(state, {
    type: "ATTEMPT_READY",
    epoch: 0,
    effectId: 2,
    attempt: makeAttempt(),
  });
  [state] = reduceFunding(state, {
    type: "EXECUTED",
    epoch: 0,
    effectId: 3,
    txHash: "0xtx",
  });
  return state;
}

function withdrawToAmountEvents(): FundingEvent[] {
  return [
    { type: "START", flow: "withdraw", address: ADDRESS },
    { type: "SET_AMOUNT", amount: "10" },
    {
      type: "SET_DESTINATION",
      destination: `0x${"9".repeat(40)}`,
      chainKey: "polygon",
      tokenId: "usdc-e",
    },
  ];
}

function withdrawToRequestQuoteEvents(): FundingEvent[] {
  return [...withdrawToAmountEvents(), { type: "REQUEST_QUOTE" }];
}

describe("deposit wallet path", () => {
  it("START deposit goes to method and requests nothing", () => {
    const [state, effects] = reduceFunding(initialFundingState, {
      type: "START",
      flow: "deposit",
    });
    expect(state.step).toBe("method");
    expect(effects).toEqual([]);
  });

  it("START is dropped outside idle, so callers must RESET a stale flow first", () => {
    // done/error render nothing new, so a swallowed START leaves whatever the
    // caller put on screen (the side panel's loading placeholder) up forever.
    // openPortfolioFunds relies on this by recycling before it dispatches START.
    const stale: FundingState = {
      step: "done",
      txHash: null,
      corr: initialFundingState.corr,
    };
    const [ignored] = reduceFunding(stale, {
      type: "START",
      flow: "deposit",
      address: ADDRESS,
    });
    expect(ignored).toBe(stale);
    const [recycled] = reduceFunding(stale, { type: "RESET" });
    expect(recycled.step).toBe("idle");
    const [started] = reduceFunding(recycled, {
      type: "START",
      flow: "deposit",
      address: ADDRESS,
    });
    expect(started.step).toBe("method");
  });

  it("SELECT_METHOD wallet emits loadTokens with fresh effectId", () => {
    let state = initialFundingState;
    [state] = reduceFunding(state, { type: "START", flow: "deposit" });
    const [next, effects] = reduceFunding(state, {
      type: "SELECT_METHOD",
      method: "wallet",
    });
    expect(next.step).toBe("select-token");
    expect(effects[0].kind).toBe("loadTokens");
  });

  it("SELECT_METHOD wallet with source cross-chain threads source into the loadTokens effect", () => {
    let state = initialFundingState;
    [state] = reduceFunding(state, { type: "START", flow: "deposit" });
    const [next, effects] = reduceFunding(state, {
      type: "SELECT_METHOD",
      method: "wallet",
      source: "cross-chain",
    });
    expect(next.step).toBe("select-token");
    expect(effects).toEqual([
      { kind: "loadTokens", effectId: 1, epoch: 0, source: "cross-chain" },
    ]);
  });

  it("SUBMIT builds the command with the token's own chainId when present, defaulting to 137", () => {
    const crossChainToken = {
      ...token,
      chainId: "1",
      // Cross-chain source balances are unknown; empty string skips the
      // over-balance check.
      balanceRaw: null,
      balanceDisplay: "",
    };
    const withChainId = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "wallet", source: "cross-chain" },
      {
        type: "TOKENS_LOADED",
        tokens: [crossChainToken],
        epoch: 0,
        effectId: 1,
      },
      { type: "SELECT_TOKEN", token: crossChainToken },
      { type: "SET_AMOUNT", amount: "5" },
      { type: "SUBMIT" },
    ]);
    assertStep(withChainId, "confirm");
    expect(withChainId.command).toEqual({
      flow: "deposit",
      address: ADDRESS,
      walletMode: undefined,
      amount: "5",
      chainId: "1",
      tokenSymbol: crossChainToken.symbol,
      tokenAddress: crossChainToken.address,
      tokenDecimals: crossChainToken.decimals,
    });

    // Without a per-token chainId the wallet default (Polygon) applies.
    const withoutChainId = drive(depositToConfirmEvents());
    assertStep(withoutChainId, "confirm");
    expect(withoutChainId.command.flow).toBe("deposit");
    if (withoutChainId.command.flow === "deposit") {
      expect(withoutChainId.command.chainId).toBe("137");
    }
  });

  it("an unknown balance (empty balanceDisplay) skips the over-balance check but keeps the minUsd floor", () => {
    const unknownBalanceToken = {
      ...token,
      chainId: "1",
      balanceRaw: null,
      balanceDisplay: "",
      minUsd: "2",
      minAmount: "2", // USD-pegged fixture symbol: floor is 1:1
    };
    const base = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "wallet", source: "cross-chain" },
      {
        type: "TOKENS_LOADED",
        tokens: [unknownBalanceToken],
        epoch: 0,
        effectId: 1,
      },
      { type: "SELECT_TOKEN", token: unknownBalanceToken },
    ]);

    // Any amount above the floor passes — even one that would exceed a "0"
    // balance if the unknown balance were misread as zero.
    const [large] = reduceFunding(base, {
      type: "SET_AMOUNT",
      amount: "1000000",
    });
    const [confirmed] = reduceFunding(large, { type: "SUBMIT" });
    assertStep(confirmed, "confirm");

    // The minUsd floor still applies.
    const [small] = reduceFunding(base, { type: "SET_AMOUNT", amount: "1" });
    const [rejected] = reduceFunding(small, { type: "SUBMIT" });
    assertStep(rejected, "amount");
    expect(rejected.error?.code).toBe("VALIDATION");
    expect(rejected.error?.message).toBe("Minimum deposit is $2.");
  });

  it("full happy path reaches confirm", () => {
    const amountState = drive(depositToAmountEvents());
    assertStep(amountState, "amount");
    expect(amountState.token).toEqual(token);
    expect(amountState.amount).toBe("5");

    const [next, effects] = reduceFunding(amountState, { type: "SUBMIT" });
    assertStep(next, "confirm");
    expect(next.command).toEqual({
      flow: "deposit",
      address: ADDRESS,
      walletMode: undefined,
      amount: "5",
      chainId: "137",
      tokenSymbol: token.symbol,
      tokenAddress: token.address,
      tokenDecimals: token.decimals,
    });
    expect(next.token).toEqual(token);
    expect(effects).toEqual([]);
  });

  it("BACK from confirm returns to amount with the token intact; SUBMIT works again", () => {
    const confirmState = drive(depositToConfirmEvents());
    assertStep(confirmState, "confirm");

    const [amountState, backEffects] = reduceFunding(confirmState, {
      type: "BACK",
    });
    assertStep(amountState, "amount");
    expect(amountState.token).toEqual(token);
    expect(amountState.amount).toBe("5");
    expect(backEffects).toEqual([]);

    // Edit the amount and submit again — must NOT be a silent dead-end.
    const [edited] = reduceFunding(amountState, {
      type: "SET_AMOUNT",
      amount: "7",
    });
    const [reconfirmed, submitEffects] = reduceFunding(edited, {
      type: "SUBMIT",
    });
    assertStep(reconfirmed, "confirm");
    expect(reconfirmed.command).toEqual({
      flow: "deposit",
      address: ADDRESS,
      walletMode: undefined,
      amount: "7",
      chainId: "137",
      tokenSymbol: token.symbol,
      tokenAddress: token.address,
      tokenDecimals: token.decimals,
    });
    expect(reconfirmed.token).toEqual(token);
    expect(submitEffects).toEqual([]);
  });

  it("SUBMIT from confirm emits beginAttempt effect and enters submitting", () => {
    const confirmState = drive(depositToConfirmEvents());
    assertStep(confirmState, "confirm");
    const [next, effects] = reduceFunding(confirmState, { type: "SUBMIT" });
    assertStep(next, "submitting");
    expect(next.attempt).toBeNull();
    expect(next.command).toEqual(confirmState.command);
    expect(effects).toEqual([
      {
        kind: "beginAttempt",
        effectId: 2,
        epoch: 0,
        command: confirmState.command,
      },
    ]);
  });

  it("SUBMIT while submitting is a no-op (same state, no effects)", () => {
    const submittingState = drive(depositToSubmittingEvents());
    assertStep(submittingState, "submitting");
    const [next, effects] = reduceFunding(submittingState, { type: "SUBMIT" });
    expect(next).toBe(submittingState);
    expect(effects).toEqual([]);
  });

  it("SUBMIT while confirming is a no-op", () => {
    const state = depositConfirmingState();
    assertStep(state, "confirming");
    const [next, effects] = reduceFunding(state, { type: "SUBMIT" });
    expect(next).toBe(state);
    expect(effects).toEqual([]);
  });

  it("EXECUTED moves submitting → confirming with txHash", () => {
    let state = drive(depositToSubmittingEvents());
    [state] = reduceFunding(state, {
      type: "ATTEMPT_READY",
      epoch: 0,
      effectId: 2,
      attempt: makeAttempt(),
    });
    assertStep(state, "submitting");
    const [next, effects] = reduceFunding(state, {
      type: "EXECUTED",
      epoch: 0,
      effectId: 3,
      txHash: "0xtx",
    });
    assertStep(next, "confirming");
    expect(next.attempt.txHash).toBe("0xtx");
    expect(next.attempt.phase).toBe("submitted");
    expect(next.phase).toBe("credit");
    expect(effects).toEqual([
      {
        kind: "awaitDepositCredit",
        effectId: 4,
        epoch: 0,
        attempt: next.attempt,
      },
    ]);
  });

  it("CREDITED moves confirming → done and emits completeAttempt effect", () => {
    const state = depositConfirmingState();
    assertStep(state, "confirming");
    const [next, effects] = reduceFunding(state, {
      type: "CREDITED",
      epoch: 0,
      effectId: 4,
    });
    assertStep(next, "done");
    expect(next.txHash).toBe("0xtx");
    expect(effects).toEqual([
      {
        kind: "completeAttempt",
        effectId: 5,
        epoch: 0,
        attempt: state.attempt,
        outcome: "credited",
      },
    ]);
  });

  it("REVERT_CONFIRMED moves confirming → error(REVERTED, retryable:false) and emits completeAttempt", () => {
    const state = depositConfirmingState();
    assertStep(state, "confirming");
    const [next, effects] = reduceFunding(state, {
      type: "REVERT_CONFIRMED",
      epoch: 0,
      effectId: 4,
    });
    assertStep(next, "error");
    expect(next.error).toEqual({
      code: "REVERTED",
      message: expect.any(String),
      retryable: false,
    });
    expect(next.attempt).toEqual(state.attempt);
    expect(effects).toEqual([
      {
        kind: "completeAttempt",
        effectId: 5,
        epoch: 0,
        attempt: state.attempt,
        outcome: "reverted",
      },
    ]);
  });
});

describe("amount validation (decimal strings, no floats)", () => {
  it("rejects amount over balance (uses Decimal compare)", () => {
    const state = drive(depositToAmountEvents("25.000001"));
    const [next, effects] = reduceFunding(state, { type: "SUBMIT" });
    assertStep(next, "amount");
    expect(next.error).toEqual({
      code: "VALIDATION",
      message: "Amount exceeds available balance.",
      retryable: false,
    });
    expect(effects).toEqual([]);
  });

  it("rejects amount below token minAmount (USD-pegged: equals minUsd)", () => {
    const state = drive(depositToAmountEvents("0.5"));
    const [next, effects] = reduceFunding(state, { type: "SUBMIT" });
    assertStep(next, "amount");
    expect(next.error).toEqual({
      code: "VALIDATION",
      message: "Minimum deposit is $1.",
      retryable: false,
    });
    expect(effects).toEqual([]);
  });

  it("non-pegged floor is enforced in TOKEN units: 0.5 WETH clears a $2 floor (minAmount ~0.000666)", () => {
    // A WETH-like token: $2 floor ≈ 0.000666 WETH at $3000/WETH. The gateway
    // derived minAmount from the price ratio; the machine compares token
    // units only — the old 1:1 USD assumption would have rejected 0.5 WETH
    // (~$1500) as "below $2".
    const weth: FundingToken = {
      ...token,
      symbol: "WETH",
      name: "Wrapped Ether",
      balanceDisplay: "2",
      balanceRaw: null,
      usdValue: "6000",
      minUsd: "2",
      minAmount: "0.000666",
    };
    const state = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "wallet" },
      { type: "TOKENS_LOADED", tokens: [weth], epoch: 0, effectId: 1 },
      { type: "SELECT_TOKEN", token: weth },
      { type: "SET_AMOUNT", amount: "0.5" },
      { type: "SUBMIT" },
    ]);
    assertStep(state, "confirm");
    expect(state.command.flow).toBe("deposit");
  });

  it("non-pegged floor rejects in TOKEN units with USD-led copy: 3 POL under a $2 floor (minAmount 5)", () => {
    // A POL-like token at $0.40: the $2 floor is 5 POL. 3 POL (~$1.20) must
    // be rejected — the old 1:1 USD assumption would have passed it (3 > 2).
    const pol: FundingToken = {
      ...token,
      symbol: "POL",
      name: "Polygon Ecosystem Token",
      balanceDisplay: "10",
      balanceRaw: null,
      usdValue: "4",
      minUsd: "2",
      minAmount: "5",
    };
    const state = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "wallet" },
      { type: "TOKENS_LOADED", tokens: [pol], epoch: 0, effectId: 1 },
      { type: "SELECT_TOKEN", token: pol },
      { type: "SET_AMOUNT", amount: "3" },
      { type: "SUBMIT" },
    ]);
    assertStep(state, "amount");
    expect(state.error).toEqual({
      code: "VALIDATION",
      message: "Minimum deposit is $2 (≈5 POL).",
      retryable: false,
    });
  });

  it("minAmount '0' never rejects, even when minUsd is set (price unknown → floor deferred to execution)", () => {
    const unpriced: FundingToken = {
      ...token,
      symbol: "WBTC",
      minUsd: "2",
      minAmount: "0",
    };
    const state = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "wallet" },
      { type: "TOKENS_LOADED", tokens: [unpriced], epoch: 0, effectId: 1 },
      { type: "SELECT_TOKEN", token: unpriced },
      { type: "SET_AMOUNT", amount: "0.000001" },
      { type: "SUBMIT" },
    ]);
    assertStep(state, "confirm");
  });

  it("rejects malformed amounts: '1e5', '0x10', '1.2.3', '', '-1', '0'", () => {
    for (const raw of ["1e5", "0x10", "1.2.3", "", "-1", "0"]) {
      expect(normalizeFundingAmount(raw)).toBeNull();
    }
  });

  it("accepts '0.000001' six-decimals amount", () => {
    expect(normalizeFundingAmount("0.000001")).toBe("0.000001");
  });
});

describe("passive bridge branch", () => {
  it("SELECT_METHOD bridge emits loadBridgeAssets", () => {
    const state = drive([{ type: "START", flow: "deposit", address: ADDRESS }]);
    const [next, effects] = reduceFunding(state, {
      type: "SELECT_METHOD",
      method: "bridge",
    });
    expect(next.step).toBe("select-bridge-asset");
    expect(effects).toEqual([
      { kind: "loadBridgeAssets", effectId: 1, epoch: 0 },
    ]);
  });

  it("SELECT_BRIDGE_ASSET emits resolveBridgeAddress and enters bridge-address-ready (loading)", () => {
    const state = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "bridge" },
      { type: "ASSETS_LOADED", epoch: 0, effectId: 1, assets: [asset] },
    ]);
    const [next, effects] = reduceFunding(state, {
      type: "SELECT_BRIDGE_ASSET",
      asset,
    });
    assertStep(next, "bridge-address-ready");
    expect(next.loading).toBe(true);
    expect(next.depositAddress).toBeNull();
    expect(next.asset).toEqual(asset);
    expect(effects).toEqual([
      { kind: "resolveBridgeAddress", effectId: 2, epoch: 0, asset },
    ]);
  });

  it("BRIDGE_ADDRESS_READY stores the address", () => {
    const state = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "bridge" },
      { type: "ASSETS_LOADED", epoch: 0, effectId: 1, assets: [asset] },
      { type: "SELECT_BRIDGE_ASSET", asset },
    ]);
    const [next, effects] = reduceFunding(state, {
      type: "BRIDGE_ADDRESS_READY",
      epoch: 0,
      effectId: 2,
      depositAddress: "0xbridgeaddr",
    });
    assertStep(next, "bridge-address-ready");
    expect(next.loading).toBe(false);
    expect(next.depositAddress).toBe("0xbridgeaddr");
    expect(effects).toEqual([]);
  });

  it("SUBMIT in bridge-address-ready is a no-op — branch can never reach submitting", () => {
    const readyState = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "bridge" },
      { type: "ASSETS_LOADED", epoch: 0, effectId: 1, assets: [asset] },
      { type: "SELECT_BRIDGE_ASSET", asset },
      {
        type: "BRIDGE_ADDRESS_READY",
        epoch: 0,
        effectId: 2,
        depositAddress: "0xbridgeaddr",
      },
    ]);
    assertStep(readyState, "bridge-address-ready");

    const [submitNext, submitEffects] = reduceFunding(readyState, {
      type: "SUBMIT",
    });
    expect(submitNext).toBe(readyState);
    expect(submitEffects).toEqual([]);

    // Exhaustive: every other event type must also fail to reach
    // submitting/confirming from this passive branch.
    const candidateEvents: FundingEvent[] = [
      { type: "START", flow: "deposit" },
      { type: "SELECT_METHOD", method: "wallet" },
      { type: "SELECT_TOKEN", token },
      { type: "SELECT_BRIDGE_ASSET", asset },
      { type: "SET_AMOUNT", amount: "5" },
      { type: "SET_QUERY", query: "e" },
      {
        type: "SET_DESTINATION",
        destination: "0xdest",
        chainKey: "polygon",
        tokenId: "usdc-e",
      },
      { type: "REQUEST_QUOTE" },
      { type: "BACK" },
      { type: "RETRY" },
      { type: "TOKENS_LOADED", tokens: [token], epoch: 0, effectId: 1 },
      {
        type: "LOAD_FAILED",
        epoch: 0,
        effectId: 1,
        error: { code: "LOAD_FAILED", message: "x", retryable: true },
      },
      { type: "ASSETS_LOADED", assets: [asset], epoch: 0, effectId: 1 },
      {
        type: "BRIDGE_ADDRESS_READY",
        depositAddress: "0xother",
        epoch: 0,
        effectId: 2,
      },
      { type: "QUOTE_OK", quote, epoch: 0, effectId: 1 },
      {
        type: "QUOTE_FAILED",
        error: { code: "QUOTE_FAILED", message: "x", retryable: true },
        epoch: 0,
        effectId: 1,
      },
      { type: "ATTEMPT_READY", epoch: 0, effectId: 1, attempt: makeAttempt() },
      { type: "EXECUTED", txHash: "0xtx", epoch: 0, effectId: 1 },
      {
        type: "EXECUTION_FAILED",
        error: { code: "EXECUTION_FAILED", message: "x", retryable: true },
        epoch: 0,
        effectId: 1,
      },
      { type: "CREDITED", epoch: 0, effectId: 1 },
      { type: "REVERT_CONFIRMED", epoch: 0, effectId: 1 },
      {
        type: "STATUS_UPDATE",
        status: { status: "pending", detail: null },
        epoch: 0,
        effectId: 1,
      },
    ];

    for (const event of candidateEvents) {
      const [next] = reduceFunding(readyState, event);
      expect(next.step).not.toBe("submitting");
      expect(next.step).not.toBe("confirming");
    }
  });

  it("SET_QUERY filters assets case-insensitively on symbol/name/chainName", () => {
    const state = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "bridge" },
      {
        type: "ASSETS_LOADED",
        epoch: 0,
        effectId: 1,
        assets: [asset, assetTwo],
      },
    ]);

    const [bySymbol] = reduceFunding(state, {
      type: "SET_QUERY",
      query: "eth",
    });
    assertStep(bySymbol, "select-bridge-asset");
    expect(bySymbol.assets).toEqual([asset]);

    const [byChainName] = reduceFunding(state, {
      type: "SET_QUERY",
      query: "POLYGON",
    });
    assertStep(byChainName, "select-bridge-asset");
    expect(byChainName.assets).toEqual([assetTwo]);

    const [byName] = reduceFunding(state, {
      type: "SET_QUERY",
      query: "ecosystem",
    });
    assertStep(byName, "select-bridge-asset");
    expect(byName.assets).toEqual([assetTwo]);

    const [cleared] = reduceFunding(bySymbol, { type: "SET_QUERY", query: "" });
    assertStep(cleared, "select-bridge-asset");
    expect(cleared.assets).toEqual([asset, assetTwo]);
  });
});

describe("withdraw path", () => {
  it("START withdraw goes to amount with destination fields", () => {
    const [state, effects] = reduceFunding(initialFundingState, {
      type: "START",
      flow: "withdraw",
      address: ADDRESS,
    });
    assertStep(state, "amount");
    expect(state.flow).toBe("withdraw");
    expect(state.token).toBeNull();
    expect(state.destination).toBe("");
    expect(state.chainKey).toBe("");
    expect(state.tokenId).toBe("");
    expect(effects).toEqual([]);
  });

  it("SET_AMOUNT + SET_DESTINATION then REQUEST_QUOTE emits fetchQuote", () => {
    const state = drive(withdrawToAmountEvents());
    const [next, effects] = reduceFunding(state, { type: "REQUEST_QUOTE" });
    assertStep(next, "amount");
    expect(next.quoteLoading).toBe(true);
    expect(effects).toEqual([
      {
        kind: "fetchQuote",
        effectId: 1,
        epoch: 0,
        tokenAddress: "usdc-e",
        tokenDecimals: 0,
        amount: "10",
      },
    ]);
  });

  it("QUOTE_OK moves to confirm; SUBMIT emits beginAttempt", () => {
    const amountState = drive(withdrawToRequestQuoteEvents());
    const [confirmState, quoteEffects] = reduceFunding(amountState, {
      type: "QUOTE_OK",
      epoch: 0,
      effectId: 1,
      quote,
    });
    expect(quoteEffects).toEqual([]);
    assertStep(confirmState, "confirm");
    expect(confirmState.command).toEqual({
      flow: "withdraw",
      address: ADDRESS,
      walletMode: undefined,
      amount: "10",
      destination: `0x${"9".repeat(40)}`,
      chainKey: "polygon",
      tokenId: "usdc-e",
    });
    expect(confirmState.quote).toEqual(quote);
    expect(confirmState.token).toBeNull();

    const [next, effects] = reduceFunding(confirmState, { type: "SUBMIT" });
    assertStep(next, "submitting");
    expect(effects).toEqual([
      {
        kind: "beginAttempt",
        effectId: 2,
        epoch: 0,
        command: confirmState.command,
      },
    ]);
  });

  it("SET_DESTINATION after REQUEST_QUOTE invalidates the in-flight quote — its QUOTE_OK can never confirm with the previous destination", () => {
    let state = drive(withdrawToRequestQuoteEvents()); // fetchQuote effectId 1 in flight
    const editedDestination = `0x${"7".repeat(40)}`;
    [state] = reduceFunding(state, {
      type: "SET_DESTINATION",
      destination: editedDestination,
      chainKey: "polygon",
      tokenId: "usdc-e",
    });
    assertStep(state, "amount");
    expect(state.quote).toBeNull();
    expect(state.quoteLoading).toBe(false);

    // The quote requested BEFORE the edit resolves now: it must be dropped,
    // not build a confirm command from mixed old/new inputs.
    const [next, effects] = reduceFunding(state, {
      type: "QUOTE_OK",
      epoch: 0,
      effectId: 1,
      quote,
    });
    expect(next).toBe(state);
    expect(effects).toEqual([]);
  });

  it("SET_AMOUNT after REQUEST_QUOTE invalidates the in-flight quote", () => {
    let state = drive(withdrawToRequestQuoteEvents()); // fetchQuote effectId 1 in flight
    [state] = reduceFunding(state, { type: "SET_AMOUNT", amount: "" });
    assertStep(state, "amount");

    const [next, effects] = reduceFunding(state, {
      type: "QUOTE_OK",
      epoch: 0,
      effectId: 1,
      quote,
    });
    expect(next).toBe(state);
    expect(effects).toEqual([]);
  });

  it("a fresh REQUEST_QUOTE after an invalidating edit correlates again", () => {
    let state = drive(withdrawToRequestQuoteEvents()); // effectId 1 in flight
    [state] = reduceFunding(state, { type: "SET_AMOUNT", amount: "25" });
    const [requoted, effects] = reduceFunding(state, {
      type: "REQUEST_QUOTE",
    });
    state = requoted;
    expect(effects[0]).toMatchObject({
      kind: "fetchQuote",
      effectId: 2,
      amount: "25",
    });

    const [next] = reduceFunding(state, {
      type: "QUOTE_OK",
      epoch: 0,
      effectId: 2,
      quote,
    });
    assertStep(next, "confirm");
    expect(next.command).toMatchObject({ flow: "withdraw", amount: "25" });
  });

  it("STATUS_UPDATE pending keeps confirming; completed → done", () => {
    let state = drive(withdrawToRequestQuoteEvents());
    [state] = reduceFunding(state, {
      type: "QUOTE_OK",
      epoch: 0,
      effectId: 1,
      quote,
    });
    [state] = reduceFunding(state, { type: "SUBMIT" });
    [state] = reduceFunding(state, {
      type: "ATTEMPT_READY",
      epoch: 0,
      effectId: 2,
      attempt: makeAttempt(),
    });
    [state] = reduceFunding(state, {
      type: "EXECUTED",
      epoch: 0,
      effectId: 3,
      txHash: "0xwd",
    });
    assertStep(state, "confirming");
    expect(state.phase).toBe("status");

    const [pendingState, pendingEffects] = reduceFunding(state, {
      type: "STATUS_UPDATE",
      epoch: 0,
      effectId: 4,
      status: { status: "pending", detail: null },
    });
    expect(pendingState).toBe(state);
    expect(pendingEffects).toEqual([]);

    const [doneState, doneEffects] = reduceFunding(pendingState, {
      type: "STATUS_UPDATE",
      epoch: 0,
      effectId: 4,
      status: { status: "completed", detail: null },
    });
    assertStep(doneState, "done");
    expect(doneState.txHash).toBe("0xwd");
    expect(doneEffects).toEqual([
      {
        kind: "completeAttempt",
        effectId: 5,
        epoch: 0,
        attempt: state.attempt,
        outcome: "credited",
      },
    ]);
  });
});

describe("effect correlation", () => {
  it("drops TOKENS_LOADED with stale effectId", () => {
    let state = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "wallet" }, // loadTokens effectId=1
    ]);
    [state] = reduceFunding(state, { type: "BACK" }); // -> method
    [state] = reduceFunding(state, { type: "SELECT_METHOD", method: "wallet" }); // loadTokens effectId=2
    assertStep(state, "select-token");
    expect(state.loading).toBe(true);

    const [stale, staleEffects] = reduceFunding(state, {
      type: "TOKENS_LOADED",
      epoch: 0,
      effectId: 1,
      tokens: [token],
    });
    expect(stale).toBe(state);
    expect(staleEffects).toEqual([]);

    const [fresh] = reduceFunding(state, {
      type: "TOKENS_LOADED",
      epoch: 0,
      effectId: 2,
      tokens: [token],
    });
    assertStep(fresh, "select-token");
    expect(fresh.tokens).toEqual([token]);
  });

  it("drops QUOTE_OK from a previous epoch after RESET + new START", () => {
    const beforeReset = drive(withdrawToRequestQuoteEvents());
    expect(beforeReset.corr.epoch).toBe(0);

    const afterReset = driveFrom(beforeReset, [
      { type: "RESET" },
      ...withdrawToRequestQuoteEvents(),
    ]);
    expect(afterReset.corr.epoch).toBe(1);
    assertStep(afterReset, "amount");

    // The stale QUOTE_OK carries the OLD epoch (0); the current epoch is 1.
    const [next, effects] = reduceFunding(afterReset, {
      type: "QUOTE_OK",
      epoch: 0,
      effectId: 1,
      quote,
    });
    expect(next).toBe(afterReset);
    expect(effects).toEqual([]);
  });

  it("drops STATUS_UPDATE for a superseded attempt after RETRY", () => {
    let state = drive(withdrawToRequestQuoteEvents());
    [state] = reduceFunding(state, {
      type: "QUOTE_OK",
      epoch: 0,
      effectId: 1,
      quote,
    });
    [state] = reduceFunding(state, { type: "SUBMIT" }); // beginAttempt effectId=2
    [state] = reduceFunding(state, {
      type: "ATTEMPT_READY",
      epoch: 0,
      effectId: 2,
      attempt: makeAttempt(),
    }); // execute effectId=3
    [state] = reduceFunding(state, {
      type: "EXECUTED",
      epoch: 0,
      effectId: 3,
      txHash: "0xwd",
    }); // pollWithdrawStatus effectId=4
    assertStep(state, "confirming");

    [state] = reduceFunding(state, {
      type: "STATUS_UPDATE",
      epoch: 0,
      effectId: 4,
      status: { status: "failed", detail: "processing error" },
    }); // completeAttempt effectId=5 -> error, retryable
    assertStep(state, "error");
    expect(state.error.retryable).toBe(true);

    [state] = reduceFunding(state, { type: "RETRY" }); // beginAttempt effectId=6
    assertStep(state, "submitting");

    [state] = reduceFunding(state, {
      type: "ATTEMPT_READY",
      epoch: 0,
      effectId: 6,
      attempt: makeAttempt({ txHash: "0xwd", phase: "submitted" }),
    }); // resumes: skips execute, issues pollWithdrawStatus effectId=7
    assertStep(state, "confirming");
    expect(state.corr.latest.pollWithdrawStatus).toBe(7);

    // The OLD poll response (effectId 4, from before the retry) arrives late.
    const [next, effects] = reduceFunding(state, {
      type: "STATUS_UPDATE",
      epoch: 0,
      effectId: 4,
      status: { status: "completed", detail: null },
    });
    expect(next).toBe(state);
    expect(effects).toEqual([]);
  });

  it("ACCOUNT_CHANGED bumps epoch and returns to idle; in-flight results dropped", () => {
    const loadingState = drive([
      { type: "START", flow: "deposit", address: ADDRESS },
      { type: "SELECT_METHOD", method: "wallet" }, // loadTokens effectId=1, epoch=0
    ]);
    expect(loadingState.corr.epoch).toBe(0);

    const [afterChange, changeEffects] = reduceFunding(loadingState, {
      type: "ACCOUNT_CHANGED",
    });
    expect(afterChange.step).toBe("idle");
    expect(afterChange.corr.epoch).toBe(1);
    expect(afterChange.corr.address).toBe("");
    expect(changeEffects).toEqual([]);

    // The in-flight loadTokens response from before the account change
    // carries the OLD epoch and must never resurrect the abandoned flow.
    const [afterStaleResult, staleEffects] = reduceFunding(afterChange, {
      type: "TOKENS_LOADED",
      epoch: 0,
      effectId: 1,
      tokens: [token],
    });
    expect(afterStaleResult).toBe(afterChange);
    expect(afterStaleResult.step).toBe("idle");
    expect(staleEffects).toEqual([]);

    // Isolate the epoch guard specifically: a result whose effectId happens
    // to match "latest" for its kind is still dropped when the epoch is
    // stale (defense in depth beyond the globally-monotonic effectId).
    const collidingState: FundingState = {
      step: "select-token",
      loading: true,
      tokens: [],
      error: null,
      corr: {
        epoch: 5,
        latest: { loadTokens: 9 },
        nextEffectId: 10,
        address: ADDRESS,
        walletMode: undefined,
      },
    };
    const [dropped, droppedEffects] = reduceFunding(collidingState, {
      type: "TOKENS_LOADED",
      epoch: 4,
      effectId: 9,
      tokens: [token],
    });
    expect(dropped).toBe(collidingState);
    expect(droppedEffects).toEqual([]);
  });
});

describe("attempt lifecycle in machine", () => {
  it("ATTEMPT_READY with recorded txHash (phase submitted) skips execute and enters confirming", () => {
    const submittingState = drive(depositToSubmittingEvents());
    assertStep(submittingState, "submitting");
    const [next, effects] = reduceFunding(submittingState, {
      type: "ATTEMPT_READY",
      epoch: 0,
      effectId: 2,
      attempt: makeAttempt({ txHash: "0xresumed", phase: "submitted" }),
    });
    assertStep(next, "confirming");
    expect(next.attempt.txHash).toBe("0xresumed");
    expect(next.phase).toBe("credit");
    expect(effects).toEqual([
      {
        kind: "awaitDepositCredit",
        effectId: 3,
        epoch: 0,
        attempt: next.attempt,
      },
    ]);
    expect(effects.some((effect) => effect.kind === "execute")).toBe(false);
  });

  it("EXECUTION_FAILED ambiguous → error(AMBIGUOUS_OUTCOME, retryable:true); RETRY re-emits beginAttempt (same command)", () => {
    let state = drive(depositToSubmittingEvents());
    [state] = reduceFunding(state, {
      type: "ATTEMPT_READY",
      epoch: 0,
      effectId: 2,
      attempt: makeAttempt(),
    }); // issues execute effectId=3
    assertStep(state, "submitting");

    const [errorState, execFailEffects] = reduceFunding(state, {
      type: "EXECUTION_FAILED",
      epoch: 0,
      effectId: 3,
      error: {
        code: "AMBIGUOUS_OUTCOME",
        message: "timed out waiting for receipt",
        retryable: false,
      },
    });
    assertStep(errorState, "error");
    // The reducer derives retryability from the code, not the raw event flag.
    expect(errorState.error).toEqual({
      code: "AMBIGUOUS_OUTCOME",
      message: "timed out waiting for receipt",
      retryable: true,
    });
    expect(execFailEffects).toEqual([]);

    const command = errorState.command;
    const [retriedState, retryEffects] = reduceFunding(errorState, {
      type: "RETRY",
    });
    assertStep(retriedState, "submitting");
    expect(retriedState.command).toBe(command);
    expect(retriedState.attempt).toBeNull();
    expect(retryEffects).toEqual([
      { kind: "beginAttempt", effectId: 4, epoch: 0, command },
    ]);
  });

  it("EXECUTION_FAILED PENDING_RECONCILIATION → error, retryable:false", () => {
    let state = drive(depositToSubmittingEvents());
    [state] = reduceFunding(state, {
      type: "ATTEMPT_READY",
      epoch: 0,
      effectId: 2,
      attempt: makeAttempt(),
    });
    const [errorState] = reduceFunding(state, {
      type: "EXECUTION_FAILED",
      epoch: 0,
      effectId: 3,
      error: {
        code: "PENDING_RECONCILIATION",
        message: "a previous attempt may still be processing",
        retryable: true,
      },
    });
    assertStep(errorState, "error");
    expect(errorState.error.retryable).toBe(false);

    const [afterRetry, retryEffects] = reduceFunding(errorState, {
      type: "RETRY",
    });
    expect(afterRetry).toBe(errorState);
    expect(retryEffects).toEqual([]);
  });

  it("EXECUTION_FAILED IDEMPOTENCY_FINGERPRINT_MISMATCH → error, retryable:false", () => {
    const submittingState = drive(depositToSubmittingEvents());
    assertStep(submittingState, "submitting");
    expect(submittingState.attempt).toBeNull(); // beginAttempt still in flight

    const [errorState, effects] = reduceFunding(submittingState, {
      type: "EXECUTION_FAILED",
      epoch: 0,
      effectId: 2, // matches the beginAttempt effectId, not an execute effectId
      error: {
        code: "IDEMPOTENCY_FINGERPRINT_MISMATCH",
        message: "stored fingerprint mismatch",
        retryable: true,
      },
    });
    assertStep(errorState, "error");
    expect(errorState.error.retryable).toBe(false);
    expect(errorState.attempt).toBeNull();
    expect(effects).toEqual([]);
  });

  it("BACK is disabled from submitting/confirming", () => {
    const submittingState = drive(depositToSubmittingEvents());
    const [afterBackSubmitting, effects1] = reduceFunding(submittingState, {
      type: "BACK",
    });
    expect(afterBackSubmitting).toBe(submittingState);
    expect(effects1).toEqual([]);

    const confirmingState = depositConfirmingState();
    const [afterBackConfirming, effects2] = reduceFunding(confirmingState, {
      type: "BACK",
    });
    expect(afterBackConfirming).toBe(confirmingState);
    expect(effects2).toEqual([]);
  });
});

describe("confirmation unavailable", () => {
  it("CONFIRMATION_UNAVAILABLE in confirming → error(AMBIGUOUS_OUTCOME, retryable:true) keeping command+attempt; RETRY resumes back into confirming", () => {
    const confirmingState = depositConfirmingState();
    assertStep(confirmingState, "confirming");
    // awaitDepositCredit is the active polling kind for deposit; its latest
    // effectId in this drive is 4 (loadTokens=1, beginAttempt=2, execute=3).
    const [errorState, effects] = reduceFunding(confirmingState, {
      type: "CONFIRMATION_UNAVAILABLE",
      epoch: 0,
      effectId: 4,
    });
    assertStep(errorState, "error");
    expect(errorState.error).toEqual({
      code: "AMBIGUOUS_OUTCOME",
      message:
        "We could not confirm the transaction status. Your funds have not been moved twice.",
      retryable: true,
    });
    expect(errorState.command).toBe(confirmingState.command);
    expect(errorState.attempt).toEqual({
      ...makeAttempt(),
      txHash: "0xtx",
      phase: "submitted",
    });
    expect(effects).toEqual([]);

    // RETRY re-runs beginAttempt with the same command...
    const [retriedState, retryEffects] = reduceFunding(errorState, {
      type: "RETRY",
    });
    assertStep(retriedState, "submitting");
    expect(retryEffects).toEqual([
      {
        kind: "beginAttempt",
        effectId: 5,
        epoch: 0,
        command: confirmingState.command,
      },
    ]);

    // ...and the resumed (already-submitted) attempt re-enters confirming
    // without a second execute.
    const resumedAttempt = makeAttempt({ txHash: "0xtx", phase: "submitted" });
    const [resumedState, resumedEffects] = reduceFunding(retriedState, {
      type: "ATTEMPT_READY",
      epoch: 0,
      effectId: 5,
      attempt: resumedAttempt,
    });
    assertStep(resumedState, "confirming");
    expect(resumedState.attempt).toEqual(resumedAttempt);
    expect(resumedEffects).toEqual([
      {
        kind: "awaitDepositCredit",
        effectId: 6,
        epoch: 0,
        attempt: resumedAttempt,
      },
    ]);
  });

  it("stale CONFIRMATION_UNAVAILABLE (old effectId or old epoch) is dropped", () => {
    const confirmingState = depositConfirmingState();
    assertStep(confirmingState, "confirming");

    const [afterStaleId, effects1] = reduceFunding(confirmingState, {
      type: "CONFIRMATION_UNAVAILABLE",
      epoch: 0,
      effectId: 3, // execute's id, not the latest awaitDepositCredit id (4)
    });
    expect(afterStaleId).toBe(confirmingState);
    expect(effects1).toEqual([]);

    const [afterStaleEpoch, effects2] = reduceFunding(confirmingState, {
      type: "CONFIRMATION_UNAVAILABLE",
      epoch: 1, // wrong epoch, right effectId
      effectId: 4,
    });
    expect(afterStaleEpoch).toBe(confirmingState);
    expect(effects2).toEqual([]);
  });
});
