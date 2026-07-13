import { logWarn } from "@knoww/logger";
import {
  fingerprintPortfolioFundIntent,
  isPortfolioFundIdempotencyKey,
  type PortfolioFundIntentInput,
} from "../types/portfolio-fund-intent";

const STORAGE_PREFIX = "knoww_portfolio_fund_attempt_";
const TERMINAL_RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TERMINAL_RECORDS = 50;

export type PortfolioFundAttemptPhase =
  | "none"
  | "submitted"
  | "credited"
  | "reverted";

export interface StoredFundAttempt {
  attemptId: string;
  idempotencyKey: string;
  fingerprint: string;
  txHash: string | null;
  phase: PortfolioFundAttemptPhase;
}

export interface PortfolioFundAttemptStorage {
  get(key: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface PortfolioFundAttemptStore {
  begin(input: PortfolioFundIntentInput): Promise<StoredFundAttempt>;
  /**
   * Updates are bound to the attempt's identity: `expectedIdempotencyKey`
   * must match the key `begin` allocated for this attemptId, or the update
   * no-ops. A caller holding a mismatched (attemptId, idempotencyKey) pair
   * must never corrupt or terminalize another attempt.
   */
  recordExecution(
    attemptId: string,
    txHash: string,
    expectedIdempotencyKey: string
  ): Promise<void>;
  complete(
    attemptId: string,
    outcome: "credited" | "reverted",
    expectedIdempotencyKey: string
  ): Promise<void>;
}

interface PersistedFundAttemptRecord {
  version: 1;
  attemptId: string;
  idempotencyKey: string;
  fingerprint: string;
  txHash: string | null;
  phase: PortfolioFundAttemptPhase;
  createdAt: string;
  updatedAt: string;
}

export function portfolioFundAttemptStorageKey(attemptId: string): string {
  return `${STORAGE_PREFIX}${attemptId}`;
}

function isTerminalPhase(phase: PortfolioFundAttemptPhase): boolean {
  return phase === "credited" || phase === "reverted";
}

function isPersistedFundAttemptRecord(
  value: unknown
): value is PersistedFundAttemptRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedFundAttemptRecord>;
  return (
    record.version === 1 &&
    typeof record.attemptId === "string" &&
    isPortfolioFundIdempotencyKey(record.idempotencyKey) &&
    typeof record.fingerprint === "string" &&
    (record.txHash === null || typeof record.txHash === "string") &&
    (record.phase === "none" ||
      record.phase === "submitted" ||
      record.phase === "credited" ||
      record.phase === "reverted") &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

function toStoredAttempt(
  record: PersistedFundAttemptRecord
): StoredFundAttempt {
  return {
    attemptId: record.attemptId,
    idempotencyKey: record.idempotencyKey,
    fingerprint: record.fingerprint,
    txHash: record.txHash,
    phase: record.phase,
  };
}

async function pruneTerminalRecords(
  storage: PortfolioFundAttemptStorage,
  nowMs: number
): Promise<void> {
  const values = await storage.get(null);
  const terminal = Object.entries(values)
    .filter(
      ([key, value]) =>
        key.startsWith(STORAGE_PREFIX) &&
        isPersistedFundAttemptRecord(value) &&
        isTerminalPhase(value.phase)
    )
    .map(([key, value]) => ({
      key,
      record: value as PersistedFundAttemptRecord,
    }))
    .sort(
      (left, right) =>
        Date.parse(right.record.updatedAt) - Date.parse(left.record.updatedAt)
    );
  const keysToRemove = terminal.flatMap(({ key, record }, index) => {
    const updatedAt = Date.parse(record.updatedAt);
    const expired =
      !Number.isFinite(updatedAt) || nowMs - updatedAt > TERMINAL_RECORD_TTL_MS;
    return expired || index >= MAX_TERMINAL_RECORDS ? [key] : [];
  });
  if (keysToRemove.length > 0) await storage.remove(keysToRemove);
}

/**
 * Background-owned authority over in-flight portfolio funding attempts.
 *
 * `begin` is idempotent per normalized intent fingerprint: it resumes the
 * same non-terminal attempt (same idempotencyKey, recorded txHash) until
 * `complete` retires it with a terminal outcome, at which point the next
 * `begin` for the same fingerprint allocates a fresh attempt. This lets a
 * retry after an ambiguous outcome (timeout post-submission, tab reload)
 * resume instead of re-submitting money.
 *
 * `begin` is serialized through an in-memory queue because it scans all
 * records for a fingerprint match before allocating — the background
 * service worker is the single writer, so this queue is sufficient (no
 * cross-context lock is needed).
 */
export function createPortfolioFundAttemptStore(
  storage: PortfolioFundAttemptStorage,
  now: () => number = () => Date.now(),
  randomUuid: () => string = () => crypto.randomUUID()
): PortfolioFundAttemptStore {
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<Result>(task: () => Promise<Result>): Promise<Result> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function readRecord(
    attemptId: string
  ): Promise<PersistedFundAttemptRecord | null> {
    const storageKey = portfolioFundAttemptStorageKey(attemptId);
    const values = await storage.get(storageKey);
    const existing = values[storageKey];
    return isPersistedFundAttemptRecord(existing) ? existing : null;
  }

  return {
    begin(input) {
      return enqueue(async () => {
        const nowMs = now();
        await pruneTerminalRecords(storage, nowMs);
        const fingerprint = fingerprintPortfolioFundIntent(input);

        const allRecords = await storage.get(null);
        const existing = Object.entries(allRecords).find(
          ([key, candidate]) =>
            key.startsWith(STORAGE_PREFIX) &&
            isPersistedFundAttemptRecord(candidate) &&
            candidate.fingerprint === fingerprint &&
            !isTerminalPhase(candidate.phase)
        )?.[1] as PersistedFundAttemptRecord | undefined;
        if (existing) return toStoredAttempt(existing);

        const attemptId = randomUuid();
        const idempotencyKey = randomUuid();
        if (!isPortfolioFundIdempotencyKey(idempotencyKey)) {
          throw new Error(
            "Generated an invalid portfolio fund idempotency key"
          );
        }
        const timestamp = new Date(nowMs).toISOString();
        const record: PersistedFundAttemptRecord = {
          version: 1,
          attemptId,
          idempotencyKey,
          fingerprint,
          txHash: null,
          phase: "none",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await storage.set({
          [portfolioFundAttemptStorageKey(attemptId)]: record,
        });
        return toStoredAttempt(record);
      });
    },

    recordExecution(attemptId, txHash, expectedIdempotencyKey) {
      return enqueue(async () => {
        const existing = await readRecord(attemptId);
        if (!existing) {
          // No-op: the attempt may have been pruned, or the caller passed a
          // stale id. Never create a record here — only `begin` allocates.
          logWarn("portfolio.fund.attempt.record_execution_unknown", {
            attemptId,
          });
          return;
        }
        if (existing.idempotencyKey !== expectedIdempotencyKey) {
          // No-op: the caller's identity does not match the attempt it is
          // trying to update — a crossed-wires bug must not overwrite another
          // attempt's txHash/phase.
          logWarn("portfolio.fund.attempt.record_execution_key_mismatch", {
            attemptId,
          });
          return;
        }
        if (isTerminalPhase(existing.phase)) {
          // No-op: a terminal attempt must never be un-terminalized. A lost
          // sendResponse + client retry can re-resolve the same deposit via
          // the coordinator's replay path and re-invoke recordExecution;
          // flipping credited/reverted back to "submitted" would make
          // `begin` wrongly resume a settled attempt.
          logWarn("portfolio.fund.attempt.record_execution_after_terminal", {
            attemptId,
            phase: existing.phase,
          });
          return;
        }
        const updated: PersistedFundAttemptRecord = {
          ...existing,
          txHash,
          phase: "submitted",
          updatedAt: new Date(now()).toISOString(),
        };
        await storage.set({
          [portfolioFundAttemptStorageKey(attemptId)]: updated,
        });
      });
    },

    complete(attemptId, outcome, expectedIdempotencyKey) {
      return enqueue(async () => {
        const existing = await readRecord(attemptId);
        if (!existing) {
          // No-op, consistent with recordExecution: a duplicate COMPLETE
          // message after pruning must stay non-fatal.
          logWarn("portfolio.fund.attempt.complete_unknown", {
            attemptId,
            outcome,
          });
          return;
        }
        if (existing.idempotencyKey !== expectedIdempotencyKey) {
          // No-op: a mismatched caller must never terminalize another attempt.
          logWarn("portfolio.fund.attempt.complete_key_mismatch", {
            attemptId,
            outcome,
          });
          return;
        }
        if (isTerminalPhase(existing.phase)) {
          // No-op: the first terminal outcome wins; never overwrite it.
          logWarn("portfolio.fund.attempt.complete_after_terminal", {
            attemptId,
            phase: existing.phase,
            outcome,
          });
          return;
        }
        const updated: PersistedFundAttemptRecord = {
          ...existing,
          phase: outcome,
          updatedAt: new Date(now()).toISOString(),
        };
        await storage.set({
          [portfolioFundAttemptStorageKey(attemptId)]: updated,
        });
        try {
          await pruneTerminalRecords(storage, now());
        } catch {
          // The terminal transition is already durable; pruning is best-effort.
        }
      });
    },
  };
}
