-- Actual settled taker fee for real BUY orders, in USD, derived from the
-- on-chain balance delta once V2 settlement was observed:
--   settled_fee = pre-submission pUSD - settled pUSD - filled notional.
-- NULL = settlement not yet observed. A real filled BUY that carries a
-- pre-submission balance anchor but no settled fee is treated as unresolved
-- and blocks further live orders until a later run (or manual resolution)
-- reconciles it. fee_estimate_usd keeps the preflight estimate untouched so
-- the two numbers stay comparable after the fact.
ALTER TABLE agent_live_orders
  ADD COLUMN settled_fee_usd TEXT;
