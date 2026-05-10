import Decimal from "decimal.js";
import type {
  AgentEvidencePack,
  AgentWatchlistItem,
  ModelVote,
  PaperFill,
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
  }>;
}

export interface AgentMetrics {
  runCount: number;
  tradeCount: number;
  holdCount: number;
  blockedCount: number;
  notionalUsd: string;
}

export interface AgentRepository {
  listWatchlist(): Promise<AgentWatchlistItem[]>;
  upsertWatchlistItem(
    item: Omit<AgentWatchlistItem, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    }
  ): Promise<AgentWatchlistItem>;
  createRun(): Promise<AgentRunSummary>;
  completeRun(id: string, status: AgentRunSummary["status"]): Promise<void>;
  saveRunItem(input: {
    runId: string;
    watchlistItem: AgentWatchlistItem;
    evidence: AgentEvidencePack;
    votes: ModelVote[];
    decision: QuorumDecision;
    fill: PaperFill | null;
  }): Promise<void>;
  listRuns(): Promise<AgentRunSummary[]>;
  getRun(id: string): Promise<AgentRunDetail | null>;
  getMetrics(): Promise<AgentMetrics>;
}

const memory = {
  watchlist: new Map<string, AgentWatchlistItem>(),
  runs: new Map<string, AgentRunDetail>(),
};

function decimal(value: string): Decimal {
  return new Decimal(value || "0");
}

function sumNotionalUsd(fills: PaperFill[]): string {
  return fills
    .filter((fill) => fill.status === "FILLED")
    .reduce((sum, fill) => sum.plus(decimal(fill.notionalUsd)), new Decimal(0))
    .toString();
}

function now(): string {
  return new Date().toISOString();
}

function countRun(detail: AgentRunDetail): AgentRunSummary {
  return {
    id: detail.id,
    status: detail.status,
    startedAt: detail.startedAt,
    completedAt: detail.completedAt,
    itemCount: detail.items.length,
    tradeCount: detail.items.filter((item) => item.fill?.status === "FILLED")
      .length,
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
    const existing = input.id ? memory.watchlist.get(input.id) : null;
    const item: AgentWatchlistItem = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    memory.watchlist.set(item.id, item);
    return item;
  }

  async createRun(): Promise<AgentRunSummary> {
    const run: AgentRunDetail = {
      id: crypto.randomUUID(),
      status: "RUNNING",
      startedAt: now(),
      completedAt: null,
      itemCount: 0,
      tradeCount: 0,
      blockedCount: 0,
      items: [],
    };
    memory.runs.set(run.id, run);
    return countRun(run);
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
    });
  }

  async listRuns(): Promise<AgentRunSummary[]> {
    return [...memory.runs.values()]
      .map(countRun)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getRun(id: string): Promise<AgentRunDetail | null> {
    return memory.runs.get(id) ?? null;
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
      tradeCount: fills.filter((fill) => fill.status === "FILLED").length,
      holdCount: runs
        .flatMap((run) => run.items)
        .filter((item) => item.decision.action === "HOLD").length,
      blockedCount: fills.filter((fill) => fill.status === "BLOCKED").length,
      notionalUsd: sumNotionalUsd(fills),
    };
  }
}

