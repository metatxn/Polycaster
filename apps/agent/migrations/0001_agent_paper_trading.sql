CREATE TABLE IF NOT EXISTS agent_watchlist (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  token_id TEXT NOT NULL,
  condition_id TEXT,
  market_slug TEXT,
  side TEXT NOT NULL DEFAULT 'YES',
  news_urls_json TEXT NOT NULL DEFAULT '[]',
  social_notes_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_watchlist_active
  ON agent_watchlist(active, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at
  ON agent_runs(started_at);

CREATE TABLE IF NOT EXISTS agent_run_items (
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
);

CREATE INDEX IF NOT EXISTS idx_agent_run_items_run_id
  ON agent_run_items(run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_run_items_watchlist_item_id
  ON agent_run_items(watchlist_item_id, created_at);
