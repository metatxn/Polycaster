import { describe, expect, it, vi } from "vitest";
import {
  fetchClosedPositions,
  fetchPublicProfile,
  fetchWalletActivity,
  fetchWalletPortfolioValue,
  fetchWalletPositions,
  summarizeWalletPnl,
} from "./public-data";

const WALLET = `0x${"b".repeat(40)}`;
const CONDITION_ID = `0x${"a".repeat(64)}`;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recordingFetch(
  respond: (url: URL, init: RequestInit | undefined) => Response
) {
  const calls: URL[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url);
      return respond(url, init);
    }
  ) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const POSITION = {
  proxyWallet: WALLET,
  asset: "123",
  conditionId: CONDITION_ID,
  size: 10,
  avgPrice: 0.4,
  initialValue: 4,
  currentValue: 6,
  cashPnl: 2,
  percentPnl: 50,
  totalBought: 10,
  realizedPnl: 0.5,
  percentRealizedPnl: 12.5,
  curPrice: 0.6,
  redeemable: false,
  mergeable: false,
  title: "Market",
  slug: "market",
  eventSlug: "event",
  outcome: "Yes",
  outcomeIndex: 0,
  oppositeOutcome: "No",
  oppositeAsset: "456",
  endDate: "2026-12-31T00:00:00Z",
  negativeRisk: false,
};

describe("public profile data clients", () => {
  it("returns a validated public profile or null on 404", async () => {
    const success = recordingFetch(() =>
      jsonResponse({
        createdAt: "2025-01-01T00:00:00Z",
        proxyWallet: WALLET,
        displayUsernamePublic: true,
        pseudonym: "quiet-river",
        name: "Alice",
        verifiedBadge: false,
      })
    );
    await expect(
      fetchPublicProfile(WALLET, { fetchImpl: success.fetchImpl })
    ).resolves.toMatchObject({ name: "Alice", proxyWallet: WALLET });
    expect(success.calls[0].pathname).toBe("/public-profile");
    expect(success.calls[0].searchParams.get("address")).toBe(WALLET);

    const missing = recordingFetch(() => jsonResponse({}, 404));
    await expect(
      fetchPublicProfile(WALLET, { fetchImpl: missing.fetchImpl })
    ).resolves.toBeNull();
  });

  it("fetches positions and converts every monetary value to a string", async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse([POSITION]));

    const positions = await fetchWalletPositions(
      {
        walletAddress: WALLET,
        limit: 50,
        offset: 0,
        sizeThreshold: "0.1",
        sortBy: "CURRENT",
        sortDirection: "DESC",
      },
      { fetchImpl }
    );

    expect(calls[0].pathname).toBe("/positions");
    expect(positions[0]).toMatchObject({
      size: "10",
      avgPrice: "0.4",
      currentValue: "6",
      cashPnl: "2",
      realizedPnl: "0.5",
    });
  });

  it("fetches bounded wallet activity", async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse([
        {
          proxyWallet: WALLET,
          timestamp: 1_800_000_000,
          conditionId: CONDITION_ID,
          type: "TRADE",
          size: 10,
          usdcSize: 4,
          transactionHash: `0x${"c".repeat(64)}`,
          price: 0.4,
          asset: "123",
          side: "BUY",
          outcomeIndex: 0,
          title: "Market",
          slug: "market",
          eventSlug: "event",
          outcome: "Yes",
        },
      ])
    );

    const activity = await fetchWalletActivity(
      {
        walletAddress: WALLET,
        types: ["TRADE"],
        limit: 50,
        offset: 0,
        sortDirection: "DESC",
      },
      { fetchImpl }
    );

    expect(calls[0].pathname).toBe("/activity");
    expect(calls[0].searchParams.get("type")).toBe("TRADE");
    expect(activity[0]).toMatchObject({ size: "10", usdcSize: "4" });
  });

  it("fetches closed positions and portfolio value", async () => {
    const closed = recordingFetch((url) => {
      if (url.pathname === "/closed-positions") {
        return jsonResponse([
          {
            proxyWallet: WALLET,
            asset: "123",
            conditionId: CONDITION_ID,
            avgPrice: 0.4,
            totalBought: 10,
            realizedPnl: 2.5,
            curPrice: 1,
            timestamp: 1_800_000_000,
            title: "Market",
            slug: "market",
            eventSlug: "event",
            outcome: "Yes",
            outcomeIndex: 0,
          },
        ]);
      }
      return jsonResponse([{ user: WALLET, value: 42.75 }]);
    });

    await expect(
      fetchClosedPositions(
        {
          walletAddress: WALLET,
          limit: 20,
          offset: 0,
          sortBy: "REALIZEDPNL",
          sortDirection: "DESC",
        },
        { fetchImpl: closed.fetchImpl }
      )
    ).resolves.toMatchObject([{ realizedPnl: "2.5" }]);
    await expect(
      fetchWalletPortfolioValue(WALLET, { fetchImpl: closed.fetchImpl })
    ).resolves.toEqual({ walletAddress: WALLET, value: "42.75" });
  });

  it("summarizes wallet PnL with Decimal.js-safe strings", () => {
    const summary = summarizeWalletPnl([
      {
        ...POSITION,
        size: "10",
        initialValue: "4",
        currentValue: "6",
        cashPnl: "2",
        realizedPnl: "0.5",
      },
      {
        ...POSITION,
        asset: "789",
        size: "5",
        initialValue: "3",
        currentValue: "2",
        cashPnl: "-1",
        realizedPnl: "0.25",
      },
    ]);

    expect(summary).toEqual({
      positionCount: 2,
      initialValue: "7",
      currentValue: "8",
      cashPnl: "1",
      realizedPnl: "0.75",
      totalPnl: "1.75",
      roiPercent: "25",
      winningPositions: 1,
      losingPositions: 1,
    });
  });
});
