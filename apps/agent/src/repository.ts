import Decimal from "decimal.js";
import { isUnresolvedLiveOrder } from "./live-accounting.ts";
import type { AgentResolution } from "./resolutions.ts";
import { brierScore } from "./resolutions.ts";
import type {
  AgentAction,
  AgentClobCredentialRecord,
  AgentClobCredentialUpsert,
  AgentEvidencePack,
  AgentPosition,
  AgentWatchlistItem,
  LiveOrderRecord,
  LiveOrderStatus,
  LiveOrderUpsert,
  ModelVote,
  PaperFill,
  PositionCloseReason,
  QuorumDecision,
} from "./types.ts";

export interface AgentD1Result<T = Record<string, unknown>> {
  results: T[];
}

export interface AgentD1PreparedStatement {
  bind(...values: unknown[]): AgentD1PreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<AgentD1Result<T>>;
}

export interface AgentD1Database {
  prepare(query: string): AgentD1PreparedStatement;
}

export interface AgentRunSummary {
  id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  startedAt: string;
  completedAt: string | null;
  itemCount: number;
  tradeCount: number;
  blockedCount: number;
}

export interface AgentRunDetail extends AgentRunSummary {
  items: Array<{
    watchlistItem: AgentWatchlistItem;
    evidence: AgentEvidencePack;
    votes: ModelVote[];
    decision: QuorumDecision;
    fill: PaperFill | null;
    resolution: AgentResolution | null;
  }>;
}

export interface AgentMetrics {
  runCount: number;
  tradeCount: number;
  holdCount: number;
  blockedCount: number;
  notionalUsd: string;
}

export interface CalibrationModelStat {
  provider: string;
  brierMean: number;
  count: number;
}

export interface CalibrationSummary {
  models: CalibrationModelStat[];
  resolvedVoteCount: number;
}

export interface PortfolioPnl {
  openPositionCount: number;
  closedPositionCount: number;
  realizedPnlUsd: string;
  openEntryNotionalUsd: string;
}

export interface AgentSchedulerLock {
  lockKey: string;
  ownerId: string;
  lockedAt: string;
  expiresAt: string;
  updatedAt: string;
}

export interface AcquireSchedulerLockInput {
  lockKey: string;
  ownerId: string;
  now: string;
  leaseMs: number;
}

export interface OpenPositionInput {
  watchlistItemId: string;
  tokenId: string;
  entryPrice: string;
  shares: string;
  entryNotionalUsd: string;
  openedRunId: string | null;
}

export interface ClosePositionInput {
  exitPrice: string;
  closeReason: PositionCloseReason;
  closedRunId: string | null;
}

export interface ReducePositionInput {
  /** Shares sold in this (partial) exit. Clamped to the remaining shares. */
  soldShares: string;
  exitPrice: string;
  closeReason: PositionCloseReason;
  closedRunId: string | null;
}

export interface ApplySettledFeeToRunFillInput {
  runId: string;
  watchlistItemId: string;
  side: AgentAction;
  /** Preflight estimate the stored fill deducted from `cashAfterUsd`. */
  feeEstimateUsd: string;
  settledFeeUsd: string;
}

export interface AgentRepository {
  listWatchlist(): Promise<AgentWatchlistItem[]>;
  upsertWatchlistItem(
    item: Omit<AgentWatchlistItem, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    }
  ): Promise<AgentWatchlistItem>;
  createRun(id?: string, requestFingerprint?: string): Promise<AgentRunSummary>;
  getRunRequestFingerprint(id: string): Promise<string | null>;
  completeRun(id: string, status: AgentRunSummary["status"]): Promise<void>;
  saveRunItem(input: {
    runId: string;
    watchlistItem: AgentWatchlistItem;
    evidence: AgentEvidencePack;
    votes: ModelVote[];
    decision: QuorumDecision;
    fill: PaperFill | null;
  }): Promise<void>;
  /**
   * Overlay the ACTUAL settled BUY fee onto the persisted run-item fill once
   * late settlement reconciliation derives it. The fill was stored with the
   * preflight estimate baked into `cashAfterUsd`; this rewrites it to
   * `cashAfterUsd + feeEstimateUsd − settledFeeUsd` and stamps
   * `settledFeeUsd` on the fill, which doubles as the idempotency marker —
   * an already-corrected fill is left untouched.
   */
  applySettledFeeToRunFill(input: ApplySettledFeeToRunFillInput): Promise<void>;
  listRuns(): Promise<AgentRunSummary[]>;
  getRun(id: string): Promise<AgentRunDetail | null>;
  getMetrics(): Promise<AgentMetrics>;
  upsertResolution(resolution: AgentResolution): Promise<void>;
  getResolutionByTokenId(tokenId: string): Promise<AgentResolution | null>;
  listResolutions(): Promise<AgentResolution[]>;
  getCalibration(): Promise<CalibrationSummary>;
  openPosition(input: OpenPositionInput): Promise<AgentPosition>;
  closePosition(
    id: string,
    input: ClosePositionInput
  ): Promise<AgentPosition | null>;
  reducePosition(
    id: string,
    input: ReducePositionInput
  ): Promise<AgentPosition | null>;
  getOpenPositionByWatchlistItem(
    watchlistItemId: string
  ): Promise<AgentPosition | null>;
  listOpenPositionsByToken(tokenId: string): Promise<AgentPosition[]>;
  listPositions(): Promise<AgentPosition[]>;
  getPortfolioPnl(): Promise<PortfolioPnl>;
  upsertLiveOrder(record: LiveOrderUpsert): Promise<LiveOrderRecord>;
  getLiveOrderByIdempotencyKey(key: string): Promise<LiveOrderRecord | null>;
  listLiveOrders(): Promise<LiveOrderRecord[]>;
  hasUnresolvedLiveOrder(): Promise<boolean>;
  updateLiveOrderStatus(
    idempotencyKey: string,
    update: Partial<
      Pick<
        LiveOrderRecord,
        "status" | "orderId" | "submittedAt" | "filledAt" | "error"
      >
    >
  ): Promise<LiveOrderRecord | null>;
  getClobCredential(key: string): Promise<AgentClobCredentialRecord | null>;
  upsertClobCredential(
    record: AgentClobCredentialUpsert
  ): Promise<AgentClobCredentialRecord>;
  tryAcquireSchedulerLock(
    input: AcquireSchedulerLockInput
  ): Promise<AgentSchedulerLock | null>;
  renewSchedulerLock(
    lockKey: string,
    ownerId: string,
    now: string,
    leaseMs: number
  ): Promise<boolean>;
  releaseSchedulerLock(lockKey: string, ownerId: string): Promise<void>;
}

const memory = {
  watchlist: new Map<string, AgentWatchlistItem>(),
  runs: new Map<string, AgentRunDetail>(),
  runRequestFingerprints: new Map<string, string>(),
  resolutions: new Map<string, AgentResolution>(),
  positions: new Map<string, AgentPosition>(),
  liveOrders: new Map<string, LiveOrderRecord>(),
  clobCredentials: new Map<string, AgentClobCredentialRecord>(),
  schedulerLocks: new Map<string, AgentSchedulerLock>(),
};

