# Knoww Agent

Paper-trading agent runtime for Polymarket research.

This workspace owns:

- evidence collection
- three-model vote normalization
- quorum reduction
- deterministic paper execution and risk gates
- D1 repository schema and migrations

`apps/web` imports this package for the admin dashboard and internal API routes. The default execution mode remains paper trading. The live path is gated by explicit env flags, starts in dry-run mode, and requires a dedicated server-controlled EOA before it can sign or submit Polymarket CLOB orders.

## Local setup

1. Copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars` and fill in local values.
2. Apply the local D1 schema from the web package:

```sh
pnpm --filter @knoww/web agent:d1:migrate:local
```

3. Confirm there are no pending local migrations:

```sh
pnpm --filter @knoww/web agent:d1:list:local
```

The first paper-trading version uses `OPENROUTER_API_KEY` plus `AGENT_LLM_MODELS` for three independent model-family votes. OpenRouter requests include app attribution with `OPENROUTER_APP_NAME` and `OPENROUTER_APP_URL`, defaulting to `Knoww` and `https://knoww.app`. Free models can be slower, so `AGENT_LLM_TIMEOUT_MS` defaults to 90000 and `AGENT_LLM_SPACING_MS` defaults to 1500. If `OPENROUTER_API_KEY` is absent, each model abstains and the quorum reducer produces `HOLD`.

`AGENT_LLM_WEB_SEARCH_ENABLED` is the master search toggle. When it is `false`, the agent does not run native OpenRouter search or direct provider search.

`AGENT_LLM_WEB_SEARCH_MODE` selects the search path:

- `native` uses OpenRouter's hosted `web_search` server tool. This is the back-compatible default. The model decides when to call it, and results may differ per model vote.
- `direct` runs Tavily, Exa, and Firecrawl before the vote and adds normalized evidence to the shared evidence pack. Configure `AGENT_SEARCH_PROVIDERS`, `TAVILY_API_KEY`, `EXA_API_KEY`, and `FIRECRAWL_API_KEY`.
- `both` runs direct provider enrichment and still exposes OpenRouter `web_search`.

Direct provider search is deterministic from the model's perspective: every model receives the same provider results in the prompt. `AGENT_SEARCH_MAX_RESULTS` defaults to 3 and `AGENT_SEARCH_TIMEOUT_MS` defaults to 5000.

Short-duration markets should include `eventEndTime` on the watchlist item. The runtime blocks new paper decisions after the market closes, and also inside `AGENT_MARKET_CLOSE_BUFFER_MS` before close. The default close buffer is 30000 ms.

Watchlist items can be entered manually or imported from a Polymarket event URL. URL import fetches Gamma event metadata, picks the requested outcome label when provided, and stores the matching CLOB token id, condition id, market slug, event timestamps, and resolution source.

The web worker can run the agent automatically through a Cloudflare Cron Trigger
configured in `apps/web/wrangler.jsonc`. The checked-in config currently keeps
cron triggers disabled with `crons: []` and `AGENT_CRON_ENABLED=false`. To enable
automatic runs later, add an explicit schedule and set:

```sh
AGENT_CRON_ENABLED=true
AGENT_CRON_EXECUTION_MODE=paper
AGENT_CRON_LOCK_LEASE_MS=600000
```

`AGENT_CRON_EXECUTION_MODE` defaults to `paper`. Setting it to `live` still goes
through the live adapter kill switches and confirmation gates; the cron path does
not bypass `AGENT_LIVE_ENABLED`, `AGENT_LIVE_DRY_RUN`, or
`AGENT_LIVE_CONFIRMED`.

## Live CLOB credentials

The live adapter derives Polymarket CLOB API credentials from `AGENT_WALLET_PRIVATE_KEY` when it first needs them. To avoid deriving them on every real order, configure encrypted credential storage:

```sh
AGENT_CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -base64 32)"
AGENT_CREDENTIAL_ENCRYPTION_KEY_VERSION=v1
```

`AGENT_CREDENTIAL_ENCRYPTION_KEY` must be stored in the deployment secret store or local `.env.local`; do not commit it. Keep it stable across deploys. If it changes, existing cached credentials cannot be decrypted and the adapter will derive and store a fresh encrypted credential payload.

`AGENT_CREDENTIAL_ENCRYPTION_KEY_VERSION` defaults to `v1`. A version mismatch is treated as a cache miss unless the matching previous key is configured.

Cached rows are keyed by CLOB host, signer address, and funder address. The database stores only an AES-GCM payload plus metadata; plaintext CLOB key, secret, and passphrase are not persisted.

For key rotation without forcing a cache miss, deploy the new key as `AGENT_CREDENTIAL_ENCRYPTION_KEY`, bump `AGENT_CREDENTIAL_ENCRYPTION_KEY_VERSION`, and include old keys in `AGENT_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` as comma-separated `version:key` entries. On the next live order, the adapter decrypts the cached row with a previous key and re-encrypts it with the active key/version.

Live order audit rows track lifecycle and reconciliation state: `POSTED`, `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`, or `FAILED`, plus actual filled notional, filled shares, average fill price, last sync time, and a post-submit balance snapshot. Positions are opened or closed only from actual fill amounts returned by the CLOB response.

Optional production safety gates:

- `AGENT_LIVE_EMERGENCY_STOP=true` blocks all live adapter execution.
- `AGENT_LIVE_ALLOWLIST_TOKEN_IDS` restricts live trading to comma-separated CLOB token IDs.
- `AGENT_LIVE_ALLOWLIST_CONDITION_IDS` restricts live trading to comma-separated condition IDs.
- `AGENT_LIVE_DAILY_MAX_ORDER_COUNT` blocks real orders after the daily count is reached.
- `AGENT_LIVE_DAILY_MAX_NOTIONAL_USD` blocks real orders that would exceed daily requested notional.

Remote D1 setup still requires creating the Cloudflare D1 database and adding its `database_id` to `apps/web/wrangler.jsonc` before running the same migration with `--remote`.
