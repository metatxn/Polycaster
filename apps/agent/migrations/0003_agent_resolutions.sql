CREATE TABLE IF NOT EXISTS agent_resolutions (
  token_id TEXT PRIMARY KEY,
  condition_id TEXT,
  market_slug TEXT,
  outcome_yes INTEGER NOT NULL,
  settlement_price TEXT,
  resolved_at TEXT NOT NULL,
  raw_source TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_resolutions_resolved_at
  ON agent_resolutions(resolved_at);
