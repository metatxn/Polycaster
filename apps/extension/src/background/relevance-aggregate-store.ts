import {
  addRelevanceAggregateSample,
  parseRelevanceAggregateSample,
  type RelevanceAggregateSnapshot,
  sanitizeRelevanceAggregateSnapshot,
} from "../relevance-aggregate-telemetry";

export const RELEVANCE_AGGREGATE_STORAGE_KEY = "knoww_relevance_aggregate_v1";

export interface RelevanceAggregateStorage {
  get(key: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface RelevanceAggregateStore {
  record(value: unknown): Promise<boolean>;
  exportSnapshot(): Promise<RelevanceAggregateSnapshot>;
  clear(): Promise<void>;
}

export function createRelevanceAggregateStore(
  storage: RelevanceAggregateStorage,
  now: () => number = () => Date.now()
): RelevanceAggregateStore {
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<Result>(task: () => Promise<Result>): Promise<Result> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function readSnapshot(): Promise<RelevanceAggregateSnapshot> {
    const values = await storage.get(RELEVANCE_AGGREGATE_STORAGE_KEY);
    return sanitizeRelevanceAggregateSnapshot(
      values[RELEVANCE_AGGREGATE_STORAGE_KEY],
      now()
    );
  }

  return {
    record(value) {
      const sample = parseRelevanceAggregateSample(value);
      if (!sample) return Promise.resolve(false);

      return enqueue(async () => {
        const timestamp = now();
        const snapshot = addRelevanceAggregateSample(
          await readSnapshot(),
          sample,
          timestamp
        );
        await storage.set({ [RELEVANCE_AGGREGATE_STORAGE_KEY]: snapshot });
        return true;
      });
    },
    exportSnapshot() {
      return enqueue(readSnapshot);
    },
    clear() {
      return enqueue(async () => {
        await storage.remove(RELEVANCE_AGGREGATE_STORAGE_KEY);
      });
    },
  };
}
