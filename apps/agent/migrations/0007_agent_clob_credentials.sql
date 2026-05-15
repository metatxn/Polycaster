-- Encrypted Polymarket CLOB API credentials for agent live trading.
-- The plaintext key/secret/passphrase are never persisted; this stores only
-- an AES-GCM payload encrypted with AGENT_CREDENTIAL_ENCRYPTION_KEY.
CREATE TABLE IF NOT EXISTS agent_clob_credentials (
  credential_key TEXT PRIMARY KEY,
  clob_host TEXT NOT NULL,
  signer_address TEXT NOT NULL,
  funder_address TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  encryption_key_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_clob_credentials_updated_at
  ON agent_clob_credentials(updated_at DESC);
