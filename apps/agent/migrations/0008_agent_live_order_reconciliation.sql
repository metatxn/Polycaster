-- Live order lifecycle and reconciliation fields. These fields let the agent
-- distinguish posted/open/partial/final states and sync positions from actual
-- CLOB fill amounts instead of requested notional.
ALTER TABLE agent_live_orders
  ADD COLUMN filled_notional_usd TEXT NOT NULL DEFAULT '0';

ALTER TABLE agent_live_orders
  ADD COLUMN filled_shares TEXT NOT NULL DEFAULT '0';

ALTER TABLE agent_live_orders
  ADD COLUMN average_fill_price TEXT;

ALTER TABLE agent_live_orders
  ADD COLUMN last_synced_at TEXT;

ALTER TABLE agent_live_orders
  ADD COLUMN balance_snapshot_json TEXT;
