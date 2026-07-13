import { isPortfolioFundIdempotencyKey } from "../types/portfolio-fund-intent";

const STORAGE_PREFIX = "knoww_portfolio_fund_intent_";
const COMPLETED_RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_COMPLETED_RECORDS = 50;

export type PortfolioFundIdempotencyErrorCode =
  | "IDEMPOTENCY_FINGERPRINT_MISMATCH"
  | "INVALID_IDEMPOTENCY_KEY"
  | "PENDING_RECONCILIATION";

export class PortfolioFundIdempotencyError extends Error {
  readonly code: PortfolioFundIdempotencyErrorCode;

  constructor(code: PortfolioFundIdempotencyErrorCode) {
    super(code);
    this.name = "PortfolioFundIdempotencyError";
    this.code = code;
  }
}

export interface PortfolioFundIdempotencyStorage {
  get(key: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface PortfolioFundRunInput<Result> {
  idempotencyKey: string;
  fingerprint: string;
  execute(context: { markMoneyMovementStarted(): void }): Promise<Result>;
  isSafeToRetryError?: (error: unknown) => boolean;
}

export interface PortfolioFundIdempotencyCoordinator {
  run<Result>(input: PortfolioFundRunInput<Result>): Promise<Result>;
}

interface PendingRecord {
  version: 1;
  idempotencyKey: string;
  fingerprint: string;
  status: "pending";
  createdAt: string;
  updatedAt: string;
}

interface CompletedRecord extends Omit<PendingRecord, "status"> {
  status: "completed";
  result: unknown;
}

type PersistedRecord = PendingRecord | CompletedRecord;

interface InFlightRecord {
  fingerprint: string;
  promise: Promise<unknown>;
}

const inFlightByKey = new Map<string, InFlightRecord>();
const inFlightByFingerprint = new Map<string, InFlightRecord>();

export function portfolioFundIdempotencyStorageKey(
  idempotencyKey: string
): string {
  return `${STORAGE_PREFIX}${idempotencyKey}`;
}

function isPersistedRecord(value: unknown): value is PersistedRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedRecord>;
  return (
    record.version === 1 &&
    typeof record.idempotencyKey === "string" &&
    typeof record.fingerprint === "string" &&
    (record.status === "pending" || record.status === "completed") &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

async function pruneCompletedRecords(
  storage: PortfolioFundIdempotencyStorage,
  nowMs: number
): Promise<void> {
  const values = await storage.get(null);
  const completed = Object.entries(values)
    .filter(
      ([key, value]) =>
        key.startsWith(STORAGE_PREFIX) &&
        isPersistedRecord(value) &&
        value.status === "completed"
    )
    .map(([key, value]) => ({ key, record: value as CompletedRecord }))
    .sort(
      (left, right) =>
        Date.parse(right.record.updatedAt) - Date.parse(left.record.updatedAt)
    );
  const keysToRemove = completed.flatMap(({ key, record }, index) => {
    const updatedAt = Date.parse(record.updatedAt);
    const expired =
      !Number.isFinite(updatedAt) ||
      nowMs - updatedAt > COMPLETED_RECORD_TTL_MS;
    return expired || index >= MAX_COMPLETED_RECORDS ? [key] : [];
  });
  if (keysToRemove.length > 0) await storage.remove(keysToRemove);
}

export function createPortfolioFundIdempotencyCoordinator(
  storage: PortfolioFundIdempotencyStorage,
  now: () => number = () => Date.now()
): PortfolioFundIdempotencyCoordinator {
  return {
    run<Result>(input: PortfolioFundRunInput<Result>): Promise<Result> {
      if (!isPortfolioFundIdempotencyKey(input.idempotencyKey)) {
        return Promise.reject(
          new PortfolioFundIdempotencyError("INVALID_IDEMPOTENCY_KEY")
        );
      }

      const active = inFlightByKey.get(input.idempotencyKey);
      if (active) {
        if (active.fingerprint !== input.fingerprint) {
          return Promise.reject(
            new PortfolioFundIdempotencyError(
              "IDEMPOTENCY_FINGERPRINT_MISMATCH"
            )
          );
        }
        return active.promise as Promise<Result>;
      }

      const activeFingerprint = inFlightByFingerprint.get(input.fingerprint);
      if (activeFingerprint) {
        return activeFingerprint.promise as Promise<Result>;
      }

      const promise = runPersisted(storage, now, input);
      const tracked = promise.finally(() => {
        if (inFlightByKey.get(input.idempotencyKey)?.promise === tracked) {
          inFlightByKey.delete(input.idempotencyKey);
        }
        if (inFlightByFingerprint.get(input.fingerprint)?.promise === tracked) {
          inFlightByFingerprint.delete(input.fingerprint);
        }
      });
      const inFlight = {
        fingerprint: input.fingerprint,
        promise: tracked,
      };
      inFlightByKey.set(input.idempotencyKey, inFlight);
      inFlightByFingerprint.set(input.fingerprint, inFlight);
      return tracked;
    },
  };
}

async function runPersisted<Result>(
  storage: PortfolioFundIdempotencyStorage,
  now: () => number,
  input: PortfolioFundRunInput<Result>
): Promise<Result> {
  const nowMs = now();
  await pruneCompletedRecords(storage, nowMs);
  const storageKey = portfolioFundIdempotencyStorageKey(input.idempotencyKey);
  const values = await storage.get(storageKey);
  const existing = values[storageKey];

  if (isPersistedRecord(existing)) {
    if (existing.fingerprint !== input.fingerprint) {
      throw new PortfolioFundIdempotencyError(
        "IDEMPOTENCY_FINGERPRINT_MISMATCH"
      );
    }
    if (existing.status === "completed") return existing.result as Result;
    throw new PortfolioFundIdempotencyError("PENDING_RECONCILIATION");
  }

  const allRecords = await storage.get(null);
  const hasMatchingPending = Object.values(allRecords).some(
    (candidate) =>
      isPersistedRecord(candidate) &&
      candidate.status === "pending" &&
      candidate.fingerprint === input.fingerprint
  );
  if (hasMatchingPending) {
    throw new PortfolioFundIdempotencyError("PENDING_RECONCILIATION");
  }

  const timestamp = new Date(nowMs).toISOString();
  const pending: PendingRecord = {
    version: 1,
    idempotencyKey: input.idempotencyKey,
    fingerprint: input.fingerprint,
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await storage.set({ [storageKey]: pending });

  let moneyMovementStarted = false;
  try {
    const result = await input.execute({
      markMoneyMovementStarted() {
        moneyMovementStarted = true;
      },
    });
    const completed: CompletedRecord = {
      ...pending,
      status: "completed",
      result,
      updatedAt: new Date(now()).toISOString(),
    };
    await storage.set({ [storageKey]: completed });
    try {
      await pruneCompletedRecords(storage, now());
    } catch {
      // Completion is already durable; pruning is best-effort.
    }
    return result;
  } catch (error) {
    if (!moneyMovementStarted || input.isSafeToRetryError?.(error) === true) {
      try {
        await storage.remove(storageKey);
      } catch {
        // Retaining pending fails closed if storage cleanup is unavailable.
      }
    }
    throw error;
  }
}
