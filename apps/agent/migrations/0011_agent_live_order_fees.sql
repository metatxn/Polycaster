-- Preflight ESTIMATE of the taker fee charged on top of filled notional for
-- BUY orders — the curve quote when metadata was readable, else the flat
-- FALLBACK_FEE_BPS reserve. Named an estimate because it is one: the CLOB
-- reports no fee on `POST /order`, and no fill/trade surface exists to read
-- the actual debit back. SELL fees come out of proceeds and stay '0' here.
ALTER TABLE agent_live_orders
  ADD COLUMN fee_estimate_usd TEXT NOT NULL DEFAULT '0';
