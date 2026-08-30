# Knoww MCP Worker

Knoww's remote Model Context Protocol server exposes a small set of read-only prediction-market tools for AI clients and agents. It runs as a dedicated Cloudflare Worker and reads public market data from Polymarket's Gamma and CLOB APIs through the shared `@knoww/services` package.

The code is a production release candidate. Knoww uses one remote MCP environment: production. Production traffic remains off until an approved operator provisions the Cloudflare resources, configures alerts, and performs the first attended production deployment. After that bootstrap release, Cloudflare Workers Builds deploys MCP-affecting merges to `main`; GitHub Actions remains a pre-merge quality gate.

For the full architecture and rollout plan, read [mcp.md](../../mcp.md). For the latest implementation record, read [mcp-implementation-report.md](../../mcp-implementation-report.md). Release operators should follow [OPERATIONS.md](OPERATIONS.md).

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

The Worker currently provides five tools:

- `search_markets`
- `get_market`
- `get_event`
- `get_orderbook`
- `get_price_history`

The implementation includes:

- Stateless Streamable HTTP at `/mcp`
- Legacy 2025-11-25 and modern 2026-07-28 MCP protocol support
- Host and Origin validation
- Development-only authentication bypass
- OAuth 2.1 authorization-code flow with S256 PKCE
- MCP protected-resource and authorization-server discovery
- Client ID Metadata Documents, plus rate-limited dynamic registration for compatibility
- Human wallet login and consent with atomic one-time challenges
- Audience-bound access and refresh tokens
- `markets:read` enforcement at the protected route and inside every tool
- Distributed rate limiting on authorization, token, and registration endpoints
- Edge, free-plan principal, and per-tool production quotas
- Production custom-domain configuration
- Public liveness and stateful-binding readiness probes
- Production security headers and full Workers Logs sampling
- Pre-parse body caps: 1 MiB for MCP and OAuth registration, and 64 KiB for OAuth token forms
- An HTTP OpenAPI contract, pull-request CI gate, and rollback runbook
- Strict tool input and output schemas with Zod
- Validation of untrusted Gamma and CLOB responses
- Decimal-string prices and Decimal.js arithmetic
- Upstream timeouts and caller cancellation
- Explicit output truncation signals
- Structured request IDs, provenance, and timestamps
- Safe errors and structured logging without raw upstream messages

It does not yet include:

- A non-wallet Knoww account login option
- Smart-contract-wallet signature verification
- Private user or tenant data
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
        | audience-bound token + markets:read
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
Polymarket Gamma API   Polymarket CLOB API
```

The MCP tools do not call Knoww's public Next.js API routes. Both the website and the MCP Worker use shared domain services from `packages/knoww-services`.

The Worker is separate from `apps/web` so it can have its own authentication secrets, quotas, deployment schedule, rollback path, and logs. Hono is not used because the current Worker has one MCP route and the MCP handler already owns the protocol routing.

MCP requests remain stateless and need no session affinity. A Durable Object is used only to create and atomically consume each five-minute wallet-consent challenge; it does not hold MCP sessions.

## Core dependencies

| Package | Version | Purpose |
|---|---|---|
| `agents` | `0.21.0` | Cloudflare's stateless MCP handler adapter |
| `@modelcontextprotocol/server` | `2.0.0` | Official MCP server implementation |
| `@cloudflare/workers-oauth-provider` | `0.10.3` | OAuth discovery, registration, grants, tokens, refresh, and revocation |
| `@knoww/services` | Workspace | Validated Gamma and CLOB service calls |
| `@knoww/logger` | Workspace | Structured logs |
| `@knoww/shared-types` | Workspace | Shared Polymarket parsers and types |
| `decimal.js` | Workspace catalog | Exact decimal parsing, comparison, and arithmetic |
| `viem` | Workspace catalog | EVM address normalization and EOA signature verification |
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
| `limit` | integer | Optional, 1 to 20, defaults to 10 |

The response contains event summaries, nested market summaries, outcome prices, nested total counts, and truncation flags. Search does not currently expose a cursor. When `meta.truncated` is true, narrow the query or category.

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
| `marketOffset` | integer | Optional, 0 to 10,000, defaults to 0 |
| `marketLimit` | integer | Optional, 1 to 50, defaults to 20 |

For `negRisk` parents, the tool fetches child events and merges their markets. Ordinary events do not trigger child-event fan-out. If a follow-up request fails, the tool keeps the parent event and marks the market list incomplete.

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

`asOf` is an ISO 8601 timestamp. `sources` identifies Polymarket Gamma or CLOB. `truncated` is true when Knoww caps a result. `get_event` also sets it when a failed or capped follow-up fetch leaves the market list incomplete.

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

The text result tells the caller whether retrying is appropriate. Raw upstream responses, error messages, stack traces, credentials, and request bodies are not returned.

## Quick start

Run commands from the repository root.

### 1. Install dependencies

```bash
cd /Users/nareshkatta/Desktop/Soclly/polycaster
pnpm install
```

The workspace declares `pnpm@10.25.0` in the root `package.json`.

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

The current baseline is 97 service tests and 133 MCP tests. The build command performs a Wrangler production dry run and writes its output to `apps/mcp/dist`.

Tests stub upstream fetches with a one-shot route table. They fail when an expected route is unused or code makes an unexpected outbound request.

## Manual testing

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
2. Copy an event slug into `get_event`.
3. Copy a market slug into `get_market`.
4. Copy an outcome token ID into `get_orderbook`.
5. Use the same token ID with `get_price_history`.

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

The MCP host opens `/authorize` in the user's browser. The user connects an injected EVM wallet and signs a five-minute, client-specific consent message. Knoww verifies that one-time signature, then the OAuth Provider issues a one-hour access token and a rotating refresh token with a 30-day lifetime. The model never receives a private key or wallet signature, and the signature is never reused as a Bearer credential.

The initial login path verifies EOA signatures. Smart-contract wallets need a separately tested EIP-1271 verification path before they can authorize.

Only `markets:read` is active and advertised. `x402:pay` is reserved for a future paid-tool phase but is currently rejected as `invalid_scope`. When it becomes active, it will mean “this client may attempt an x402-gated tool.” It will not authorize Knoww or the model to spend funds. The agent host must enforce its own budget and ask its wallet component to sign each payment proof.

`x402:pay` is a Knoww-defined OAuth scope, not part of the x402 protocol. Activation also depends on proving that supported MCP hosts can surface the x402 challenge and retry with the payment proof. The first paid tools should remain read-only and must bind each quote and proof to the principal, client, tool request, amount, asset, network, recipient, expiry, and one-time idempotency identifier.

Never enable `dev-bypass` in preview or production.

## Configuration

The checked-in Wrangler configuration contains non-secret deployment settings only.

| Variable | Purpose | Production value |
|---|---|---|
| `MCP_AUTH_MODE` | Selects fail-closed production behavior or local bypass | `oauth-required` |
| `MCP_CANONICAL_RESOURCE` | OAuth resource and token audience | `https://mcp.knoww.app/mcp` |
| `MCP_ALLOWED_HOSTNAMES` | Comma-separated Host allowlist | `mcp.knoww.app` |
| `MCP_ALLOWED_ORIGIN_HOSTNAMES` | Comma-separated browser Origin allowlist | `mcp.knoww.app,knoww.app,www.knoww.app` |

