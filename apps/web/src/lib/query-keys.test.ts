import { describe, expect, it } from "vitest";
import { qk } from "./query-keys";

describe("query-keys factory", () => {
  describe("events", () => {
    it("events.all returns the top-level prefix", () => {
      expect(qk.events.all()).toEqual(["events"]);
    });

    it("events.trending embeds limit/full/filters", () => {
      const key = qk.events.trending(20, true, { tag: "sports" });
      expect(key).toEqual(["trending-events", 20, true, { tag: "sports" }]);
    });

    it("events.breaking and events.new produce distinct roots", () => {
      const breaking = qk.events.breaking(20, true, {});
      const next = qk.events.new(20, true, {});
      expect(breaking[0]).toBe("breaking-events");
      expect(next[0]).toBe("new-events");
      expect(breaking).not.toEqual(next);
    });
  });

  describe("market", () => {
    it("market.bySlug embeds the slug", () => {
      expect(qk.market.bySlug("world-cup-winner")).toEqual([
        "market-detail",
        "world-cup-winner",
      ]);
    });

    it("market.priceHistoryBatch is stable for same input", () => {
      const tokens = ["aaa", "bbb"];
      expect(qk.market.priceHistoryBatch(tokens, 30, 60)).toEqual([
        "price-history-batch",
        ["aaa", "bbb"],
        30,
        60,
      ]);
    });

    it("market.priceHistoryBatch keys differ when lookback differs", () => {
      const tokens = ["aaa"];
      expect(qk.market.priceHistoryBatch(tokens, 30, 60)).not.toEqual(
        qk.market.priceHistoryBatch(tokens, 7, 60)
      );
    });

    it("market.allPriceHistory is the prefix for both chart batches", () => {
      expect(qk.market.allPriceHistory()).toEqual(["priceHistory"]);
      const chart = qk.market.priceHistory(["aaa"], "1W", 60);
      const table = qk.market.outcomeTablePriceHistory("1W", ["aaa"], 123, 60);
      expect(chart).toEqual(["priceHistory", ["aaa"], "1W", 60]);
      expect(table).toEqual([
        "priceHistory",
        "outcome-table",
        "1W",
        ["aaa"],
        123,
        60,
      ]);
      expect(chart[0]).toBe("priceHistory");
      expect(table[0]).toBe("priceHistory");
      expect(chart).not.toEqual(table);
    });
  });

  describe("tags", () => {
    it("tags.all is the prefix for everything tag-related", () => {
      expect(qk.tags.all()).toEqual(["tags"]);
    });

    it("tags.details narrows by slug", () => {
      expect(qk.tags.details("crypto")).toEqual(["tag", "details", "crypto"]);
    });

    it("tags.markets is independent of tags.details", () => {
      expect(qk.tags.markets("crypto", {})[0]).not.toBe(
        qk.tags.details("crypto")[0]
      );
    });
  });

  describe("orders — invalidation hierarchy", () => {
    it("orders.all is a prefix of orders.list (per-user)", () => {
      const all = qk.orders.all();
      const list = qk.orders.list("0xabc", "market-1");
      expect(list[0]).toBe(all[0]);
      // TanStack's matcher treats `["openOrders"]` as a prefix of
      // `["openOrders", addr, market]` — verify the literal shape.
      expect(list.slice(0, all.length)).toEqual([...all]);
    });

    it("orders.list can omit market filter", () => {
      const allOrdersForUser = qk.orders.list("0xabc");
      expect(allOrdersForUser).toEqual(["openOrders", "0xabc", undefined]);
    });

    it("orders.list for different users produces different keys", () => {
      expect(qk.orders.list("0xabc")).not.toEqual(qk.orders.list("0xdef"));
    });
  });

  describe("positions", () => {
    it("positions.all is a top-level prefix", () => {
      expect(qk.positions.all()).toEqual(["userPositions"]);
    });

    it("positions.forMarket is keyed by user + market", () => {
      expect(qk.positions.forMarket("0xabc", "mkt-1")).toEqual([
        "userPositions",
        "market",
        "0xabc",
        "mkt-1",
      ]);
    });

    it("positions.forMarket shares the same root as positions.all (invalidation hierarchy)", () => {
      expect(qk.positions.forMarket("0xabc", "mkt-1")[0]).toBe(
        qk.positions.all()[0]
      );
    });
  });

  describe("pnl", () => {
    it("pnl.summary and pnl.user are siblings, not nested", () => {
      const summary = qk.pnl.summary("0xabc");
      const user = qk.pnl.user("0xabc", "1D", true);
      expect(summary[0]).not.toBe(user[0]);
      expect(summary).toEqual(["userPnLSummary", "0xabc"]);
      expect(user).toEqual(["userPnL", "0xabc", "1D", true]);
    });

    it("pnl.history embeds interval + fidelity", () => {
      expect(qk.pnl.history("0xabc", "1W", "1h")).toEqual([
        "pnlHistory",
        "0xabc",
        "1W",
        "1h",
      ]);
    });
  });

  describe("wallet", () => {
    it("wallet.tokens is keyed by address", () => {
      expect(qk.wallet.tokens("0xabc")).toEqual(["wallet-tokens", "0xabc"]);
    });

    it("wallet.allUsdcBalances is the prefix for every per-owner balance", () => {
      expect(qk.wallet.allUsdcBalances()).toEqual(["usdcBalance"]);
      const owner = qk.wallet.usdcBalance("0xabc");
      expect(owner.slice(0, 1)).toEqual([...qk.wallet.allUsdcBalances()]);
    });

    it("wallet.polPrice is a global key (no params)", () => {
      expect(qk.wallet.polPrice()).toEqual(["pol-price"]);
    });

    it("wallet.usdcBalance and wallet.portfolioValue are independent", () => {
      expect(qk.wallet.usdcBalance("0xabc")[0]).not.toBe(
        qk.wallet.portfolioValue("0xabc")[0]
      );
    });
  });

  describe("profile", () => {
    it("profile.trader vs profile.public produce distinct keys", () => {
      const t = qk.profile.trader("0xabc");
      const p = qk.profile.public("0xabc");
      expect(t).not.toEqual(p);
    });

    it("profile.topHolders is keyed by market", () => {
      expect(qk.profile.topHolders("mkt-1")).toEqual(["topHolders", "mkt-1"]);
    });
  });

  describe("comments + search + orderBook", () => {
    it("comments key is stable for the same inputs", () => {
      const opts = {
        limit: 20,
        order: "createdAt",
        ascending: false,
        holdersOnly: false,
        getReports: false,
      };
      expect(qk.comments("market", "mkt-1", opts)).toEqual([
        "comments",
        "market",
        "mkt-1",
        opts,
      ]);
    });

    it("comments key differs when holders-only flips", () => {
      const base = {
        limit: 20,
        order: "createdAt",
        ascending: false,
        holdersOnly: false,
        getReports: false,
      };
      const withHolders = { ...base, holdersOnly: true };
      expect(qk.comments("market", "mkt-1", withHolders)).not.toEqual(
        qk.comments("market", "mkt-1", base)
      );
    });

    it("search keys vary by query + limit + tagSlug", () => {
      expect(qk.search("trump", 8, "politics")).toEqual([
        "search",
        "trump",
        8,
        "politics",
      ]);
    });

    it("search keys differ when tagSlug flips between null and a value", () => {
      expect(qk.search("trump", 8, null)).not.toEqual(
        qk.search("trump", 8, "politics")
      );
    });

    it("orderBook is keyed by tokenId", () => {
      expect(qk.orderBook("token-1")).toEqual(["orderBook", "token-1"]);
    });

    it("orderBooks (batch seed) is keyed by the token-id list", () => {
      expect(qk.orderBooks(["token-1", "token-2"])).toEqual([
        "orderBooks",
        ["token-1", "token-2"],
      ]);
    });
  });

  describe("sports", () => {
    it("companionMarkets is keyed by the joined slug list", () => {
      expect(
        qk.sports.companionMarkets("a-more-markets,b-more-markets")
      ).toEqual(["companion-markets", "a-more-markets,b-more-markets"]);
    });

    it("leagueCounts is keyed by the joined tag-slug list", () => {
      expect(qk.sports.leagueCounts("epl,nba")).toEqual([
        "league-counts",
        "epl,nba",
      ]);
    });
  });

  describe("wallet allowances + trading approvals", () => {
    it("wallet.allUsdcAllowances is the prefix for every per-proxy allowance", () => {
      expect(qk.wallet.allUsdcAllowances()).toEqual(["usdcAllowance"]);
      const key = qk.wallet.usdcAllowance("0xabc", true, false);
      expect(key).toEqual(["usdcAllowance", "0xabc", true, false]);
      expect(key.slice(0, 1)).toEqual([...qk.wallet.allUsdcAllowances()]);
    });

    it("wallet.allTradingApprovals is the prefix for every approval check", () => {
      expect(qk.wallet.allTradingApprovals()).toEqual(["tradingApprovals"]);
      const key = qk.wallet.tradingApprovals("0xabc", true, "1000000");
      expect(key).toEqual(["tradingApprovals", "0xabc", true, "1000000"]);
      expect(key.slice(0, 1)).toEqual([...qk.wallet.allTradingApprovals()]);
    });
  });

  describe("structural invariants", () => {
    it("every factory returns an array", () => {
      expect(Array.isArray(qk.events.all())).toBe(true);
      expect(Array.isArray(qk.market.bySlug("x"))).toBe(true);
      expect(Array.isArray(qk.orders.list("0xabc"))).toBe(true);
      expect(Array.isArray(qk.wallet.polPrice())).toBe(true);
    });

    it("no two top-level domains share a key root", () => {
      const roots = [
        qk.events.all()[0],
        qk.market.all()[0],
        qk.tags.all()[0],
        qk.orders.all()[0],
        qk.positions.all()[0],
        qk.wallet.polPrice()[0],
        qk.search("", 0, null)[0],
        qk.orderBook("")[0],
      ];
      expect(new Set(roots).size).toBe(roots.length);
    });
  });
});
