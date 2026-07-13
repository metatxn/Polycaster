-- One-time compatibility bridge for databases created by the retired
-- request-time ensureSchema() path. Mark migrations as adopted only when the
-- complete schema those migrations produce is already present. Fresh and
-- partial databases remain unmarked so Wrangler applies (or safely rejects)
-- the normal versioned migration sequence.
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

WITH
  schema_ready(ready) AS (
    SELECT
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'agent_watchlist', 'agent_runs', 'agent_run_items',
            'agent_resolutions', 'agent_positions', 'agent_live_orders',
            'agent_clob_credentials', 'agent_scheduler_locks'
          )) = 8
      AND
      (SELECT COUNT(*) FROM pragma_table_info('agent_watchlist')
        WHERE name IN (
          'outcome_label', 'event_start_time', 'event_end_time',
          'resolution_source', 'market_type', 'event_type', 'outcomes_json',
          'opposite_outcome_label', 'opposite_token_id', 'event_market_count'
        )) = 10
      AND
      (SELECT COUNT(*) FROM pragma_table_info('agent_live_orders')
        WHERE name IN (
          'filled_notional_usd', 'filled_shares', 'average_fill_price',
          'last_synced_at', 'balance_snapshot_json'
        )) = 5
      AND
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'index'
          AND name IN (
            'idx_agent_watchlist_active', 'idx_agent_runs_started_at',
            'idx_agent_run_items_run_id',
            'idx_agent_run_items_watchlist_item_id',
            'idx_agent_resolutions_resolved_at',
            'idx_agent_positions_status',
            'idx_agent_positions_token_status',
            'idx_agent_positions_watchlist_item',
            'idx_agent_live_orders_created_at',
            'idx_agent_live_orders_status',
            'idx_agent_clob_credentials_updated_at',
            'idx_agent_scheduler_locks_expires_at'
          )) = 12
  ),
  expected_migrations(name) AS (
    VALUES
      ('0001_agent_paper_trading.sql'),
      ('0002_watchlist_market_metadata.sql'),
      ('0003_agent_resolutions.sql'),
      ('0004_agent_positions.sql'),
      ('0005_agent_live_orders.sql'),
      ('0006_watchlist_market_shape.sql'),
      ('0007_agent_clob_credentials.sql'),
      ('0008_agent_live_order_reconciliation.sql'),
      ('0009_agent_scheduler_locks.sql')
  )
INSERT OR IGNORE INTO d1_migrations (name)
SELECT expected_migrations.name
FROM expected_migrations, schema_ready
WHERE schema_ready.ready;

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0010_agent_run_request_fingerprint.sql'
WHERE EXISTS (
  SELECT 1
  FROM pragma_table_info('agent_runs')
  WHERE name = 'request_fingerprint'
)
AND (
  SELECT COUNT(*)
  FROM d1_migrations
  WHERE name IN (
    '0001_agent_paper_trading.sql',
    '0002_watchlist_market_metadata.sql',
    '0003_agent_resolutions.sql',
    '0004_agent_positions.sql',
    '0005_agent_live_orders.sql',
    '0006_watchlist_market_shape.sql',
    '0007_agent_clob_credentials.sql',
    '0008_agent_live_order_reconciliation.sql',
    '0009_agent_scheduler_locks.sql'
  )
) = 9;
