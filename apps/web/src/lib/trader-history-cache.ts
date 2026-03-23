import { POLYMARKET_API } from "@/constants/polymarket";

interface TraderHistoryEntry {
  firstTradeDate: string | null;
  totalTrades: number;
  accountAgeHours: number;
  fetchedAt: number;
}

interface ActivityData {
  timestamp: number;
  type: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 2000;
const UNKNOWN_ACCOUNT_AGE_HOURS = 100 * 365 * 24; // 100 years

const traderHistoryCache = new Map<string, TraderHistoryEntry>();

function evictStaleEntries() {
  const now = Date.now();
  const toDelete: string[] = [];

  for (const [key, entry] of traderHistoryCache) {
    if (now - entry.fetchedAt > CACHE_TTL_MS) {
      toDelete.push(key);
    }
  }

  for (const key of toDelete) {
    traderHistoryCache.delete(key);
  }

  if (traderHistoryCache.size > MAX_CACHE_SIZE) {
    const entries = [...traderHistoryCache.entries()].sort(
      (a, b) => a[1].fetchedAt - b[1].fetchedAt
    );
    const excess = entries.length - MAX_CACHE_SIZE;
    for (let i = 0; i < excess; i++) {
      traderHistoryCache.delete(entries[i][0]);
    }
  }
}

/**
 * Paginate through a trader's full activity history to find their true
 * first trade date. Walks backwards through pages until no more data or
 * we've seen enough to be confident in the earliest timestamp.
 */
async function fetchFullTraderHistory(
  address: string
): Promise<{ firstTradeDate: string | null; totalTrades: number }> {
  const pageSize = 100;
  let offset = 0;
  let earliestTimestamp = Infinity;
  let totalTradeCount = 0;
  const maxPages = 5; // Cap at 500 activities to avoid excessive API calls

  for (let page = 0; page < maxPages; page++) {
    try {
      const response = await fetch(
        `${POLYMARKET_API.DATA.BASE}/activity?user=${address.toLowerCase()}&limit=${pageSize}&offset=${offset}`,
        {
          headers: { Accept: "application/json" },
          next: { revalidate: 300 },
        }
      );

      if (!response.ok) break;

      const activities: ActivityData[] = await response.json();
      if (!activities || activities.length === 0) break;

      const trades = activities.filter((a) => a.type === "TRADE");
      totalTradeCount += trades.length;

      for (const trade of trades) {
        if (trade.timestamp < earliestTimestamp) {
          earliestTimestamp = trade.timestamp;
        }
      }

      // If we got fewer results than the page size, we've reached the end
      if (activities.length < pageSize) break;

      offset += pageSize;
    } catch {
      break;
    }
  }

  if (earliestTimestamp === Infinity) {
    return { firstTradeDate: null, totalTrades: 0 };
  }

  return {
    firstTradeDate: new Date(earliestTimestamp * 1000).toISOString(),
    totalTrades: totalTradeCount,
  };
}

/**
 * Get trader history with caching. Returns account age, first trade date,
 * and total trade count. Uses paginated fetch for accurate first-seen time.
 */
export async function getTraderHistory(
  rawAddress: string
): Promise<TraderHistoryEntry> {
  const address = rawAddress.toLowerCase();
  const now = Date.now();
  const cached = traderHistoryCache.get(address);

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      ...cached,
      accountAgeHours:
        cached.firstTradeDate === null
          ? UNKNOWN_ACCOUNT_AGE_HOURS
          : (now - new Date(cached.firstTradeDate).getTime()) /
            (1000 * 60 * 60),
    };
  }

  const history = await fetchFullTraderHistory(address);
  const accountAgeHours =
    history.firstTradeDate === null
      ? UNKNOWN_ACCOUNT_AGE_HOURS
      : (now - new Date(history.firstTradeDate).getTime()) / (1000 * 60 * 60);

  const entry: TraderHistoryEntry = {
    firstTradeDate: history.firstTradeDate,
    totalTrades: history.totalTrades,
    accountAgeHours,
    fetchedAt: now,
  };

  evictStaleEntries();
  traderHistoryCache.set(address, entry);

  return entry;
}

/**
 * Batch-fetch trader histories with concurrency control.
 */
export async function getTraderHistoriesBatch(
  addresses: string[],
  concurrency = 10
): Promise<Map<string, TraderHistoryEntry>> {
  const results = new Map<string, TraderHistoryEntry>();

  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (address) => {
        const history = await getTraderHistory(address);
        return { address, history };
      })
    );

    for (const { address, history } of batchResults) {
      results.set(address, history);
    }
  }

  return results;
}