class D1AgentRepository extends MemoryAgentRepository {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly db: AgentD1Database) {
    super();
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= (async () => {
      await this.db
        .prepare(
          `CREATE TABLE IF NOT EXISTS agent_watchlist (
            id TEXT PRIMARY KEY,
            question TEXT NOT NULL,
            token_id TEXT NOT NULL,
            condition_id TEXT,
            market_slug TEXT,
            side TEXT NOT NULL DEFAULT 'YES',
            outcome_label TEXT,
            event_start_time TEXT,
            event_end_time TEXT,
            resolution_source TEXT,
            news_urls_json TEXT NOT NULL DEFAULT '[]',
            social_notes_json TEXT NOT NULL DEFAULT '[]',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )`
        )
        .run();
      await this.ensureWatchlistMetadataColumns();
      await this.db
        .prepare(
          "CREATE INDEX IF NOT EXISTS idx_agent_watchlist_active ON agent_watchlist(active, created_at)"
        )
        .run();
      await this.db
        .prepare(
          `CREATE TABLE IF NOT EXISTS agent_runs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT
          )`
        )
        .run();
      await this.db
        .prepare(
          "CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at)"
        )
        .run();
      await this.db
        .prepare(
          `CREATE TABLE IF NOT EXISTS agent_run_items (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            watchlist_item_id TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            votes_json TEXT NOT NULL,
            decision_json TEXT NOT NULL,
            fill_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
            FOREIGN KEY (watchlist_item_id) REFERENCES agent_watchlist(id)
          )`
        )
        .run();
      await this.db
        .prepare(
          "CREATE INDEX IF NOT EXISTS idx_agent_run_items_run_id ON agent_run_items(run_id, created_at)"
        )
        .run();
      await this.db
        .prepare(
          "CREATE INDEX IF NOT EXISTS idx_agent_run_items_watchlist_item_id ON agent_run_items(watchlist_item_id, created_at)"
        )
        .run();
    })();
    await this.schemaReady;
  }

  private async ensureWatchlistMetadataColumns(): Promise<void> {
    const existing = await this.db
      .prepare("PRAGMA table_info(agent_watchlist)")
      .all<{ name: string }>();
    const columns = new Set(existing.results.map((row) => row.name));
    for (const [column, definition] of [
      ["outcome_label", "TEXT"],
      ["event_start_time", "TEXT"],
      ["event_end_time", "TEXT"],
      ["resolution_source", "TEXT"],
    ] as const) {
      if (!columns.has(column)) {
        await this.db
          .prepare(
            `ALTER TABLE agent_watchlist ADD COLUMN ${column} ${definition}`
          )
          .run();
      }
    }
  }

  async listWatchlist(): Promise<AgentWatchlistItem[]> {
    await this.ensureSchema();
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
    await this.ensureSchema();
    const id = input.id ?? crypto.randomUUID();
    const existing = input.id
      ? await this.db
          .prepare("SELECT created_at FROM agent_watchlist WHERE id = ?")
          .bind(input.id)
          .first<{ created_at: string }>()
      : null;
    const createdAt = existing?.created_at ?? now();
    const updatedAt = now();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_watchlist
        (id, question, token_id, condition_id, market_slug, side, outcome_label, event_start_time, event_end_time, resolution_source, news_urls_json, social_notes_json, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.question,
        input.tokenId,
        input.conditionId ?? null,
        input.marketSlug ?? null,
        input.side ?? "YES",
        input.outcomeLabel ?? null,
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

  async createRun(): Promise<AgentRunSummary> {
    await this.ensureSchema();
    const run: AgentRunSummary = {
      id: crypto.randomUUID(),
      status: "RUNNING",
      startedAt: now(),
      completedAt: null,
      itemCount: 0,
      tradeCount: 0,
      blockedCount: 0,
    };
    await this.db
      .prepare(
        "INSERT INTO agent_runs (id, status, started_at, completed_at) VALUES (?, ?, ?, ?)"
      )
      .bind(run.id, run.status, run.startedAt, null)
      .run();
    return run;
  }

  async completeRun(
    id: string,
    status: AgentRunSummary["status"]
  ): Promise<void> {
    await this.ensureSchema();
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
    await this.ensureSchema();
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

  async listRuns(): Promise<AgentRunSummary[]> {
    await this.ensureSchema();
    const result = await this.db
      .prepare(
        `SELECT r.id, r.status, r.started_at, r.completed_at,
        COUNT(i.id) AS item_count,
        SUM(CASE WHEN json_extract(i.fill_json, '$.status') = 'FILLED' THEN 1 ELSE 0 END) AS trade_count,
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
    await this.ensureSchema();
    const run = await this.db
      .prepare("SELECT * FROM agent_runs WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!run) return null;
    const items = await this.db
      .prepare(
        `SELECT i.*, w.*
        FROM agent_run_items i
        JOIN agent_watchlist w ON w.id = i.watchlist_item_id
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
      })),
    };
    return { ...detail, ...countRun(detail) };
  }

  async getMetrics(): Promise<AgentMetrics> {
    await this.ensureSchema();
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
      tradeCount: fills.filter((fill) => fill.status === "FILLED").length,
      holdCount: decisions.filter((decision) => decision.action === "HOLD")
        .length,
      blockedCount: fills.filter((fill) => fill.status === "BLOCKED").length,
      notionalUsd: sumNotionalUsd(fills),
    };
  }
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