Required Cloudflare bindings:

| Binding | Purpose |
|---|---|
| `OAUTH_KV` | Provider-managed clients, grants, authorization codes, and hashed token records |
| `MCP_AUTH_CHALLENGES` | Durable Object namespace for atomic one-time wallet challenges |
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
```

This wallet-login implementation does not add a server secret. Any later identity-provider credentials, facilitator keys, or payment configuration must use Cloudflare secrets or secret bindings. Never commit them or place them in this README.

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
    context.ts               Request-scoped request ID and verified principal
    health.ts                Liveness and stateful-binding readiness probes
    quota.ts                 Edge, plan, principal, and tool quota enforcement
    auth/
      api.ts                 Verified OAuth props and route-level scope boundary
      challenge-store.ts     Atomic one-time wallet challenge Durable Object
      consent.ts             OAuth authorization and browser consent handlers
      provider.ts            Workers OAuth Provider configuration
      scopes.ts              Active and reserved scope definitions
      wallet.ts              SIWE-style message and EOA signature verification
    errors/
      tool-error.ts          Safe tool error model and logging
    tools/
      search-markets.ts
      get-market.ts
      get-event.ts
      get-orderbook.ts
      get-price-history.ts
      gamma.ts               Shared Gamma projections and lifecycle rules
      decimal.ts             Decimal-string conversion
      meta.ts                Shared metadata and tool annotations
    tests/
      helpers.ts             Worker dispatch and upstream fetch stubs
      worker.test.ts         Transport and Worker boundary coverage
      get-*.test.ts          Tool integration coverage

packages/knoww-services/
  src/
    fetch-options.ts         Caller cancellation and upstream timeouts
    validation.ts            Shared Zod and Decimal.js validators
    markets/                 Gamma and CLOB service implementations
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
- Keep wallet consent challenges short-lived and atomically one-time.
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
```

Tool failure logs contain only the tool name, request ID, normalized error code, and retryability. They do not contain the raw exception message or stack.

When debugging a request, start with `x-request-id`, then find the matching structured log line.

## Deployment status

The repository now contains the production route, OAuth and quota bindings, probes, PR quality gate, HTTP contract, and rollback commands. GitHub Actions validates every pull request but never deploys. After the bootstrap release, Cloudflare Workers Builds is the only automatic production deployer and runs for MCP-affecting merges to `main`.

There is no remote staging Worker. The first live CIMD, DCR, wallet OAuth, quota, and tool checks run against production immediately after the first attended deployment. Protect `main` so `MCP CI / quality` is required and direct pushes are blocked. Follow [OPERATIONS.md](OPERATIONS.md) for the exact release checks, monitoring thresholds, Cloudflare build settings, and rollback commands.

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

### `403` with an invalid Host or Origin

Use `http://localhost:8787/mcp` or `http://127.0.0.1:8787/mcp`. Browser requests must send an Origin whose hostname appears in `MCP_ALLOWED_ORIGIN_HOSTNAMES`. Origin-less desktop requests are allowed.

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
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP Streamable HTTP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx)
- [x402 HTTP 402 concepts](https://docs.x402.org/core-concepts/http-402)
- [x402 V2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [Cloudflare Agents x402 payments](https://developers.cloudflare.com/agents/tools/payments/x402/)
