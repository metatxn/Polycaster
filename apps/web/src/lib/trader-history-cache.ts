import {
  fetchWalletActivitySnapshot,
  type WalletTradeRecord,
} from "@/lib/insider/wallet-trades-cache";

export interface TraderHistoryEntry {
  firstTradeDate: string | null;
  totalTrades: number;
  accountAgeHours: number;
  fetchedAt: number;
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
interface TraderHistoryLoadResult {
  history: TraderHistoryEntry;
  trades?: WalletTradeRecord[];
}

/**
 * Get trader history with caching. Returns account age, first trade date,
 * and total trade count. Uses paginated fetch for accurate first-seen time.
 */
async function loadTraderHistory(
  rawAddress: string,
  collectTrades: boolean,
  signal?: AbortSignal
): Promise<TraderHistoryLoadResult> {
  const address = rawAddress.toLowerCase();
  const now = Date.now();
  const cached = traderHistoryCache.get(address);

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      history: {
        ...cached,
        accountAgeHours:
          cached.firstTradeDate === null
            ? UNKNOWN_ACCOUNT_AGE_HOURS
            : (now - new Date(cached.firstTradeDate).getTime()) /
              (1000 * 60 * 60),
      },
    };
  }

  const snapshot = await fetchWalletActivitySnapshot(
    address,
    collectTrades,
    signal
  );
  const firstTradeDate =
    snapshot.earliestTradeTimestamp === null
      ? null
      : new Date(snapshot.earliestTradeTimestamp * 1000).toISOString();
  const accountAgeHours =
    firstTradeDate === null
      ? UNKNOWN_ACCOUNT_AGE_HOURS
      : (now - new Date(firstTradeDate).getTime()) / (1000 * 60 * 60);

  const entry: TraderHistoryEntry = {
    firstTradeDate,
    totalTrades: snapshot.totalTrades,
    accountAgeHours,
    fetchedAt: now,
  };

  evictStaleEntries();
  traderHistoryCache.set(address, entry);

  return {
    history: entry,
    ...(collectTrades ? { trades: snapshot.trades } : {}),
  };
}

export async function getTraderHistory(
  rawAddress: string,
  signal?: AbortSignal
): Promise<TraderHistoryEntry> {
  return (await loadTraderHistory(rawAddress, false, signal)).history;
}

export interface TraderHistoriesWithTrades {
  histories: Map<string, TraderHistoryEntry>;
  tradesByAddress: Map<string, WalletTradeRecord[]>;
}

export async function getTraderHistoriesWithTradesBatch(
  addresses: string[],
  concurrency = 10,
  signal?: AbortSignal
): Promise<TraderHistoriesWithTrades> {
  const histories = new Map<string, TraderHistoryEntry>();
  const tradesByAddress = new Map<string, WalletTradeRecord[]>();

  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (address) => ({
        address,
        result: await loadTraderHistory(address, true, signal),
      }))
    );

    for (const { address, result } of batchResults) {
      histories.set(address, result.history);
      if (result.trades) {
        tradesByAddress.set(address.toLowerCase(), result.trades);
      }
    }
  }

  return { histories, tradesByAddress };
}

/**
 * Batch-fetch trader histories with concurrency control.
 */
export async function getTraderHistoriesBatch(
  addresses: string[],
  concurrency = 10,
  signal?: AbortSignal
): Promise<Map<string, TraderHistoryEntry>> {
  const results = new Map<string, TraderHistoryEntry>();

  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (address) => {
        const history = await getTraderHistory(address, signal);
        return { address, history };
      })
    );

    for (const { address, history } of batchResults) {
      results.set(address, history);
    }
  }

  return results;
}
