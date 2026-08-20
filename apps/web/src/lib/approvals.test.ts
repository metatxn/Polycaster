import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApprovalStatus, checkAllApprovals } from "./approvals";

const readTradingApprovalStatus = vi.hoisted(() => vi.fn());

vi.mock("@knoww/shared-types/approvals", () => ({
  readTradingApprovalStatus,
}));

vi.mock("@/lib/rpc", () => ({
  getPublicClient: vi.fn(() => ({})),
}));

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

function statusWith(overrides: Partial<ApprovalStatus> = {}): ApprovalStatus {
  return {
    pusdCtf: true,
    pusdCtfExchange: true,
    pusdNegRiskExchange: true,
    pusdCtfCollateralAdapter: true,
    pusdNegRiskCtfCollateralAdapter: true,
    usdcOnramp: true,
    ctfExchangeApproval: true,
    ctfNegRiskExchangeApproval: true,
    ctfCollateralAdapterApproval: true,
    ctfNegRiskCollateralAdapterApproval: true,
    allApproved: true,
    clobTradingApproved: true,
    autoWrapApproved: true,
    ctfOperationsApproved: true,
    negRiskConversionApproved: true,
    readFailures: [],
    allReadsOk: true,
    ...overrides,
  };
}

function partialNegative(): ApprovalStatus {
  // What a 429'd multicall produces: the failed read scores its flag
  // false, dragging every aggregate down with it.
  return statusWith({
    pusdCtfExchange: false,
    clobTradingApproved: false,
    allApproved: false,
    allReadsOk: false,
    readFailures: ["pusdCtfExchange"],
  });
}

// The module-level in-flight map is keyed by address, so each test uses
// its own address to stay independent of completion order.
let addressCounter = 0;
function nextAddress(): string {
  addressCounter += 1;
  return `0x${addressCounter.toString(16).padStart(40, "0")}`;
}

describe("checkAllApprovals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    readTradingApprovalStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a clean read without retrying", async () => {
    const clean = statusWith();
    readTradingApprovalStatus.mockResolvedValue(clean);

    const status = await checkAllApprovals(nextAddress());

    expect(status).toBe(clean);
    expect(readTradingApprovalStatus).toHaveBeenCalledTimes(1);
  });

  it("retries a partial read and returns the eventual clean result", async () => {
    const clean = statusWith();
    readTradingApprovalStatus
      .mockResolvedValueOnce(partialNegative())
      .mockResolvedValueOnce(clean);

    const promise = checkAllApprovals(nextAddress());
    await vi.advanceTimersByTimeAsync(1000);

    expect(await promise).toBe(clean);
    expect(readTradingApprovalStatus).toHaveBeenCalledTimes(2);
  });

  it("trusts allApproved=true immediately even when some reads failed", async () => {
    // A failed read can only under-report, so a positive verdict needs no
    // retry — this is what keeps already-approved users out of the modal.
    const trustworthyPositive = statusWith({
      usdcOnramp: false,
      allReadsOk: false,
      readFailures: ["usdcOnramp"],
    });
    readTradingApprovalStatus.mockResolvedValue(trustworthyPositive);

    const status = await checkAllApprovals(nextAddress());

    expect(status).toBe(trustworthyPositive);
    expect(status.allApproved).toBe(true);
    expect(readTradingApprovalStatus).toHaveBeenCalledTimes(1);
  });

  it("returns the final partial status instead of throwing when every retry stays partial", async () => {
    readTradingApprovalStatus.mockResolvedValue(partialNegative());

    const promise = checkAllApprovals(nextAddress());
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2500);

    const status = await promise;
    expect(status.allReadsOk).toBe(false);
    expect(status.readFailures).toEqual(["pusdCtfExchange"]);
    expect(readTradingApprovalStatus).toHaveBeenCalledTimes(3);
  });

  it("rejects when every attempt throws", async () => {
    readTradingApprovalStatus.mockRejectedValue(new Error("rpc down"));

    const promise = checkAllApprovals(nextAddress());
    const assertion = expect(promise).rejects.toThrow("rpc down");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2500);

    await assertion;
    expect(readTradingApprovalStatus).toHaveBeenCalledTimes(3);
  });

  it("recovers when a throw is followed by a clean read", async () => {
    const clean = statusWith();
    readTradingApprovalStatus
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValueOnce(clean);

    const promise = checkAllApprovals(nextAddress());
    await vi.advanceTimersByTimeAsync(1000);

    expect(await promise).toBe(clean);
    expect(readTradingApprovalStatus).toHaveBeenCalledTimes(2);
  });

  it("dedups concurrent checks for the same address into one read", async () => {
    const clean = statusWith();
    let release: (status: ApprovalStatus) => void = () => {};
    readTradingApprovalStatus.mockImplementation(
      () =>
        new Promise<ApprovalStatus>((resolve) => {
          release = resolve;
        })
    );

    const address = nextAddress();
    const first = checkAllApprovals(address);
    const second = checkAllApprovals(address);
    release(clean);

    expect(await first).toBe(clean);
    expect(await second).toBe(clean);
    expect(readTradingApprovalStatus).toHaveBeenCalledTimes(1);
  });
});
