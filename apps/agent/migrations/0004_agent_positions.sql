CREATE TABLE IF NOT EXISTS agent_positions (
  id TEXT PRIMARY KEY,
  watchlist_item_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'BUY',
  status TEXT NOT NULL DEFAULT 'OPEN',
  entry_price TEXT NOT NULL,
  shares TEXT NOT NULL,
  entry_notional_usd TEXT NOT NULL,
  exit_price TEXT,
  exit_notional_usd TEXT,
  realized_pnl_usd TEXT,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT,
  opened_run_id TEXT,
  closed_run_id TEXT,
  FOREIGN KEY (watchlist_item_id) REFERENCES agent_watchlist(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_positions_status
  ON agent_positions(status, opened_at);

CREATE INDEX IF NOT EXISTS idx_agent_positions_token_status
  ON agent_positions(token_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_positions_watchlist_item
  ON agent_positions(watchlist_item_id, status);
