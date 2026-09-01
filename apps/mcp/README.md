# Knoww MCP Worker

Knoww's remote Model Context Protocol server exposes read-only prediction-market tools for AI clients and agents. It runs as a dedicated Cloudflare Worker and reads public market data from Polymarket's Gamma, Data, and CLOB APIs through the shared `@knoww/services` package.

The code is a production release candidate. Knoww uses one remote MCP environment: production. Production traffic remains off until an approved operator provisions the Cloudflare resources, configures alerts, and performs the first attended production deployment. After that bootstrap release, Cloudflare Workers Builds deploys MCP-affecting merges to `main`; GitHub Actions remains a pre-merge quality gate.

For the full architecture and rollout plan, read [mcp.md](../../mcp.md). For the initial implementation record, read [mcp-implementation-report.md](../../mcp-implementation-report.md). Release operators should follow [OPERATIONS.md](OPERATIONS.md).

## Contents

- [What is implemented](#what-is-implemented)
- [Architecture](#architecture)
- [Core dependencies](#core-dependencies)
- [Tool catalog](#tool-catalog)
- [Response conventions](#response-conventions)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Automated verification](#automated-verification)
- [Manual testing](#manual-testing)
- [Authentication status](#authentication-status)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Security rules](#security-rules)
- [Protocol compatibility](#protocol-compatibility)
- [Logging and diagnostics](#logging-and-diagnostics)
- [Deployment status](#deployment-status)
- [Troubleshooting](#troubleshooting)
- [References](#references)

## What is implemented

The Worker currently provides 20 tools:

- `search_markets`
- `get_market`
- `get_event`
- `get_orderbook`
- `get_price_history`
- `list_events`
- `get_market_trades`
- `get_market_quotes`
- `get_market_holders`
- `get_open_interest`
- `get_event_live_volume`
- `get_trader_leaderboard`
- `list_tags`
- `list_sports_markets`
- `get_public_profile`
- `get_wallet_positions`
- `get_wallet_activity`
- `get_closed_positions`
- `get_wallet_pnl`
- `get_wallet_portfolio_value`

The implementation includes:

- Stateless Streamable HTTP at `/mcp`
- Legacy 2025-11-25 and modern 2026-07-28 MCP protocol support
- Host and Origin validation
- Development-only authentication bypass
- OAuth 2.1 authorization-code flow with S256 PKCE
- MCP protected-resource and authorization-server discovery
- Client ID Metadata Documents, plus rate-limited dynamic registration for compatibility
- Google OpenID Connect login with atomic one-time authorization state
- Audience-bound access and refresh tokens
- `markets:read` enforcement at the protected route and inside every tool
- Distributed rate limiting on authorization, token, and registration endpoints
- Edge, free-plan principal, and per-tool production quotas
- Production custom-domain configuration
- Public liveness and stateful-binding readiness probes
- Production security headers and full Workers Logs sampling
- Privacy-safe PostHog analytics for every public route, MCP protocol method, and tool
- Pre-parse body caps: 1 MiB for MCP and OAuth registration, and 64 KiB for OAuth token forms
- An HTTP OpenAPI contract, pull-request CI gate, and rollback runbook
- Strict tool input and output schemas with Zod
- Validation of untrusted Gamma, Data API, and CLOB responses
- Decimal-string prices and Decimal.js arithmetic
- Upstream timeouts and caller cancellation
- Explicit output truncation signals
- Structured request IDs, provenance, and timestamps
- Safe errors and structured logging without raw upstream messages

It does not yet include:

- Private authenticated Polymarket or Knoww account data
- Trading actions or x402-paid tools

## Architecture

```text
AI client or agent
        |
        | Streamable HTTP
        v
Cloudflare Worker: /mcp
        |
        | Host, Origin, request-id, edge quota, and auth rate-limit checks
        v
Cloudflare Workers OAuth Provider
        |
        | Google OIDC identity + audience-bound token + markets:read
        v
agents/mcp/server createMcpHandler
        |
        v
@modelcontextprotocol/server
        |
        v
Thin MCP tool adapters
        |
        v
@knoww/services
        |
        +--------------------+
        |                    |
        v                    v
Polymarket Gamma API   Polymarket Data API   Polymarket CLOB API
```

The MCP tools do not call Knoww's public Next.js API routes. Both the website and the MCP Worker use shared domain services from `packages/knoww-services`.

The Worker is separate from `apps/web` so it can have its own authentication secrets, quotas, deployment schedule, rollback path, and logs. Hono is not used because the current Worker has one MCP route and the MCP handler already owns the protocol routing.

MCP requests remain stateless and need no session affinity. A Durable Object is used only to create and atomically consume each five-minute Google authorization transaction; it does not hold MCP sessions or Google tokens.

## Core dependencies

| Package | Version | Purpose |
|---|---|---|
| `agents` | `0.21.0` | Cloudflare's stateless MCP handler adapter |
| `@modelcontextprotocol/server` | `2.0.0` | Official MCP server implementation |
| `@cloudflare/workers-oauth-provider` | `0.10.3` | OAuth discovery, registration, grants, tokens, refresh, and revocation |
| `@knoww/services` | Workspace | Validated Gamma, Data API, and CLOB service calls |
| `@knoww/logger` | Workspace | Structured logs |
| `@knoww/shared-types` | Workspace | Shared Polymarket parsers and types |
| `decimal.js` | Workspace catalog | Exact decimal parsing, comparison, and arithmetic |
| `jose` | `6.2.3` | Google ID-token signature and claim verification |
| `zod` | `4.4.3` | Tool and upstream-response schemas |
| `wrangler` | `4.123.0` | Local Worker runtime, type generation, build, and deploy |
| `vitest` | `4.1.10` | Workers-native automated tests |

## Tool catalog

All current tools are read-only and require `markets:read`. Production requests are checked before MCP dispatch, and each tool repeats the scope check at execution time.

### `search_markets`

Searches active prediction-market events.

| Input | Type | Rules |
|---|---|---|
| `query` | string | Required, trimmed, 1 to 200 characters |
| `status` | `"active"` | Optional, defaults to `active` |
| `category` | string | Optional, up to 100 characters |
| `resultType` | `"events"` or `"markets"` | Optional, defaults to `events` |
| `match` | `"contains"`, `"whole_word"`, or `"exact_phrase"` | Optional, defaults to `contains` |
| `sortBy` | `"relevance"` or `"volume"` | Optional, defaults to `relevance` |
| `sortOrder` | `"asc"` or `"desc"` | Optional; applies to volume sorting and defaults to `desc` |
| `cursor` | string | Optional; continues either result type |
| `limit` | integer | Optional, 1 to 20, defaults to 10 |

The default event records remain unchanged: they contain nested market summaries, reusable identifiers, outcome prices, CLOB token IDs, total counts, and truncation flags.

Set `resultType` to `markets` for flat market records without the duplicate event-summary payload. This mode can remove substring matches with `whole_word`, match a bounded multi-word phrase with `exact_phrase`, and sort individual markets by lifetime volume. Each record includes the market status, Polymarket platform, Knoww URL, available dates, lifetime volume and liquidity, outcomes, and parent event. Volume is a canonical decimal string, but `volumeUnit` is `unspecified` because the upstream API does not document its currency.

Both result types include `page.totalResults`, `page.returnedResults`, and `page.hasMore`. Pass `meta.nextCursor` unchanged to continue the same query, filters, and ordering. Search is live rather than snapshot-isolated, so results can move between pages. `page.totalResults` covers the upstream candidates inspected for that call; when `meta.truncated` is true, narrow the query or category because more upstream candidates or nested event summaries may exist.

### `get_market`

Fetches one market using exactly one identifier.

| Input | Type | Rules |
|---|---|---|
| `slug` | string | Lowercase letters, digits, and dashes |
| `conditionId` | string | `0x` followed by 64 hexadecimal characters |
| `tokenId` | string | 1 to 80 decimal digits |

The response contains lifecycle status, outcomes, prices, token IDs, volume, liquidity, selected price fields, resolution data, and a reference to the parent event when available.

Closed-market lookup retries Gamma with `closed=true` after an empty open-market result. A market is reported as resolved only when Gamma reports resolution. The code does not infer settlement from prices alone.

### `get_event`

Fetches one event using exactly one identifier and returns a page of markets.

| Input | Type | Rules |
|---|---|---|
| `id` | string | 1 to 20 decimal digits |
| `slug` | string | Lowercase letters, digits, and dashes |
| `cursor` | string | Optional opaque market-page cursor |
| `marketOffset` | integer | Optional, 0 to 10,000, defaults to 0 |
| `marketLimit` | integer | Optional, 1 to 50, defaults to 20 |

For `negRisk` parents, the tool fetches child events and merges their markets. Ordinary events do not trigger child-event fan-out. If a follow-up request fails, the tool keeps the parent event and marks the market list incomplete. New callers should use `cursor`; `marketOffset` remains available for older clients.

### `get_orderbook`

Fetches one live CLOB order-book snapshot.

| Input | Type | Rules |
|---|---|---|
| `tokenId` | string | Required, 1 to 80 decimal digits |
| `depth` | integer | Optional, 1 to 50, defaults to 20 |

Bids are sorted from highest to lowest price. Asks are sorted from lowest to highest price. Prices, sizes, spread, midpoint, and returned-side depth totals are decimal strings.

A snapshot is marked stale when it is more than 60 seconds old or has no usable upstream timestamp. The service rejects a snapshot when its returned token ID differs from the requested token.

### `get_price_history`

Fetches CLOB price samples for one outcome token.

| Input | Type | Rules |
|---|---|---|
| `tokenId` | string | Required, 1 to 80 decimal digits |
| `startTime` | ISO 8601 string | Optional |
| `endTime` | ISO 8601 string | Optional, defaults to now |
| `fidelityMinutes` | integer | Optional, 1 to 1,440, defaults to 60 |

The default window is the last 24 hours. The maximum window is 31 days. Points are returned in ascending timestamp order. Series longer than 1,000 points are downsampled evenly with both endpoints retained, and the response sets `meta.truncated`.

An empty history is a successful result. Polymarket does not distinguish an unknown token from a valid token with no trades in the requested window.

### Event, market-data, and discovery getters

| Tool | Required input | Optional controls | Result |
|---|---|---|---|
| `list_events` | None | Keyset cursor, closed or live state, tag, series, date bounds, order, limit | Events, tags, bounded market summaries, and `meta.nextCursor` |
| `get_market_trades` | Exactly one of `conditionIds` or `eventIds` | Wallet, side, time bounds, limit, cursor, offset | Public trades with decimal-string size and price |
| `get_market_quotes` | `tokenIds` | None | BUY/SELL price, midpoint, spread, and last trade |
| `get_market_holders` | `conditionIds` | Limit and minimum balance | Largest public holders for each market |
| `get_open_interest` | `conditionIds` | None | Open interest by market |
| `get_event_live_volume` | Positive integer `eventId` | None | Event total and per-market live volume |
| `get_trader_leaderboard` | None | Category, period, PnL or volume order, trader filters, limit, cursor, offset | Public trader ranks, volume, and PnL |
| `list_tags` | None | Limit, cursor, and offset | Category tags for filtering |
| `list_sports_markets` | None | Sport, league, cursor, team offset, limit | Sports metadata, market types, teams, and tagged markets |

List inputs are bounded even when Polymarket accepts larger pages. New callers should use `meta.nextCursor`; offsets remain available for compatibility. Market titles, event descriptions, profile fields, outcomes, sports rules, and team names are quoted upstream data, not instructions.

### Public wallet getters

| Tool | Required input | Optional controls | Result |
|---|---|---|---|
| `get_public_profile` | `walletAddress` | None | Public profile fields |
| `get_wallet_positions` | `walletAddress` | Market filters, position state, size threshold, sort, limit, cursor, offset | Current public positions and PnL fields |
| `get_wallet_activity` | `walletAddress` | Market, activity-type and time filters, sort, limit, cursor, offset | Public wallet activity |
| `get_closed_positions` | `walletAddress` | Market filters, sort, limit, cursor, offset | Closed positions and realized PnL |
| `get_wallet_pnl` | `walletAddress` | None | All-time overall PnL and current-position breakdown |
| `get_wallet_portfolio_value` | `walletAddress` | None | Current total position value |

`walletAddress` is always an explicit public Polymarket proxy wallet address in `0x` plus 40 hexadecimal-character form. Google sign-in authorizes access to Knoww MCP; it does not provide, infer, or prove ownership of a Polymarket wallet. These tools read public on-chain and Polymarket API data only.

## Response conventions

### Successful results

Each successful tool call returns a short text result and typed `structuredContent`.

Every structured result includes:

```ts
interface KnowwToolMeta {
  requestId: string;
  asOf: string;
  sources: Array<{
    name: string;
    url?: string;
  }>;
  nextCursor?: string;
  truncated?: boolean;
}
```

`asOf` is an ISO 8601 timestamp. `sources` identifies Polymarket Gamma, Data API, or CLOB. `truncated` is true when Knoww caps a result. `get_event` also sets it when a failed or capped follow-up fetch leaves the market list incomplete.

Collection tools also return:

```ts
interface KnowwPageInfo {
  returnedResults: number;
  totalResults?: number;
  hasMore: boolean;
}
```

`search_markets`, `get_event`, `list_events`, `get_market_trades`, `get_trader_leaderboard`, `list_tags`, `list_sports_markets`, `get_wallet_positions`, `get_wallet_activity`, and `get_closed_positions` accept `cursor` and return `page`. When `page.hasMore` is true, pass `meta.nextCursor` unchanged with the same filters and ordering. Cursors are opaque, reject filter reuse, and cannot be combined with a non-zero legacy offset.

`list_events` and the market side of `list_sports_markets` carry Polymarket's real Gamma keysets. Data API collections still use documented offsets upstream, so Knoww wraps those offsets in the same cursor contract. A full final page from an offset API can produce one last cursor whose next page is empty because the upstream response does not include a total count. See Polymarket's [event keyset API](https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination), [keyset migration note](https://docs.polymarket.com/changelog), and [offset-based trades API](https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets).

Tools without `cursor` return one entity, a point-in-time snapshot, an aggregate, or a batch bounded by caller-supplied identifiers. Paginating an order book, for example, could combine levels from different snapshots.

Prices, sizes, volume, liquidity, spreads, and other market quantities use canonical decimal strings. Tool code uses Decimal.js for comparisons and arithmetic.

### Truncation

Tools do not silently hide Knoww-enforced caps:

- Search events report total and returned market counts.
- Market summaries report total outcomes and `outcomesTruncated`.
- Detail tools report capped descriptions and tags.
- Event market pagination sets `meta.truncated` while more markets remain.
- Order books set `meta.truncated` when either side exceeds the requested depth.
- Price history sets `downsampled` and `meta.truncated` after the 1,000-point cap.

### Errors

Tool errors use one of these codes:

```text
VALIDATION_ERROR
UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
RATE_LIMITED
CONFLICT
UPSTREAM_TIMEOUT
UPSTREAM_UNAVAILABLE
INTERNAL_ERROR
```

The text result tells the caller whether retrying is appropriate. Tool errors also include machine-readable metadata:

```ts
interface KnowwToolErrorResult {
  isError: true;
  _meta: {
    "app.knoww/error": {
      code: string;
      message: string;
      retryable: boolean;
      retryAfterSeconds?: number;
      requestId: string;
    };
  };
}
```

Rate-limited callers can use `retryAfterSeconds` instead of parsing text. Raw upstream responses, internal error messages, stack traces, credentials, and request bodies are not returned.

## Quick start

Run commands from the repository root.

### 1. Install dependencies

```bash
cd /Users/nareshkatta/Desktop/Soclly/polycaster
node --version # v24.x
pnpm install
```

Use Node.js 24. The workspace declares `pnpm@10.25.0` in the root `package.json`.

### 2. Start the Worker

```bash
pnpm --filter @knoww/mcp dev
```

Wrangler normally starts at `http://localhost:8787`. The MCP endpoint is:

```text
http://localhost:8787/mcp
```

The `dev` script selects the Wrangler `local` environment. That is the only configuration that enables the authentication bypass.

## Commands

Run these from the repository root.

| Command | Purpose |
|---|---|
| `pnpm --filter @knoww/mcp dev` | Start the local Worker with the development auth bypass |
| `pnpm --filter @knoww/mcp dev:oauth` | Start the local Worker with the complete Google OAuth flow |
| `pnpm --filter @knoww/mcp test` | Run the MCP Worker test suite |
| `pnpm --filter @knoww/mcp typecheck` | Run TypeScript without emitting files |
| `pnpm --filter @knoww/mcp lint` | Run Biome checks for the MCP package |
| `pnpm --filter @knoww/mcp format` | Format MCP source files |
| `pnpm --filter @knoww/mcp build` | Produce a dry-run production Worker bundle |
| `pnpm --filter @knoww/mcp cf-typegen` | Regenerate Cloudflare binding types |
| `pnpm --filter @knoww/mcp deploy` | Manually upload a production version without assigning traffic while automatic deployment is paused |
| `pnpm --filter @knoww/mcp deploy:first-production` | Create the first production deployment after local and CI approval |
| `pnpm --filter @knoww/mcp deploy:promote` | Manually assign production traffic to uploaded versions while automatic deployment is paused |
| `pnpm --filter @knoww/mcp deploy:status` | Show the active production deployment |
| `pnpm --filter @knoww/mcp deploy:rollback -- VERSION_ID` | Roll back to a known healthy production version |

## Automated verification

Run each command from the repository root.

### Shared services

```bash
pnpm --filter @knoww/services test
```

```bash
pnpm --filter @knoww/services typecheck
```

```bash
pnpm exec biome check packages/knoww-services/src packages/knoww-services/vitest.config.ts
```

### MCP Worker

```bash
pnpm --filter @knoww/mcp test
```

```bash
pnpm --filter @knoww/mcp typecheck
```

```bash
pnpm exec biome check apps/mcp/src apps/mcp/vitest.config.ts
```

```bash
pnpm --filter @knoww/mcp build
```

The current baseline is 97 service tests and 138 MCP tests. The build command performs a Wrangler production dry run and writes its output to `apps/mcp/dist`.

Tests stub upstream fetches with a one-shot route table. They fail when an expected route is unused or code makes an unexpected outbound request.

## Manual testing

### Full Google OAuth on localhost

The normal `dev` command bypasses OAuth. Use this flow when you need to test the Google exchange, ID-token verification, OAuth grant, and callback locally.

1. In the Google Cloud Web application used by Knoww MCP, add this temporary Authorized redirect URI:

   ```text
   http://localhost:8787/auth/google/callback
   ```

2. Create `apps/mcp/.dev.vars` on your machine with the client ID and secret from that same Google client:

   ```text
   GOOGLE_CLIENT_ID=replace-with-the-google-client-id
   GOOGLE_CLIENT_SECRET=replace-with-the-google-client-secret
   ```

   Git ignores `.dev.vars`. Never commit it, paste its contents into an issue, or pass the secret on the command line.

3. Start the OAuth-enabled Worker with Node.js 24:

   ```bash
   node --version # v24.x
   pnpm --filter @knoww/mcp dev:oauth
   ```

4. Start the web application in another terminal, open its `/mcp-test` page, and set the server URL to `http://localhost:8787/mcp`:

   ```bash
   pnpm --filter @knoww/web dev
   ```

5. Select **Authorize**, complete Google sign-in, then select **Connect**. The local Worker uses local KV and Durable Object storage. It does not create a production grant or token.

6. Read the Worker terminal for `mcp.oauth.google.identity.denied` if authorization fails. Use the diagnostic table under [Logging and diagnostics](#logging-and-diagnostics) to identify the failed stage.

Remove the localhost callback from the Google client when the team no longer needs live local OAuth testing. Delete `.dev.vars` when you finish working with the credentials.

### MCP Inspector

Start the Worker first, then launch the official Inspector in another terminal:

```bash
npx @modelcontextprotocol/inspector@latest
```

Use the URL printed by Inspector. Add a connection with:

```text
Transport: Streamable HTTP
URL: http://127.0.0.1:8787/mcp
Protocol era: Legacy
```

After connecting, open the Tools view and call each tool. A useful test flow is:

1. Call `search_markets` with `query: "bitcoin"`.
2. Use an event slug from the response with `get_event`.
3. Use a nested market slug with `get_market`.
4. Use a nested outcome token ID with `get_orderbook`.
5. Use the same token ID with `get_price_history`.
6. Run `get_market_quotes`, `get_market_trades`, `get_market_holders`, and `get_open_interest` with the same live identifiers.
7. Run `list_events`, `list_tags`, `list_sports_markets`, `get_event_live_volume`, and `get_trader_leaderboard` with their defaults or identifiers from earlier responses.
8. Paste a public Polymarket proxy wallet address into each profile, position, activity, PnL, and portfolio-value getter.

These calls use the live Polymarket APIs and require internet access.

### Initialize with curl

```bash
curl -sS http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Mcp-Protocol-Version: 2025-11-25' \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": {
        "name": "knoww-local-test",
        "version": "1.0.0"
      }
    }
  }'
```

The response should identify `knoww-mcp` version `0.1.0`. Depending on content negotiation, the JSON-RPC response may be plain JSON or an SSE `data:` frame.

### List tools with curl

```bash
curl -sS http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Mcp-Protocol-Version: 2025-11-25' \
  --data '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

### Call a tool with curl

```bash
curl -sS http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Mcp-Protocol-Version: 2025-11-25' \
  --data '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search_markets",
      "arguments": {
        "query": "bitcoin",
        "limit": 3
      }
    }
  }'
```

### Check Host and Origin protection

An unapproved Origin should return `403`:

```bash
curl -i http://localhost:8787/mcp \
  -H 'Origin: https://evil.example' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Mcp-Protocol-Version: 2025-11-25' \
  --data '{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}'
```

Origin-less requests remain valid because desktop and server-side MCP clients do not always send an Origin header.

## Authentication status

Current behavior:

| Environment | `MCP_AUTH_MODE` | Result |
|---|---|---|
| Local | `dev-bypass` | Requests reach the MCP handler without OAuth |
| Production | `oauth-required` | The OAuth Provider validates an audience-bound Bearer token before MCP dispatch |
| Unknown value | Treated as `oauth-required` | Fails closed through the OAuth path |

An unauthenticated production request receives `401` with a `resource_metadata` link. The provider publishes:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`
- `/authorize`
- `/oauth/token`
- `/oauth/register` as a compatibility fallback for clients without CIMD

The preferred registration path is a Client ID Metadata Document. Dynamic Client Registration remains enabled for compatibility, is rate-limited, and stores registrations for 30 days.

The MCP host opens `/authorize` in the user's browser. After the user approves the requested scope, Knoww redirects to Google using authorization-code flow, S256 PKCE, a nonce, and five-minute one-time state. The Worker exchanges the Google code on the server and verifies the ID token signature, issuer, audience, expiry, nonce, stable subject, and verified-email claim. It then asks the existing OAuth Provider to issue a one-hour MCP access token and a rotating refresh token with a 30-day lifetime.

The MCP client and model never receive the Google client secret, Google authorization code, ID token, access token, email, or password. The MCP grant retains Google's stable subject identifier as the principal. Knoww does not add an application database for this flow: the existing OAuth KV binding stores provider grants and tokens, while the existing Durable Object binding stores only short-lived one-time authorization transactions.

Only `markets:read` is active and advertised. `x402:pay` is reserved for a future paid-tool phase but is currently rejected as `invalid_scope`. When it becomes active, it will mean “this client may attempt an x402-gated tool.” It will not authorize Knoww or the model to spend funds. The agent host must enforce its own budget and ask its wallet component to sign each payment proof.

`x402:pay` is a Knoww-defined OAuth scope, not part of the x402 protocol. Activation also depends on proving that supported MCP hosts can surface the x402 challenge and retry with the payment proof. The first paid tools should remain read-only and must bind each quote and proof to the principal, client, tool request, amount, asset, network, recipient, expiry, and one-time idempotency identifier.

Never enable `dev-bypass` in preview or production.

## Configuration

The checked-in Wrangler configuration contains non-secret deployment settings and required secret names only. Secret values belong in Cloudflare Worker secrets.

| Variable | Purpose | Production value |
|---|---|---|
| `MCP_AUTH_MODE` | Selects fail-closed production behavior or local bypass | `oauth-required` |
| `MCP_CANONICAL_RESOURCE` | OAuth resource and token audience | `https://mcp.knoww.app/mcp` |
| `MCP_ALLOWED_HOSTNAMES` | Comma-separated Host allowlist | `mcp.knoww.app` |
| `MCP_ALLOWED_ORIGIN_HOSTNAMES` | Comma-separated browser Origin allowlist | `mcp.knoww.app,knoww.app,www.knoww.app` |
| `POSTHOG_HOST` | Public PostHog event-ingestion host | `https://us.i.posthog.com` |

Required production secrets:

| Secret | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | Identifies the Knoww web OAuth client to Google |
| `GOOGLE_CLIENT_SECRET` | Authenticates the server-side Google code exchange |
| `POSTHOG_PROJECT_API_KEY` | Project token used only for public event ingestion |

Configure the Google OAuth client as a **Web application** and add the exact `https://mcp.knoww.app/auth/google/callback` URL under **Authorized redirect URIs**. This server-side flow does not require an Authorized JavaScript origin. If that optional field is populated for another integration, its value is only `https://mcp.knoww.app`; an origin cannot contain a path. The MCP client's own callback URI is separate and remains registered by that MCP client through CIMD or Dynamic Client Registration.

In **Workers & Pages > knoww-mcp > Settings > Variables and Secrets**, add all three names above as encrypted secrets. Reuse the project `585396` PostHog project token for `POSTHOG_PROJECT_API_KEY`; do not use a personal API key. The production Wrangler configuration marks these bindings as required, so a deployment reports missing configuration before traffic changes. Never place their values in Git, build logs, URLs, or browser code.

Analytics uses three bounded events: `mcp_http_request_completed`, `mcp_protocol_request_completed`, and `mcp_tool_called`. Every event includes `product=mcp` and `service=knoww-mcp`. Tool events include the registered tool name, outcome, safe error code, duration, plan, and authentication method. The Worker hashes the OAuth principal before it becomes a PostHog distinct ID and disables person-profile creation. It never sends request bodies, tool arguments, wallet addresses, market queries, response content, authorization headers, Google tokens, or raw errors.

Required Cloudflare bindings:

| Binding | Purpose |
|---|---|
| `OAUTH_KV` | Provider-managed clients, grants, authorization codes, and hashed token records |
| `MCP_AUTH_CHALLENGES` | Legacy-named Durable Object namespace for atomic one-time OIDC transactions |
| `MCP_AUTH_RATE_LIMITER` | Distributed limit for authorization, token, and registration routes |
| `MCP_EDGE_RATE_LIMITER` | Coarse source limit across all Worker paths before routing |
| `MCP_FREE_PRINCIPAL_RATE_LIMITER` | Free-plan quota across authenticated MCP requests |
| `MCP_FREE_TOOL_RATE_LIMITER` | Free-plan quota keyed by authenticated principal and tool |

Local values are defined under `env.local` in `wrangler.jsonc`:

```text
MCP_AUTH_MODE=dev-bypass
MCP_CANONICAL_RESOURCE=http://localhost:8787/mcp
MCP_ALLOWED_HOSTNAMES=localhost,127.0.0.1
MCP_ALLOWED_ORIGIN_HOSTNAMES=localhost,127.0.0.1
POSTHOG_HOST=https://us.i.posthog.com
```

Local `dev-bypass` does not require Google or PostHog credentials. Without a local PostHog project token, analytics stays disabled. Production requires all three secrets. Keep them in Cloudflare Secrets so Workers Builds can deploy without placing credentials in the repository or build variables.

## Project structure

```text
apps/mcp/
  README.md                  This guide
  OPERATIONS.md              Production alerts, rollout, and rollback runbook
  CHANGELOG.md               Release-facing change record
  openapi.yaml               Conventional HTTP endpoint contract
  package.json               Scripts and pinned package dependencies
  wrangler.jsonc             Worker and environment configuration
  cloudflare-env.d.ts        Generated Cloudflare binding types
  tsconfig.json              TypeScript configuration
  vitest.config.ts           Workers-native test configuration
  src/
    index.ts                 Worker entry, Host checks, auth routing, rate limits, logging
    mcp-handler.ts           Stateless MCP transport configuration
    server.ts                MCP server and tool registration
    config.ts                Environment configuration parser
    context.ts               Request-scoped request ID, analytics, and verified principal
    analytics.ts             Request-scoped PostHog batch capture and bounded metadata
    health.ts                Liveness and stateful-binding readiness probes
    quota.ts                 Edge, plan, principal, and tool quota enforcement
    auth/
      api.ts                 Verified OAuth props and route-level scope boundary
      challenge-store.ts     Atomic one-time OIDC transaction Durable Object
      consent.ts             OAuth consent and Google callback handlers
      google.ts              Google authorization, code exchange, and ID-token verification
      provider.ts            Workers OAuth Provider configuration
      scopes.ts              Active and reserved scope definitions
    errors/
      tool-error.ts          Safe tool error model and logging
    tools/
      search-markets.ts
      get-market.ts
      get-event.ts
      get-orderbook.ts
      get-price-history.ts
      public-markets.ts      Event, market-data, leaderboard, tag, and sports getters
      public-wallets.ts      Public profile, position, activity, PnL, and value getters
      public-read.ts         Shared validation, scope, quota, and error mapping
      gamma.ts               Shared Gamma projections and lifecycle rules
      decimal.ts             Decimal-string conversion
      meta.ts                Shared metadata and tool annotations
    tests/
      helpers.ts             Worker dispatch and upstream fetch stubs
      worker.test.ts         Transport and Worker boundary coverage
      get-*.test.ts          Tool integration coverage
      public-read-tools.test.ts Public getter catalog and execution coverage

packages/knoww-services/
  src/
    fetch-options.ts         Caller cancellation and upstream timeouts
    validation.ts            Shared Zod and Decimal.js validators
    markets/                 Gamma, Data API, and CLOB service implementations
```

Tool files should remain thin adapters. Provider calls, payload validation, normalization, caching rules, and business logic belong in `@knoww/services`.

## Security rules

Changes to this Worker must preserve these rules:

- Treat all tool input and upstream content as untrusted.
- Validate every upstream field before consuming it.
- Treat market titles, descriptions, and questions as quoted data, never instructions.
- Never expose admin tokens, extension sessions, relayer credentials, signing operations, raw RPC, or internal AI routes.
- Never accept caller-supplied user or tenant ownership for private data.
- Derive identity only from the OAuth Provider's verified, encrypted token properties.
- Never accept extension-session or admin tokens as MCP credentials.
- Keep Google authorization state short-lived and atomically one-time.
- Verify Google ID-token signatures, issuer, audience, expiry, nonce, subject, and verified email before issuing an MCP grant.
- Never expose or retain Google codes, Google tokens, or the Google client secret in MCP token properties.
- Treat OAuth scopes and x402 payment proofs as separate controls.
- Return money and market quantities as decimal strings.
- Use Decimal.js for monetary comparisons and arithmetic.
- Keep upstream requests bounded by timeouts and output limits.
- Propagate caller cancellation to upstream requests.
- Report output caps through structured fields and `meta.truncated`.
- Do not return raw upstream errors or stack traces.
- Do not log tokens, credentials, authorization headers, request bodies, or tool output.
- Do not use Worker module memory as the only production cache or rate limiter.
- Keep `dev-bypass` local only.

Version 1 is read-only. It must not place, cancel, sign, relay, settle, or pay for trades. Any future action or x402-paid tool requires a separate specification, threat model, review flow, idempotency design, budget policy, and explicit approval.

## Protocol compatibility

The same stateless handler supports two protocol eras:

| Protocol version | Discovery path | Coverage |
|---|---|---|
| 2025-11-25 | Classic `initialize`, then ordinary tool requests | Integration tested |
| 2026-07-28 | `server/discover` with per-request `_meta` | Integration tested |

Do not send a 2026-07-28 protocol header with the classic `initialize` body. The SDK treats that combination as a version mismatch.

The endpoint uses Streamable HTTP. It does not expose the deprecated HTTP plus SSE transport, stdio, subscriptions, or cross-isolate notifications.

## Logging and diagnostics

The Worker uses `@knoww/logger` and generates one request ID per inbound request. The request ID appears in:

- The `x-request-id` response header
- Successful tool `meta.requestId`
- Safe request and tool failure logs

Current request events include:

```text
mcp.request.started
mcp.request.finished
mcp.request.failed
mcp.auth.denied
mcp.quota.principal.denied
mcp.health.readiness.failed
mcp.tools.tool.failed
mcp.oauth.google.identity.denied
```

Tool failure logs contain only the tool name, request ID, normalized error code, and retryability. They do not contain the raw exception message or stack.

Google identity failures add only allowlisted diagnostic fields:

| `googleStage` | `googleFailure` | Other field | Meaning |
|---|---|---|---|
| `token_exchange` | `request_failed` | None | The Worker could not reach Google's token endpoint or the request timed out. |
| `token_exchange` | `upstream_rejected` | `googleOAuthError=invalid_client` | Google rejected the client ID and secret pair. |
| `token_exchange` | `upstream_rejected` | `googleOAuthError=invalid_grant` | The code was expired, reused, or did not match the redirect URI or PKCE verifier. |
| `token_exchange` | `invalid_response` | None | Google returned a successful but malformed or unsupported token response. |
| `id_token_verification` | `verification_failed` | None | Signature, JWKS, issuer, audience, age, nonce, subject, or verified-email validation failed. |
| `unknown` | `unexpected_error` | None | An unexpected error occurred outside the classified Google boundary. |

`googleUpstreamStatus` is included when Google rejects the token exchange. Logs never include Google's description, the authorization code, PKCE verifier, ID token, access token, email, client secret, or raw exception.

When debugging a request, start with `x-request-id`, then find the matching structured log line.

## Deployment status

The repository now contains the production route, OAuth and quota bindings, probes, PR quality gate, HTTP contract, and rollback commands. GitHub Actions validates every pull request but never deploys. After the bootstrap release, Cloudflare Workers Builds is the only automatic production deployer and runs for MCP-affecting merges to `main`.

There is no remote staging Worker. The first live CIMD, DCR, Google OAuth, quota, and tool checks run against production immediately after the first attended deployment. Protect `main` so `MCP CI / quality` is required and direct pushes are blocked. Follow [OPERATIONS.md](OPERATIONS.md) for the exact release checks, monitoring thresholds, Cloudflare build settings, and rollback commands.

### Automatic production deployments

Configure the GitHub repository connection on the existing `knoww-mcp` Worker in **Workers & Pages > knoww-mcp > Settings > Builds**. Do not configure these settings only on the `knoww` website Worker. That Worker has a separate deployment pipeline and does not deploy the MCP server.

Use the following Cloudflare Workers Builds settings:

| Setting | Value |
|---|---|
| Git repository | `metatxn/Knoww` |
| Production branch | `main` |
| Root directory | `/apps/mcp` |
| Build command | `pnpm --dir ../.. install --frozen-lockfile` |
| Deploy command | `pnpm exec wrangler deploy --env="" --strict` |
| Non-production branch builds | Disabled |
| Build caching | Enabled |
| Build variable | `NODE_VERSION=24` |
| Build variable | `PNPM_VERSION=10.25.0` |
| Build variable | `SKIP_DEPENDENCY_INSTALL=1` |

Set the production build watch include paths to:

```text
apps/mcp/*
packages/knoww-services/*
packages/logger/*
packages/shared-types/*
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.json
```

Leave the exclude paths empty. After an MCP-affecting pull request is merged, confirm that the merge commit receives a successful `Workers Builds: knoww-mcp` status and reaches the `knoww-mcp` Worker. A successful `Workers Builds: knoww` status covers only the website Worker.

To verify the production trigger without changing Worker behavior:

1. Push a documentation-only change under `apps/mcp` to a pull-request branch. No production build should start because non-production branch builds are disabled.
2. Merge the pull request into `main`. The merge commit should receive a `Workers Builds: knoww-mcp` check.
3. Open the check details and confirm that the script is `knoww-mcp`, the branch is `main`, and the build uses the merge commit.
4. Confirm that the same commit appears in the `knoww-mcp` deployment history, then check `/healthz` and `/readyz`.

If the branch push starts a production build, check the production branch setting. If the merge to `main` does not create a `Workers Builds: knoww-mcp` check, check the Git connection and build watch paths before deploying manually.

Once this connection is enabled, repeated manual MCP deployments should not be part of the normal release process. Use the manual Wrangler deployment and rollback commands in [OPERATIONS.md](OPERATIONS.md) only for the bootstrap release, controlled recovery, or rollback.

## Troubleshooting

### OAuth discovery appears during local testing

Start the Worker through the package script:

```bash
pnpm --filter @knoww/mcp dev
```

Running Wrangler without `--env local` selects the production-shaped OAuth configuration. The default local script intentionally uses `dev-bypass`; the full OAuth code flow is exercised by the Workers-native test suite.

To test the full browser flow locally, follow [Full Google OAuth on localhost](#full-google-oauth-on-localhost). Do not change the checked-in local default from `dev-bypass`.

### `403` with an invalid Host or Origin

Use `http://localhost:8787/mcp` for the browser OAuth flow because it exactly matches the configured local resource metadata. Dev-bypass clients may also use `http://127.0.0.1:8787/mcp`. Browser requests must send an Origin whose hostname appears in `MCP_ALLOWED_ORIGIN_HOSTNAMES`. Origin-less desktop requests are allowed.

### Google reports `redirect_uri_mismatch`

Open the Google Cloud Console web OAuth client and place `https://mcp.knoww.app/auth/google/callback` under **Authorized redirect URIs**. Do not paste that path into **Authorized JavaScript origins**; an origin is only `https://mcp.knoww.app`. Save the client, allow Google's configuration to propagate, then restart the MCP authorization flow so it uses fresh five-minute state.

For local Google OAuth, also add `http://localhost:8787/auth/google/callback` to that same list. Keep the explorer endpoint at `http://localhost:8787/mcp` so it exactly matches the local protected-resource metadata.

### Local `/authorize` reports that Google authentication is not configured

Cloudflare production secrets are not available to `wrangler dev`. Create the ignored `apps/mcp/.dev.vars` file described in [Full Google OAuth on localhost](#full-google-oauth-on-localhost), then restart `pnpm --filter @knoww/mcp dev:oauth`. The Worker validates only that both variables are present and never logs their values.

### Google returns but the client stays disconnected

Allow popups for the MCP host and keep the product window open during sign-in. If the client reports a state error, begin authorization again instead of reusing the callback URL. A callback state is valid for five minutes and is consumed once, including when Google returns an error.

### MCP Inspector cannot connect

Check these items:

- The Worker terminal shows that Wrangler is listening.
- The URL ends in `/mcp`.
- Transport is Streamable HTTP, not SSE.
- The URL uses `localhost` or `127.0.0.1`.
- The Inspector uses the legacy protocol era for the normal `initialize` flow.
- No other process occupies ports 8787, 6274, or 6277.

### Search or market calls return upstream errors

Live manual calls require access to:

```text
https://gamma-api.polymarket.com
https://clob.polymarket.com
```

Run the automated tests to separate local implementation failures from provider or network failures.

### Empty price history

An empty history does not prove that the token is invalid. It can also mean that no trades occurred in the requested window. Try a wider window or a token from an active market.

### Generated binding types are stale

After changing safe Wrangler bindings, regenerate the Worker types:

```bash
pnpm --filter @knoww/mcp cf-typegen
```

Review the generated diff before committing it. Never generate types by reading or copying real secret values.

## References

Repository documentation:

- [Architecture and implementation plan](../../mcp.md)
- [Implementation report](../../mcp-implementation-report.md)
- [Google OIDC decision record](../../docs/decisions/2026-08-31-mcp-google-oidc.md)
- [Operations runbook](OPERATIONS.md)
- [HTTP OpenAPI contract](openapi.yaml)
- [Changelog](CHANGELOG.md)
- [Shared Knoww services](../../packages/knoww-services)

Official documentation:

- [Cloudflare MCP overview](https://developers.cloudflare.com/agents/model-context-protocol/)
- [Cloudflare MCP handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- [Cloudflare remote MCP server guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
- [Cloudflare Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider)
- [Cloudflare Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Workers build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [`jose` remote JWKS verification](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP Streamable HTTP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx)
- [x402 HTTP 402 concepts](https://docs.x402.org/core-concepts/http-402)
- [x402 V2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [Cloudflare Agents x402 payments](https://developers.cloudflare.com/agents/tools/payments/x402/)
