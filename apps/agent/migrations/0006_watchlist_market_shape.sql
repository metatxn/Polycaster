ALTER TABLE agent_watchlist ADD COLUMN market_type TEXT;
ALTER TABLE agent_watchlist ADD COLUMN event_type TEXT;
ALTER TABLE agent_watchlist ADD COLUMN outcomes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_watchlist ADD COLUMN opposite_outcome_label TEXT;
ALTER TABLE agent_watchlist ADD COLUMN opposite_token_id TEXT;
ALTER TABLE agent_watchlist ADD COLUMN event_market_count INTEGER;
