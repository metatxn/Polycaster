# Knoww Agent

Paper-trading agent runtime for Polymarket research.

This workspace owns:

- evidence collection
- three-model vote normalization
- quorum reduction
- deterministic paper execution and risk gates
- D1 repository schema and migrations

`apps/web` imports this package for the admin dashboard and internal API routes. V1 remains paper-only and does not sign or submit live orders.

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

The first paper-trading version uses `OPENROUTER_API_KEY` plus `AGENT_LLM_MODELS` for three independent model-family votes. OpenRouter requests include app attribution with `OPENROUTER_APP_NAME` and `OPENROUTER_APP_URL`, defaulting to `Knoww` and `https://knoww.app`. Free models can be slower, so `AGENT_LLM_TIMEOUT_MS` defaults to 45000 and `AGENT_LLM_SPACING_MS` defaults to 1500. If `OPENROUTER_API_KEY` is absent, each model abstains and the quorum reducer produces `HOLD`.

Short-duration markets should include `eventEndTime` on the watchlist item. The runtime blocks new paper decisions after the market closes, and also inside `AGENT_MARKET_CLOSE_BUFFER_MS` before close. The default close buffer is 30000 ms.

Watchlist items can be entered manually or imported from a Polymarket event URL. URL import fetches Gamma event metadata, picks the requested outcome label when provided, and stores the matching CLOB token id, condition id, market slug, event timestamps, and resolution source.

Remote D1 setup still requires creating the Cloudflare D1 database and adding its `database_id` to `apps/web/wrangler.jsonc` before running the same migration with `--remote`.