// Long position only (v1): realized = shares * (exitPrice - entryPrice).
// Used for both full closes and partial reductions, so the caller passes the
// exact share count that was sold in this tranche.
function realizedTrancheUsd(
  shares: string,
  entryPrice: string,
  exitPrice: string
): Decimal {
  return new Decimal(shares).mul(new Decimal(exitPrice).sub(entryPrice));
}

function aggregatePortfolio(positions: AgentPosition[]): PortfolioPnl {
  let openCount = 0;
  let closedCount = 0;
  let realized = new Decimal(0);
  let openEntry = new Decimal(0);
  for (const position of positions) {
    if (position.status === "OPEN") {
      openCount += 1;
      openEntry = openEntry.add(position.entryNotionalUsd || "0");
    } else {
      closedCount += 1;
    }
    // Realized P&L is booked on both closed positions and partial reductions of
    // still-open positions, so it must be summed regardless of status.
    realized = realized.add(position.realizedPnlUsd ?? "0");
  }
  return {
    openPositionCount: openCount,
    closedPositionCount: closedCount,
    realizedPnlUsd: realized.toDecimalPlaces(6).toString(),
    openEntryNotionalUsd: openEntry.toDecimalPlaces(6).toString(),
  };
}

function aggregateCalibration(
  voteSamples: Array<{
    provider: string;
    fairProbability: number;
    outcomeYes: 0 | 1;
  }>
): CalibrationSummary {
  const accum = new Map<string, { sum: number; count: number }>();
  for (const sample of voteSamples) {
    const score = brierScore(sample.fairProbability, sample.outcomeYes);
    const bucket = accum.get(sample.provider) ?? { sum: 0, count: 0 };
    bucket.sum += score;
    bucket.count += 1;
    accum.set(sample.provider, bucket);
  }
  const models: CalibrationModelStat[] = [...accum.entries()]
    .map(([provider, bucket]) => ({
      provider,
      brierMean: bucket.count > 0 ? bucket.sum / bucket.count : 0,
      count: bucket.count,
    }))
    .sort((a, b) => a.brierMean - b.brierMean);
  return { models, resolvedVoteCount: voteSamples.length };
}

function decimal(value: string): Decimal {
  return new Decimal(value || "0");
}

// A fill that moved real shares: full OR partial. Used for trade counts and
// notional sums so partial fills are not silently dropped from metrics.
function isExecutedFillStatus(status: PaperFill["status"]): boolean {
  return status === "FILLED" || status === "PARTIALLY_FILLED";
}

function sumNotionalUsd(fills: PaperFill[]): string {
  return fills
    .filter((fill) => isExecutedFillStatus(fill.status))
    .reduce((sum, fill) => sum.plus(decimal(fill.notionalUsd)), new Decimal(0))
    .toString();
}

/**
 * Pure correction step shared by both repositories: swap the preflight fee
 * estimate baked into a stored fill's `cashAfterUsd` for the actual settled
 * fee. Returns null when the fill is not the executed order the fee belongs
 * to, or when it was already corrected (idempotency via the `settledFeeUsd`
 * marker).
 */
function settledFeeCorrectedFill(
  fill: PaperFill,
  input: ApplySettledFeeToRunFillInput
): PaperFill | null {
  if (fill.side !== input.side) return null;
  if (!isExecutedFillStatus(fill.status)) return null;
  if (fill.settledFeeUsd != null) return null;
  return {
    ...fill,
    settledFeeUsd: input.settledFeeUsd,
    cashAfterUsd: decimal(fill.cashAfterUsd)
      .plus(decimal(input.feeEstimateUsd))
      .minus(decimal(input.settledFeeUsd))
      .toDecimalPlaces(6)
      .toString(),
  };
}

