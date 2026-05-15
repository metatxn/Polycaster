-- Audit trail for live-mode order submissions (including dry-run signings).
-- Idempotency key = (run_id, watchlist_item_id, side) so a retried run on the
-- same watchlist item won't double-submit, regardless of mode.
CREATE TABLE IF NOT EXISTS agent_live_orders (
  idempotency_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  watchlist_item_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  side TEXT NOT NULL,
  requested_size_usd TEXT NOT NULL,
  price TEXT NOT NULL,
  -- SHA-256 digest of the EIP-712 signed-order JSON. We deliberately do NOT
  -- persist the signed payload itself: it is a bearer credential that anyone
  -- with read access (DB, admin API, dashboard) could replay against the CLOB
  -- and bypass the dry-run gate. The digest is sufficient for after-the-fact
  -- "did we sign exactly this order?" verification.
  signed_order_hash TEXT,
  order_id TEXT,
  status TEXT NOT NULL,
  submitted_at TEXT,
  filled_at TEXT,
  created_at TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 1,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_live_orders_created_at
  ON agent_live_orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_live_orders_status
  ON agent_live_orders(status, created_at DESC);
