CREATE TABLE IF NOT EXISTS agent_scheduler_locks (
  lock_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  locked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_scheduler_locks_expires_at
  ON agent_scheduler_locks(expires_at);