function now(): string {
  return new Date().toISOString();
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function d1ChangeCount(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const meta = (result as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const changes = (meta as { changes?: unknown }).changes;
  return typeof changes === "number" ? changes : null;
}

function countRun(detail: AgentRunDetail): AgentRunSummary {
  return {
    id: detail.id,
    status: detail.status,
    startedAt: detail.startedAt,
    completedAt: detail.completedAt,
    itemCount: detail.items.length,
    tradeCount: detail.items.filter(
      (item) => !!item.fill && isExecutedFillStatus(item.fill.status)
    ).length,
    blockedCount: detail.items.filter((item) => item.fill?.status === "BLOCKED")
      .length,
  };
}

class MemoryAgentRepository implements AgentRepository {
  async listWatchlist(): Promise<AgentWatchlistItem[]> {
    return [...memory.watchlist.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  }

  async upsertWatchlistItem(
    input: Omit<AgentWatchlistItem, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    }
  ): Promise<AgentWatchlistItem> {
    const existing =
      (input.id ? memory.watchlist.get(input.id) : null) ??
      [...memory.watchlist.values()].find(
        (item) => item.tokenId === input.tokenId
      ) ??
      null;
    const item: AgentWatchlistItem = {
      ...input,
      id: input.id ?? existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    memory.watchlist.set(item.id, item);
    return item;
  }

  async createRun(
    id = crypto.randomUUID(),
    requestFingerprint?: string
  ): Promise<AgentRunSummary> {
    if (memory.runs.has(id)) {
      throw new Error(`Agent run already exists: ${id}`);
    }
    const run: AgentRunDetail = {
      id,
      status: "RUNNING",
      startedAt: now(),
      completedAt: null,
      itemCount: 0,
      tradeCount: 0,
      blockedCount: 0,
      items: [],
    };
    memory.runs.set(run.id, run);
    if (requestFingerprint) {
      memory.runRequestFingerprints.set(run.id, requestFingerprint);
    }
    return countRun(run);
  }

  async getRunRequestFingerprint(id: string): Promise<string | null> {
    return memory.runRequestFingerprints.get(id) ?? null;
  }

  async completeRun(
    id: string,
    status: AgentRunSummary["status"]
  ): Promise<void> {
    const run = memory.runs.get(id);
    if (!run) return;
    run.status = status;
    run.completedAt = now();
  }

  async saveRunItem(input: {
    runId: string;
    watchlistItem: AgentWatchlistItem;
    evidence: AgentEvidencePack;
    votes: ModelVote[];
    decision: QuorumDecision;
    fill: PaperFill | null;
  }): Promise<void> {
    const run = memory.runs.get(input.runId);
    if (!run) return;
    run.items.push({
      watchlistItem: input.watchlistItem,
      evidence: input.evidence,
      votes: input.votes,
      decision: input.decision,
      fill: input.fill,
      resolution: null,
    });
  }

  async applySettledFeeToRunFill(
    input: ApplySettledFeeToRunFillInput
  ): Promise<void> {
    const run = memory.runs.get(input.runId);
    if (!run) return;
    for (const item of run.items) {
      if (item.watchlistItem.id !== input.watchlistItemId || !item.fill) {
        continue;
      }
      const corrected = settledFeeCorrectedFill(item.fill, input);
      if (corrected) item.fill = corrected;
    }
  }

  async listRuns(): Promise<AgentRunSummary[]> {
    return [...memory.runs.values()]
      .map(countRun)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getRun(id: string): Promise<AgentRunDetail | null> {
    const run = memory.runs.get(id);
    if (!run) return null;
    // Overlay the latest resolution for each item so newly-resolved markets
    // surface without rewriting historical run rows.
    return {
      ...run,
      items: run.items.map((item) => ({
        ...item,
        resolution: memory.resolutions.get(item.watchlistItem.tokenId) ?? null,
      })),
    };
  }

  async getMetrics(): Promise<AgentMetrics> {
    const runs = [...memory.runs.values()];
    const fills = runs.flatMap((run) =>
      run.items
        .map((item) => item.fill)
        .filter((fill): fill is PaperFill => !!fill)
    );
    return {
      runCount: runs.length,
      tradeCount: fills.filter((fill) => isExecutedFillStatus(fill.status))
        .length,
      holdCount: runs
        .flatMap((run) => run.items)
        .filter((item) => item.decision.action === "HOLD").length,
      blockedCount: fills.filter((fill) => fill.status === "BLOCKED").length,
      notionalUsd: sumNotionalUsd(fills),
    };
  }

  async upsertResolution(resolution: AgentResolution): Promise<void> {
    memory.resolutions.set(resolution.tokenId, resolution);
  }

  async getResolutionByTokenId(
    tokenId: string
  ): Promise<AgentResolution | null> {
    return memory.resolutions.get(tokenId) ?? null;
  }

  async listResolutions(): Promise<AgentResolution[]> {
    return [...memory.resolutions.values()].sort((a, b) =>
      b.resolvedAt.localeCompare(a.resolvedAt)
    );
  }

  async getCalibration(): Promise<CalibrationSummary> {
    const samples: Array<{
      provider: string;
      fairProbability: number;
      outcomeYes: 0 | 1;
    }> = [];
    for (const run of memory.runs.values()) {
      for (const item of run.items) {
        const resolution = memory.resolutions.get(item.watchlistItem.tokenId);
        if (!resolution) continue;
        for (const vote of item.votes) {
          samples.push({
            provider: vote.provider,
            fairProbability: vote.fairProbability,
            outcomeYes: resolution.outcomeYes,
          });
        }
      }
    }
    return aggregateCalibration(samples);
  }

  async openPosition(input: OpenPositionInput): Promise<AgentPosition> {
    const position: AgentPosition = {
      id: crypto.randomUUID(),
      watchlistItemId: input.watchlistItemId,
      tokenId: input.tokenId,
      side: "BUY",
      status: "OPEN",
      entryPrice: input.entryPrice,
      shares: input.shares,
      entryNotionalUsd: input.entryNotionalUsd,
      exitPrice: null,
      exitNotionalUsd: null,
      realizedPnlUsd: null,
      openedAt: now(),
      closedAt: null,
      closeReason: null,
      openedRunId: input.openedRunId,
      closedRunId: null,
    };
    memory.positions.set(position.id, position);
    return position;
  }

  async closePosition(
    id: string,
    input: ClosePositionInput
  ): Promise<AgentPosition | null> {
    const existing = memory.positions.get(id);
    if (!existing || existing.status === "CLOSED") return existing ?? null;
    const exitNotional = new Decimal(existing.shares).mul(input.exitPrice);
    // Add this final tranche to any realized P&L already booked from earlier
    // partial reductions, so a partially-sold position closes with the correct
    // cumulative realized P&L.
    const realized = new Decimal(existing.realizedPnlUsd ?? "0").add(
      realizedTrancheUsd(existing.shares, existing.entryPrice, input.exitPrice)
    );
    const closed: AgentPosition = {
      ...existing,
      status: "CLOSED",
      exitPrice: input.exitPrice,
      exitNotionalUsd: exitNotional.toDecimalPlaces(6).toString(),
      realizedPnlUsd: realized.toDecimalPlaces(6).toString(),
      closedAt: now(),
      closeReason: input.closeReason,
      closedRunId: input.closedRunId,
    };
    memory.positions.set(id, closed);
    return closed;
  }

  async reducePosition(
    id: string,
    input: ReducePositionInput
  ): Promise<AgentPosition | null> {
    const existing = memory.positions.get(id);
    if (!existing || existing.status === "CLOSED") return existing ?? null;
    const soldShares = Decimal.min(
      new Decimal(input.soldShares),
      new Decimal(existing.shares)
    );
    const remainingShares = new Decimal(existing.shares).sub(soldShares);
    const realized = new Decimal(existing.realizedPnlUsd ?? "0").add(
      realizedTrancheUsd(
        soldShares.toString(),
        existing.entryPrice,
        input.exitPrice
      )
    );
    // Selling the whole remainder is a full close.
    if (remainingShares.lte(0)) {
      const closed: AgentPosition = {
        ...existing,
        status: "CLOSED",
        shares: "0",
        entryNotionalUsd: "0",
        exitPrice: input.exitPrice,
        exitNotionalUsd: soldShares
          .mul(input.exitPrice)
          .toDecimalPlaces(6)
          .toString(),
        realizedPnlUsd: realized.toDecimalPlaces(6).toString(),
        closedAt: now(),
        closeReason: input.closeReason,
        closedRunId: input.closedRunId,
      };
      memory.positions.set(id, closed);
      return closed;
    }
    // Keep the residual open with a proportionally reduced cost basis.
    const reduced: AgentPosition = {
      ...existing,
      shares: remainingShares.toDecimalPlaces(6).toString(),
      entryNotionalUsd: remainingShares
        .mul(existing.entryPrice)
        .toDecimalPlaces(6)
        .toString(),
      realizedPnlUsd: realized.toDecimalPlaces(6).toString(),
    };
    memory.positions.set(id, reduced);
    return reduced;
  }

  async getOpenPositionByWatchlistItem(
    watchlistItemId: string
  ): Promise<AgentPosition | null> {
    for (const position of memory.positions.values()) {
      if (
        position.watchlistItemId === watchlistItemId &&
        position.status === "OPEN"
      ) {
        return position;
      }
    }
    return null;
  }

  async listOpenPositionsByToken(tokenId: string): Promise<AgentPosition[]> {
    return [...memory.positions.values()].filter(
      (position) => position.tokenId === tokenId && position.status === "OPEN"
    );
  }

  async listPositions(): Promise<AgentPosition[]> {
    return [...memory.positions.values()].sort((a, b) =>
      b.openedAt.localeCompare(a.openedAt)
    );
  }

  async getPortfolioPnl(): Promise<PortfolioPnl> {
    return aggregatePortfolio([...memory.positions.values()]);
  }

  async upsertLiveOrder(input: LiveOrderUpsert): Promise<LiveOrderRecord> {
    const existing = memory.liveOrders.get(input.idempotencyKey);
    const record: LiveOrderRecord = {
      ...input,
      createdAt: input.createdAt ?? existing?.createdAt ?? now(),
      filledNotionalUsd:
        input.filledNotionalUsd ?? existing?.filledNotionalUsd ?? "0",
      filledShares: input.filledShares ?? existing?.filledShares ?? "0",
      feeEstimateUsd: input.feeEstimateUsd ?? existing?.feeEstimateUsd ?? "0",
      settledFeeUsd:
        input.settledFeeUsd !== undefined
          ? input.settledFeeUsd
          : (existing?.settledFeeUsd ?? null),
      averageFillPrice:
        input.averageFillPrice !== undefined
          ? input.averageFillPrice
          : (existing?.averageFillPrice ?? null),
      lastSyncedAt:
        input.lastSyncedAt !== undefined
          ? input.lastSyncedAt
          : (existing?.lastSyncedAt ?? null),
      balanceSnapshotJson:
        input.balanceSnapshotJson !== undefined
          ? input.balanceSnapshotJson
          : (existing?.balanceSnapshotJson ?? null),
    };
    memory.liveOrders.set(record.idempotencyKey, record);
    return record;
  }

  async getLiveOrderByIdempotencyKey(
    key: string
  ): Promise<LiveOrderRecord | null> {
    return memory.liveOrders.get(key) ?? null;
  }

  async listLiveOrders(): Promise<LiveOrderRecord[]> {
    return [...memory.liveOrders.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  async hasUnresolvedLiveOrder(): Promise<boolean> {
    return [...memory.liveOrders.values()].some(isUnresolvedLiveOrder);
  }

  async updateLiveOrderStatus(
    idempotencyKey: string,
    update: Partial<
      Pick<
        LiveOrderRecord,
        "status" | "orderId" | "submittedAt" | "filledAt" | "error"
      >
    >
  ): Promise<LiveOrderRecord | null> {
    const existing = memory.liveOrders.get(idempotencyKey);
    if (!existing) return null;
    const next: LiveOrderRecord = {
      ...existing,
      status: update.status ?? existing.status,
      orderId: update.orderId !== undefined ? update.orderId : existing.orderId,
      submittedAt:
        update.submittedAt !== undefined
          ? update.submittedAt
          : existing.submittedAt,
      filledAt:
        update.filledAt !== undefined ? update.filledAt : existing.filledAt,
      error: update.error !== undefined ? update.error : existing.error,
    };
    memory.liveOrders.set(idempotencyKey, next);
    return next;
  }

  async getClobCredential(
    key: string
  ): Promise<AgentClobCredentialRecord | null> {
    const existing = memory.clobCredentials.get(key);
    if (!existing) return null;
    const next = { ...existing, lastUsedAt: now() };
    memory.clobCredentials.set(key, next);
    return next;
  }

  async upsertClobCredential(
    input: AgentClobCredentialUpsert
  ): Promise<AgentClobCredentialRecord> {
    const existing = memory.clobCredentials.get(input.credentialKey);
    const record: AgentClobCredentialRecord = {
      ...input,
      createdAt: input.createdAt ?? existing?.createdAt ?? now(),
      updatedAt: input.updatedAt ?? now(),
      lastUsedAt: input.lastUsedAt ?? existing?.lastUsedAt ?? null,
    };
    memory.clobCredentials.set(record.credentialKey, record);
    return record;
  }

  async tryAcquireSchedulerLock(
    input: AcquireSchedulerLockInput
  ): Promise<AgentSchedulerLock | null> {
    const existing = memory.schedulerLocks.get(input.lockKey);
    if (existing && existing.expiresAt > input.now) return null;
    const record: AgentSchedulerLock = {
      lockKey: input.lockKey,
      ownerId: input.ownerId,
      lockedAt: input.now,
      expiresAt: addMs(input.now, input.leaseMs),
      updatedAt: input.now,
    };
    memory.schedulerLocks.set(input.lockKey, record);
    return record;
  }

  async renewSchedulerLock(
    lockKey: string,
    ownerId: string,
    renewedAt: string,
    leaseMs: number
  ): Promise<boolean> {
    const existing = memory.schedulerLocks.get(lockKey);
    if (existing?.ownerId !== ownerId || existing.expiresAt <= renewedAt) {
      return false;
    }
    memory.schedulerLocks.set(lockKey, {
      ...existing,
      expiresAt: addMs(renewedAt, leaseMs),
      updatedAt: renewedAt,
    });
    return true;
  }

  async releaseSchedulerLock(lockKey: string, ownerId: string): Promise<void> {
    const existing = memory.schedulerLocks.get(lockKey);
    if (existing?.ownerId === ownerId) {
      memory.schedulerLocks.delete(lockKey);
    }
  }
}

class D1AgentRepository extends MemoryAgentRepository {
  private readonly db: AgentD1Database;

  constructor(db: AgentD1Database) {
    super();
    this.db = db;
  }

  async listWatchlist(): Promise<AgentWatchlistItem[]> {
    const result = await this.db
      .prepare("SELECT * FROM agent_watchlist ORDER BY created_at ASC")
      .all<Record<string, unknown>>();
    return result.results.map(rowToWatchlistItem);
  }

  async upsertWatchlistItem(
    input: Omit<AgentWatchlistItem, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    }
  ): Promise<AgentWatchlistItem> {
    const existing = input.id
      ? await this.db
          .prepare("SELECT id, created_at FROM agent_watchlist WHERE id = ?")
          .bind(input.id)
          .first<{ id: string; created_at: string }>()
      : await this.db
          .prepare(
            "SELECT id, created_at FROM agent_watchlist WHERE token_id = ? ORDER BY created_at ASC LIMIT 1"
          )
          .bind(input.tokenId)
          .first<{ id: string; created_at: string }>();
    const id = input.id ?? existing?.id ?? crypto.randomUUID();
    const createdAt = existing?.created_at ?? now();
    const updatedAt = now();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_watchlist
        (id, question, token_id, condition_id, market_slug, side, outcome_label, market_type, event_type, outcomes_json, opposite_outcome_label, opposite_token_id, event_market_count, event_start_time, event_end_time, resolution_source, news_urls_json, social_notes_json, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.question,
        input.tokenId,
        input.conditionId ?? null,
        input.marketSlug ?? null,
        input.side ?? "YES",
        input.outcomeLabel ?? null,
        input.marketType ?? null,
        input.eventType ?? null,
        JSON.stringify(input.outcomes ?? []),
        input.oppositeOutcomeLabel ?? null,
        input.oppositeTokenId ?? null,
        input.eventMarketCount ?? null,
        input.eventStartTime ?? null,
        input.eventEndTime ?? null,
        input.resolutionSource ?? null,
        JSON.stringify(input.newsUrls),
        JSON.stringify(input.socialNotes),
        input.active ? 1 : 0,
        createdAt,
        updatedAt
      )
      .run();
    return { ...input, id, createdAt, updatedAt };
  }

  async createRun(
    id = crypto.randomUUID(),
    requestFingerprint?: string
  ): Promise<AgentRunSummary> {
    const run: AgentRunSummary = {
      id,
      status: "RUNNING",
      startedAt: now(),
      completedAt: null,
      itemCount: 0,
      tradeCount: 0,
      blockedCount: 0,
    };
    await this.db
      .prepare(
        "INSERT INTO agent_runs (id, status, started_at, completed_at, request_fingerprint) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(run.id, run.status, run.startedAt, null, requestFingerprint ?? null)
      .run();
    return run;
  }

  async getRunRequestFingerprint(id: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT request_fingerprint FROM agent_runs WHERE id = ?")
      .bind(id)
      .first<{ request_fingerprint: string | null }>();
    return row?.request_fingerprint ?? null;
  }

  async completeRun(
    id: string,
    status: AgentRunSummary["status"]
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ?"
      )
      .bind(status, now(), id)
      .run();
  }

  async saveRunItem(input: {
    runId: string;
    watchlistItem: AgentWatchlistItem;
    evidence: AgentEvidencePack;
    votes: ModelVote[];
    decision: QuorumDecision;
    fill: PaperFill | null;
  }): Promise<void> {
    const runItemId = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO agent_run_items
        (id, run_id, watchlist_item_id, evidence_json, votes_json, decision_json, fill_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        runItemId,
        input.runId,
        input.watchlistItem.id,
        JSON.stringify(input.evidence),
        JSON.stringify(input.votes),
        JSON.stringify(input.decision),
        input.fill ? JSON.stringify(input.fill) : null,
        now()
      )
      .run();
  }

  async applySettledFeeToRunFill(
    input: ApplySettledFeeToRunFillInput
  ): Promise<void> {
    const row = await this.db
      .prepare(
        `SELECT id, fill_json FROM agent_run_items
        WHERE run_id = ? AND watchlist_item_id = ? AND fill_json IS NOT NULL`
      )
      .bind(input.runId, input.watchlistItemId)
      .first<{ id: string; fill_json: string }>();
    if (!row?.fill_json) return;
    const corrected = settledFeeCorrectedFill(
      JSON.parse(String(row.fill_json)) as PaperFill,
      input
    );
    if (!corrected) return;
    await this.db
      .prepare("UPDATE agent_run_items SET fill_json = ? WHERE id = ?")
      .bind(JSON.stringify(corrected), row.id)
      .run();
  }

  async listRuns(): Promise<AgentRunSummary[]> {
    const result = await this.db
      .prepare(
        `SELECT r.id, r.status, r.started_at, r.completed_at,
        COUNT(i.id) AS item_count,
        SUM(CASE WHEN json_extract(i.fill_json, '$.status') IN ('FILLED', 'PARTIALLY_FILLED') THEN 1 ELSE 0 END) AS trade_count,
        SUM(CASE WHEN json_extract(i.fill_json, '$.status') = 'BLOCKED' THEN 1 ELSE 0 END) AS blocked_count
        FROM agent_runs r
        LEFT JOIN agent_run_items i ON i.run_id = r.id
        GROUP BY r.id
        ORDER BY r.started_at DESC
        LIMIT 100`
      )
      .all<Record<string, unknown>>();
    return result.results.map(rowToRunSummary);
  }

  async getRun(id: string): Promise<AgentRunDetail | null> {
    const run = await this.db
      .prepare("SELECT * FROM agent_runs WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!run) return null;
    const items = await this.db
      .prepare(
        `SELECT i.*, w.*,
          r.outcome_yes AS resolution_outcome_yes,
          r.settlement_price AS resolution_settlement_price,
          r.resolved_at AS resolution_resolved_at,
          r.condition_id AS resolution_condition_id,
          r.market_slug AS resolution_market_slug
        FROM agent_run_items i
        JOIN agent_watchlist w ON w.id = i.watchlist_item_id
        LEFT JOIN agent_resolutions r ON r.token_id = w.token_id
        WHERE i.run_id = ?
        ORDER BY i.created_at ASC`
      )
      .bind(id)
      .all<Record<string, unknown>>();
    const detail: AgentRunDetail = {
      ...rowToRunSummary({
        ...run,
        item_count: items.results.length,
        trade_count: 0,
        blocked_count: 0,
      }),
      items: items.results.map((row) => ({
        watchlistItem: rowToWatchlistItem(row),
        evidence: JSON.parse(String(row.evidence_json)) as AgentEvidencePack,
        votes: JSON.parse(String(row.votes_json)) as ModelVote[],
        decision: JSON.parse(String(row.decision_json)) as QuorumDecision,
        fill: row.fill_json
          ? (JSON.parse(String(row.fill_json)) as PaperFill)
          : null,
        resolution: rowToResolutionOrNull(row),
      })),
    };
    return { ...detail, ...countRun(detail) };
  }

  async getMetrics(): Promise<AgentMetrics> {
    const rows = await this.db
      .prepare(
        `SELECT decision_json, fill_json FROM agent_run_items ORDER BY created_at DESC LIMIT 500`
      )
      .all<Record<string, unknown>>();
    const decisions = rows.results.map(
      (row) => JSON.parse(String(row.decision_json)) as QuorumDecision
    );
    const fills = rows.results
      .map((row) =>
        row.fill_json ? (JSON.parse(String(row.fill_json)) as PaperFill) : null
      )
      .filter((fill): fill is PaperFill => !!fill);
    const runCount = await this.db
      .prepare("SELECT COUNT(*) AS count FROM agent_runs")
      .first<{ count: number }>();
    return {
      runCount: runCount?.count ?? 0,
      tradeCount: fills.filter((fill) => isExecutedFillStatus(fill.status))
        .length,
      holdCount: decisions.filter((decision) => decision.action === "HOLD")
        .length,
      blockedCount: fills.filter((fill) => fill.status === "BLOCKED").length,
      notionalUsd: sumNotionalUsd(fills),
    };
  }

  async upsertResolution(resolution: AgentResolution): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_resolutions
          (token_id, condition_id, market_slug, outcome_yes, settlement_price, resolved_at, raw_source)
          VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        resolution.tokenId,
        resolution.conditionId ?? null,
        resolution.marketSlug ?? null,
        resolution.outcomeYes,
        resolution.settlementPrice,
        resolution.resolvedAt,
        null
      )
      .run();
  }

  async getResolutionByTokenId(
    tokenId: string
  ): Promise<AgentResolution | null> {
    const row = await this.db
      .prepare("SELECT * FROM agent_resolutions WHERE token_id = ?")
      .bind(tokenId)
      .first<Record<string, unknown>>();
    return row ? rowToResolution(row) : null;
  }

  async listResolutions(): Promise<AgentResolution[]> {
    const result = await this.db
      .prepare(
        "SELECT * FROM agent_resolutions ORDER BY resolved_at DESC LIMIT 500"
      )
      .all<Record<string, unknown>>();
    return result.results.map(rowToResolution);
  }

  async openPosition(input: OpenPositionInput): Promise<AgentPosition> {
    const position: AgentPosition = {
      id: crypto.randomUUID(),
      watchlistItemId: input.watchlistItemId,
      tokenId: input.tokenId,
      side: "BUY",
      status: "OPEN",
      entryPrice: input.entryPrice,
      shares: input.shares,
      entryNotionalUsd: input.entryNotionalUsd,
      exitPrice: null,
      exitNotionalUsd: null,
      realizedPnlUsd: null,
      openedAt: now(),
      closedAt: null,
      closeReason: null,
      openedRunId: input.openedRunId,
      closedRunId: null,
    };
    await this.db
      .prepare(
        `INSERT INTO agent_positions
          (id, watchlist_item_id, token_id, side, status, entry_price, shares,
           entry_notional_usd, opened_at, opened_run_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        position.id,
        position.watchlistItemId,
        position.tokenId,
        position.side,
        position.status,
        position.entryPrice,
        position.shares,
        position.entryNotionalUsd,
        position.openedAt,
        position.openedRunId
      )
      .run();
    return position;
  }

  async closePosition(
    id: string,
    input: ClosePositionInput
  ): Promise<AgentPosition | null> {
    const existingRow = await this.db
      .prepare("SELECT * FROM agent_positions WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!existingRow) return null;
    const existing = rowToPosition(existingRow);
    if (existing.status === "CLOSED") return existing;
    const exitNotional = new Decimal(existing.shares)
      .mul(input.exitPrice)
      .toDecimalPlaces(6)
      .toString();
    // Add this final tranche to any realized P&L already booked from earlier
    // partial reductions (see reducePosition).
    const realized = new Decimal(existing.realizedPnlUsd ?? "0").add(
      realizedTrancheUsd(existing.shares, existing.entryPrice, input.exitPrice)
    );
    const closed: AgentPosition = {
      ...existing,
      status: "CLOSED",
      exitPrice: input.exitPrice,
      exitNotionalUsd: exitNotional,
      realizedPnlUsd: realized.toDecimalPlaces(6).toString(),
      closedAt: now(),
      closeReason: input.closeReason,
      closedRunId: input.closedRunId,
    };
    await this.db
      .prepare(
        `UPDATE agent_positions SET
          status = ?, exit_price = ?, exit_notional_usd = ?, realized_pnl_usd = ?,
          closed_at = ?, close_reason = ?, closed_run_id = ?
          WHERE id = ?`
      )
      .bind(
        closed.status,
        closed.exitPrice,
        closed.exitNotionalUsd,
        closed.realizedPnlUsd,
        closed.closedAt,
        closed.closeReason,
        closed.closedRunId,
        id
      )
      .run();
    return closed;
  }

  async reducePosition(
    id: string,
    input: ReducePositionInput
  ): Promise<AgentPosition | null> {
    const existingRow = await this.db
      .prepare("SELECT * FROM agent_positions WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!existingRow) return null;
    const existing = rowToPosition(existingRow);
    if (existing.status === "CLOSED") return existing;
    const soldShares = Decimal.min(
      new Decimal(input.soldShares),
      new Decimal(existing.shares)
    );
    const remainingShares = new Decimal(existing.shares).sub(soldShares);
    const realized = new Decimal(existing.realizedPnlUsd ?? "0").add(
      realizedTrancheUsd(
        soldShares.toString(),
        existing.entryPrice,
        input.exitPrice
      )
    );

    // Selling the whole remainder is a full close.
    if (remainingShares.lte(0)) {
      const closed: AgentPosition = {
        ...existing,
        status: "CLOSED",
        shares: "0",
        entryNotionalUsd: "0",
        exitPrice: input.exitPrice,
        exitNotionalUsd: soldShares
          .mul(input.exitPrice)
          .toDecimalPlaces(6)
          .toString(),
        realizedPnlUsd: realized.toDecimalPlaces(6).toString(),
        closedAt: now(),
        closeReason: input.closeReason,
        closedRunId: input.closedRunId,
      };
      await this.db
        .prepare(
          `UPDATE agent_positions SET
            status = ?, shares = ?, entry_notional_usd = ?, exit_price = ?,
            exit_notional_usd = ?, realized_pnl_usd = ?, closed_at = ?,
            close_reason = ?, closed_run_id = ?
            WHERE id = ?`
        )
        .bind(
          closed.status,
          closed.shares,
          closed.entryNotionalUsd,
          closed.exitPrice,
          closed.exitNotionalUsd,
          closed.realizedPnlUsd,
          closed.closedAt,
          closed.closeReason,
          closed.closedRunId,
          id
        )
        .run();
      return closed;
    }

    // Keep the residual open with a proportionally reduced cost basis.
    const reduced: AgentPosition = {
      ...existing,
      shares: remainingShares.toDecimalPlaces(6).toString(),
      entryNotionalUsd: remainingShares
        .mul(existing.entryPrice)
        .toDecimalPlaces(6)
        .toString(),
      realizedPnlUsd: realized.toDecimalPlaces(6).toString(),
    };
    await this.db
      .prepare(
        `UPDATE agent_positions SET
          shares = ?, entry_notional_usd = ?, realized_pnl_usd = ?
          WHERE id = ?`
      )
      .bind(
        reduced.shares,
        reduced.entryNotionalUsd,
        reduced.realizedPnlUsd,
        id
      )
      .run();
    return reduced;
  }

  async getOpenPositionByWatchlistItem(
    watchlistItemId: string
  ): Promise<AgentPosition | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM agent_positions WHERE watchlist_item_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1"
      )
      .bind(watchlistItemId)
      .first<Record<string, unknown>>();
    return row ? rowToPosition(row) : null;
  }

  async listOpenPositionsByToken(tokenId: string): Promise<AgentPosition[]> {
    const result = await this.db
      .prepare(
        "SELECT * FROM agent_positions WHERE token_id = ? AND status = 'OPEN' ORDER BY opened_at ASC"
      )
      .bind(tokenId)
      .all<Record<string, unknown>>();
    return result.results.map(rowToPosition);
  }

  async listPositions(): Promise<AgentPosition[]> {
    const result = await this.db
      .prepare(
        "SELECT * FROM agent_positions ORDER BY opened_at DESC LIMIT 500"
      )
      .all<Record<string, unknown>>();
    return result.results.map(rowToPosition);
  }

  async getPortfolioPnl(): Promise<PortfolioPnl> {
    const result = await this.db
      .prepare("SELECT * FROM agent_positions")
      .all<Record<string, unknown>>();
    return aggregatePortfolio(result.results.map(rowToPosition));
  }

  async upsertLiveOrder(input: LiveOrderUpsert): Promise<LiveOrderRecord> {
    const existing = await this.db
      .prepare("SELECT * FROM agent_live_orders WHERE idempotency_key = ?")
      .bind(input.idempotencyKey)
      .first<Record<string, unknown>>();
    const existingOrder = existing ? rowToLiveOrder(existing) : null;
    const record: LiveOrderRecord = {
      ...input,
      createdAt: input.createdAt ?? existingOrder?.createdAt ?? now(),
      filledNotionalUsd:
        input.filledNotionalUsd ?? existingOrder?.filledNotionalUsd ?? "0",
      filledShares: input.filledShares ?? existingOrder?.filledShares ?? "0",
      feeEstimateUsd:
        input.feeEstimateUsd ?? existingOrder?.feeEstimateUsd ?? "0",
      settledFeeUsd:
        input.settledFeeUsd !== undefined
          ? input.settledFeeUsd
          : (existingOrder?.settledFeeUsd ?? null),
      averageFillPrice:
        input.averageFillPrice !== undefined
          ? input.averageFillPrice
          : (existingOrder?.averageFillPrice ?? null),
      lastSyncedAt:
        input.lastSyncedAt !== undefined
          ? input.lastSyncedAt
          : (existingOrder?.lastSyncedAt ?? null),
      balanceSnapshotJson:
        input.balanceSnapshotJson !== undefined
          ? input.balanceSnapshotJson
          : (existingOrder?.balanceSnapshotJson ?? null),
    };
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_live_orders
          (idempotency_key, run_id, watchlist_item_id, token_id, side,
           requested_size_usd, price, signed_order_hash, order_id, status,
           submitted_at, filled_at, created_at, filled_notional_usd,
           filled_shares, fee_estimate_usd, settled_fee_usd,
           average_fill_price, last_synced_at, balance_snapshot_json,
           dry_run, error)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.idempotencyKey,
        record.runId,
        record.watchlistItemId,
        record.tokenId,
        record.side,
        record.requestedSizeUsd,
        record.price,
        record.signedOrderHash,
        record.orderId,
        record.status,
        record.submittedAt,
        record.filledAt,
        record.createdAt,
        record.filledNotionalUsd,
        record.filledShares,
        record.feeEstimateUsd,
        record.settledFeeUsd,
        record.averageFillPrice,
        record.lastSyncedAt,
        record.balanceSnapshotJson,
        record.dryRun ? 1 : 0,
        record.error
      )
      .run();
    return record;
  }

  async getLiveOrderByIdempotencyKey(
    key: string
  ): Promise<LiveOrderRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM agent_live_orders WHERE idempotency_key = ?")
      .bind(key)
      .first<Record<string, unknown>>();
    return row ? rowToLiveOrder(row) : null;
  }

  async listLiveOrders(): Promise<LiveOrderRecord[]> {
    const result = await this.db
      .prepare(
        "SELECT * FROM agent_live_orders ORDER BY created_at DESC LIMIT 200"
      )
      .all<Record<string, unknown>>();
    return result.results.map(rowToLiveOrder);
  }

  async hasUnresolvedLiveOrder(): Promise<boolean> {
    // SQL mirror of isUnresolvedLiveOrder in live-accounting.ts: keep the
    // two predicates in sync. The json_extract clause is the "carries a
    // pre-submission anchor" guard — it stops legacy rows written before
    // balance anchors existed from blocking live trading forever.
    const row = await this.db
      .prepare(
        `SELECT 1 AS unresolved FROM agent_live_orders
         WHERE dry_run = 0
           AND (
             status IN ('POSTED', 'UNKNOWN')
             OR (
               side = 'BUY'
               AND status IN ('FILLED', 'PARTIALLY_FILLED')
               AND settled_fee_usd IS NULL
               AND json_extract(balance_snapshot_json, '$.preSubmission')
                 IS NOT NULL
             )
           )
         LIMIT 1`
      )
      .first<{ unresolved: number }>();
    return row !== null;
  }

  async updateLiveOrderStatus(
    idempotencyKey: string,
    update: Partial<
      Pick<
        LiveOrderRecord,
        "status" | "orderId" | "submittedAt" | "filledAt" | "error"
      >
    >
  ): Promise<LiveOrderRecord | null> {
    const existing = await this.getLiveOrderByIdempotencyKey(idempotencyKey);
    if (!existing) return null;
    const next: LiveOrderRecord = {
      ...existing,
      status: update.status ?? existing.status,
      orderId: update.orderId !== undefined ? update.orderId : existing.orderId,
      submittedAt:
        update.submittedAt !== undefined
          ? update.submittedAt
          : existing.submittedAt,
      filledAt:
        update.filledAt !== undefined ? update.filledAt : existing.filledAt,
      error: update.error !== undefined ? update.error : existing.error,
    };
    await this.db
      .prepare(
        `UPDATE agent_live_orders SET
          status = ?, order_id = ?, submitted_at = ?, filled_at = ?, error = ?
          WHERE idempotency_key = ?`
      )
      .bind(
        next.status,
        next.orderId,
        next.submittedAt,
        next.filledAt,
        next.error,
        idempotencyKey
      )
      .run();
    return next;
  }

  async getClobCredential(
    key: string
  ): Promise<AgentClobCredentialRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM agent_clob_credentials WHERE credential_key = ?")
      .bind(key)
      .first<Record<string, unknown>>();
    if (!row) return null;
    const lastUsedAt = now();
    await this.db
      .prepare(
        "UPDATE agent_clob_credentials SET last_used_at = ? WHERE credential_key = ?"
      )
      .bind(lastUsedAt, key)
      .run();
    return rowToClobCredential({ ...row, last_used_at: lastUsedAt });
  }

  async upsertClobCredential(
    input: AgentClobCredentialUpsert
  ): Promise<AgentClobCredentialRecord> {
    const existing = await this.db
      .prepare(
        "SELECT created_at, last_used_at FROM agent_clob_credentials WHERE credential_key = ?"
      )
      .bind(input.credentialKey)
      .first<{ created_at: string; last_used_at: string | null }>();
    const record: AgentClobCredentialRecord = {
      ...input,
      createdAt: input.createdAt ?? existing?.created_at ?? now(),
      updatedAt: input.updatedAt ?? now(),
      lastUsedAt: input.lastUsedAt ?? existing?.last_used_at ?? null,
    };
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_clob_credentials
          (credential_key, clob_host, signer_address, funder_address,
           encrypted_credentials, encryption_key_version, created_at,
           updated_at, last_used_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.credentialKey,
        record.clobHost,
        record.signerAddress,
        record.funderAddress,
        record.encryptedCredentials,
        record.encryptionKeyVersion,
        record.createdAt,
        record.updatedAt,
        record.lastUsedAt
      )
      .run();
    return record;
  }

  async tryAcquireSchedulerLock(
    input: AcquireSchedulerLockInput
  ): Promise<AgentSchedulerLock | null> {
    const expiresAt = addMs(input.now, input.leaseMs);
    const result = await this.db
      .prepare(
        `INSERT INTO agent_scheduler_locks
          (lock_key, owner_id, locked_at, expires_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(lock_key) DO UPDATE SET
            owner_id = excluded.owner_id,
            locked_at = excluded.locked_at,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
          WHERE agent_scheduler_locks.expires_at <= ?`
      )
      .bind(
        input.lockKey,
        input.ownerId,
        input.now,
        expiresAt,
        input.now,
        input.now
      )
      .run();
    const changes = d1ChangeCount(result);
    if (changes === 0) return null;
    const row = await this.db
      .prepare("SELECT * FROM agent_scheduler_locks WHERE lock_key = ?")
      .bind(input.lockKey)
      .first<Record<string, unknown>>();
    if (!row || String(row.owner_id) !== input.ownerId) return null;
    return rowToSchedulerLock(row);
  }

  async renewSchedulerLock(
    lockKey: string,
    ownerId: string,
    renewedAt: string,
    leaseMs: number
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE agent_scheduler_locks
         SET expires_at = ?, updated_at = ?
         WHERE lock_key = ? AND owner_id = ? AND expires_at > ?`
      )
      .bind(addMs(renewedAt, leaseMs), renewedAt, lockKey, ownerId, renewedAt)
      .run();
    return (d1ChangeCount(result) ?? 0) > 0;
  }

  async releaseSchedulerLock(lockKey: string, ownerId: string): Promise<void> {
    await this.db
      .prepare(
        "DELETE FROM agent_scheduler_locks WHERE lock_key = ? AND owner_id = ?"
      )
      .bind(lockKey, ownerId)
      .run();
  }

  async getCalibration(): Promise<CalibrationSummary> {
    const rows = await this.db
      .prepare(
        `SELECT i.votes_json, r.outcome_yes
          FROM agent_run_items i
          JOIN agent_watchlist w ON w.id = i.watchlist_item_id
          JOIN agent_resolutions r ON r.token_id = w.token_id`
      )
      .all<{ votes_json: string; outcome_yes: number }>();
    const samples: Array<{
      provider: string;
      fairProbability: number;
      outcomeYes: 0 | 1;
    }> = [];
    for (const row of rows.results) {
      const outcomeYes: 0 | 1 = Number(row.outcome_yes) === 1 ? 1 : 0;
      let votes: ModelVote[];
      try {
        votes = JSON.parse(String(row.votes_json)) as ModelVote[];
      } catch {
        continue;
      }
      for (const vote of votes) {
        samples.push({
          provider: vote.provider,
          fairProbability: vote.fairProbability,
          outcomeYes,
        });
      }
    }
    return aggregateCalibration(samples);
  }
}

function rowToLiveOrder(row: Record<string, unknown>): LiveOrderRecord {
  const rawSide = String(row.side);
  const side: AgentAction =
    rawSide === "BUY" || rawSide === "SELL" || rawSide === "HOLD"
      ? rawSide
      : "HOLD";
  const rawStatus = String(row.status);
  const status: LiveOrderStatus =
    rawStatus === "DRY_RUN" ||
    rawStatus === "POSTED" ||
    rawStatus === "UNKNOWN" ||
    rawStatus === "OPEN" ||
    rawStatus === "PARTIALLY_FILLED" ||
    rawStatus === "FILLED" ||
    rawStatus === "CANCELED" ||
    rawStatus === "FAILED"
      ? rawStatus
      : "FAILED";
  return {
    idempotencyKey: String(row.idempotency_key),
    runId: String(row.run_id),
    watchlistItemId: String(row.watchlist_item_id),
    tokenId: String(row.token_id),
    side,
    requestedSizeUsd: String(row.requested_size_usd),
    price: String(row.price),
    signedOrderHash: row.signed_order_hash
      ? String(row.signed_order_hash)
      : null,
    orderId: row.order_id ? String(row.order_id) : null,
    status,
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    filledAt: row.filled_at ? String(row.filled_at) : null,
    createdAt: String(row.created_at),
    filledNotionalUsd: String(row.filled_notional_usd ?? "0"),
    filledShares: String(row.filled_shares ?? "0"),
    feeEstimateUsd: String(row.fee_estimate_usd ?? "0"),
    // != null (not truthiness): "0" is a legitimate settled fee.
    settledFeeUsd:
      row.settled_fee_usd != null ? String(row.settled_fee_usd) : null,
    averageFillPrice: row.average_fill_price
      ? String(row.average_fill_price)
      : null,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    balanceSnapshotJson: row.balance_snapshot_json
      ? String(row.balance_snapshot_json)
      : null,
    dryRun: Number(row.dry_run) === 1,
    error: row.error ? String(row.error) : null,
  };
}

function rowToClobCredential(
  row: Record<string, unknown>
): AgentClobCredentialRecord {
  return {
    credentialKey: String(row.credential_key),
    clobHost: String(row.clob_host),
    signerAddress: String(row.signer_address),
    funderAddress: String(row.funder_address),
    encryptedCredentials: String(row.encrypted_credentials),
    encryptionKeyVersion: String(row.encryption_key_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
  };
}

function rowToSchedulerLock(row: Record<string, unknown>): AgentSchedulerLock {
  return {
    lockKey: String(row.lock_key),
    ownerId: String(row.owner_id),
    lockedAt: String(row.locked_at),
    expiresAt: String(row.expires_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToPosition(row: Record<string, unknown>): AgentPosition {
  const status = String(row.status) === "CLOSED" ? "CLOSED" : "OPEN";
  const closeReasonRaw = row.close_reason ? String(row.close_reason) : null;
  const closeReason: PositionCloseReason | null =
    closeReasonRaw === "contradict-vote" ||
    closeReasonRaw === "time-exit" ||
    closeReasonRaw === "resolution" ||
    closeReasonRaw === "manual"
      ? closeReasonRaw
      : null;
  return {
    id: String(row.id),
    watchlistItemId: String(row.watchlist_item_id),
    tokenId: String(row.token_id),
    side: "BUY",
    status,
    entryPrice: String(row.entry_price),
    shares: String(row.shares),
    entryNotionalUsd: String(row.entry_notional_usd),
    exitPrice: row.exit_price ? String(row.exit_price) : null,
    exitNotionalUsd: row.exit_notional_usd
      ? String(row.exit_notional_usd)
      : null,
    realizedPnlUsd: row.realized_pnl_usd ? String(row.realized_pnl_usd) : null,
    openedAt: String(row.opened_at),
    closedAt: row.closed_at ? String(row.closed_at) : null,
    closeReason,
    openedRunId: row.opened_run_id ? String(row.opened_run_id) : null,
    closedRunId: row.closed_run_id ? String(row.closed_run_id) : null,
  };
}

function rowToResolution(row: Record<string, unknown>): AgentResolution {
  return {
    tokenId: String(row.token_id),
    conditionId: row.condition_id ? String(row.condition_id) : undefined,
    marketSlug: row.market_slug ? String(row.market_slug) : undefined,
    outcomeYes: Number(row.outcome_yes) === 1 ? 1 : 0,
    settlementPrice: String(row.settlement_price ?? ""),
    resolvedAt: String(row.resolved_at),
  };
}

function rowToResolutionOrNull(
  row: Record<string, unknown>
): AgentResolution | null {
  const resolvedAt = row.resolution_resolved_at;
  if (!resolvedAt) return null;
  return {
    tokenId: String(row.token_id),
    conditionId: row.resolution_condition_id
      ? String(row.resolution_condition_id)
      : undefined,
    marketSlug: row.resolution_market_slug
      ? String(row.resolution_market_slug)
      : undefined,
    outcomeYes: Number(row.resolution_outcome_yes) === 1 ? 1 : 0,
    settlementPrice: String(row.resolution_settlement_price ?? ""),
    resolvedAt: String(resolvedAt),
  };
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToWatchlistItem(row: Record<string, unknown>): AgentWatchlistItem {
  return {
    id: String(row.id),
    question: String(row.question),
    tokenId: String(row.token_id),
    conditionId: row.condition_id ? String(row.condition_id) : undefined,
    marketSlug: row.market_slug ? String(row.market_slug) : undefined,
    side: row.side === "NO" ? "NO" : "YES",
    outcomeLabel: row.outcome_label ? String(row.outcome_label) : undefined,
    marketType:
      row.market_type === "binary" || row.market_type === "multi_outcome"
        ? row.market_type
        : row.market_type === "unknown"
          ? "unknown"
          : undefined,
    eventType:
      row.event_type === "single_market" || row.event_type === "multi_market"
        ? row.event_type
        : row.event_type === "unknown"
          ? "unknown"
          : undefined,
    outcomes: parseJsonArray(row.outcomes_json),
    oppositeOutcomeLabel: row.opposite_outcome_label
      ? String(row.opposite_outcome_label)
      : undefined,
    oppositeTokenId: row.opposite_token_id
      ? String(row.opposite_token_id)
      : undefined,
    eventMarketCount:
      row.event_market_count === null || row.event_market_count === undefined
        ? undefined
        : Number(row.event_market_count),
    eventStartTime: row.event_start_time
      ? String(row.event_start_time)
      : undefined,
    eventEndTime: row.event_end_time ? String(row.event_end_time) : undefined,
    resolutionSource: row.resolution_source
      ? String(row.resolution_source)
      : undefined,
    newsUrls: parseJsonArray(row.news_urls_json),
    socialNotes: parseJsonArray(row.social_notes_json),
    active: Number(row.active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToRunSummary(row: Record<string, unknown>): AgentRunSummary {
  return {
    id: String(row.id),
    status:
      row.status === "FAILED" || row.status === "COMPLETED"
        ? row.status
        : "RUNNING",
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    itemCount: Number(row.item_count ?? 0),
    tradeCount: Number(row.trade_count ?? 0),
    blockedCount: Number(row.blocked_count ?? 0),
  };
}

export function createAgentRepository(db?: AgentD1Database): AgentRepository {
  return db ? new D1AgentRepository(db) : new MemoryAgentRepository();
}
