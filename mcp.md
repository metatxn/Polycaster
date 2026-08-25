# Knoww MCP server architecture and implementation plan

Status: Accepted for implementation

Date: 2026-08-25

Audience: Engineers and coding agents implementing the Knoww MCP server

## Purpose

Knoww will expose a curated set of prediction-market capabilities through a remote Model Context Protocol server. Users will connect their AI clients and agents to Knoww, authorize limited access, and call typed tools for market discovery, market data, trader research, and later user-specific portfolio operations.

This document records the architecture decision and gives implementation agents enough detail to begin work without reopening the framework choice.

## Decision summary

Build a dedicated Cloudflare Worker at `mcp.knoww.app` with one stable MCP endpoint:

```text
https://mcp.knoww.app/mcp
```

Use:

- `createMcpHandler` from `agents/mcp/server`
- The stable v2 package `@modelcontextprotocol/server`
- Stateless Streamable HTTP
- Cloudflare's Workers OAuth Provider for production authentication and authorization
- Zod 4 for tool input and output schemas
- Shared Knoww services for market and user data
- `@knoww/logger` for structured logs
- Cloudflare Rate Limiting bindings for abuse controls

Do not add Hono in the first implementation. Add it only if the Worker later needs several custom routes or substantial middleware beyond the MCP and OAuth handlers.

Do not use:

- `McpAgent` for a new server
- `createLegacyMcpHandler` for the primary endpoint
- The v1 `@modelcontextprotocol/sdk` package for new server code
- Deprecated HTTP plus SSE transport
- FastMCP or Mastra as the server foundation
- A one-to-one wrapper around every existing `/api` route

## Product defaults

These defaults apply until the product owner changes them in writing:

- Production requests require OAuth, including read-only calls.
- Local development may use an explicit development-only authentication bypass.
- Version 1 exposes read-only tools only.
- Version 1 has no subscriptions or cross-isolate notifications.
- Version 1 does not place, cancel, sign, relay, or settle trades.
- The MCP URL remains `/mcp`. Do not create `/mcp/v2`.
- The server keeps compatibility with ordinary 2025-era stateless clients unless tests show a security or maintenance reason to set `legacy: "reject"`.
- Tool contracts are small, typed, paginated, and additive.

## Current Knoww context

Knoww is a pnpm monorepo with:

- `apps/web`, a Next.js 15 App Router application deployed to Cloudflare Workers through OpenNext
- `apps/extension`, the browser extension
- `apps/agent`, the paper and live trading engine used by the internal operator dashboard
- `packages/logger`, the shared structured logger
- `packages/shared-types`, shared Polymarket, trading, chain, contract, and validation types

The current web API is a backend-for-frontend. It has many Next.js route handlers under `apps/web/src/app/api`. Some routes normalize upstream data, while others proxy opaque upstream objects. This API is built for Knoww's web and extension clients. It is not a stable public agent contract.

Important existing security boundaries:

- `/api/agent/*` uses an internal admin token and must stay private.
- Extension sessions use a token audience of `knoww-extension` and extension-specific scopes. Those tokens must not authenticate public MCP clients.
- Relayer, signing, raw RPC, API-key derivation, analytics, image proxy, and internal AI routes must not become MCP tools.
- The existing application rate limiter is process-local. It is not sufficient as the only limit for a public multi-isolate MCP service.
- All monetary calculations must use Decimal.js and decimal strings. JavaScript floating point is forbidden for money, prices, shares, fees, PnL, and notional amounts.

## Why this architecture

### Cloudflare handler and official SDK

Cloudflare recommends `createMcpHandler` from `agents/mcp/server` for new stateless MCP servers. It adapts the official v2 server factory to the Workers request model and adds route, Host, Origin, and CORS handling.

The official v2 SDK implements the 2026-07-28 protocol. Its stateless handler creates a fresh MCP server from the factory for each request. This removes protocol session affinity. It does not mean Cloudflare creates a fresh Worker isolate for every request.

### Dedicated Worker

The existing web Worker could branch `/mcp` before the OpenNext handler, but the public MCP service has different operational needs:

- Separate OAuth secrets and permissions
- Independent deployment and rollback
- Tool-specific limits and quotas
- A smaller failure and security boundary
- MCP-specific logs and dashboards
- No coupling to OpenNext routing or release cadence

The dedicated Worker is therefore the production choice. A short-lived local prototype may run in the existing Worker, but production code should target `apps/mcp`.

### No Hono initially

Hono is a router and middleware framework. It does not provide MCP semantics or make the server stateless. The Cloudflare MCP handler already handles the initial `/mcp` route and its protocol requirements.

Add Hono only when the Worker needs custom routes such as several webhook endpoints, private administration endpoints, or a larger middleware pipeline. OAuth endpoints by themselves do not justify Hono because the OAuth Provider already routes those requests.

### Shared services, not route-to-route calls

MCP tools must call reusable Knoww services. They must not fetch Knoww's public Next.js `/api` routes over the network.

Target dependency direction:

```text
Web route handler ─┐
                   ├──> Knoww service ──> provider client or storage
MCP tool handler ──┘
```

This boundary keeps provider calls, validation, normalization, caching, and business rules out of MCP handlers. It also prevents web response quirks from becoming permanent public MCP behavior.

## Proposed repository layout

Create the MCP Worker and extract shared services one vertical slice at a time:

```text
apps/
  mcp/
    package.json
    tsconfig.json
    wrangler.jsonc
    src/
      index.ts
      server.ts
      auth/
        principal.ts
        scopes.ts
      errors/
        tool-error.ts
      tools/
        search-markets.ts
        get-market.ts
        get-event.ts
        get-orderbook.ts
        get-price-history.ts
      observability/
        tool-telemetry.ts
      tests/

packages/
  knoww-services/
    package.json
    tsconfig.json
    src/
      markets/
      events/
      orderbook/
      prices/
      traders/
      whales/
      errors.ts
      index.ts
```

Do not move all web API logic at once. For each tool:

1. Identify the existing web route and supporting helpers.
2. Add contract tests around its current intended behavior.
3. Extract the reusable provider and normalization logic into `packages/knoww-services`.
4. Switch the web route to the shared service without changing its response contract.
5. Add the MCP adapter with a separate, agent-friendly contract.
6. Run web and MCP tests before moving to the next tool.

If a reusable service already belongs in `packages/shared-types` or `apps/agent`, use the existing package instead of duplicating it. Do not import from `apps/web` into `apps/mcp`; applications must not depend on each other.

## Dependency policy

The new `apps/mcp` package should directly depend on:

```text
agents
@modelcontextprotocol/server@2.0.0
@cloudflare/workers-oauth-provider
@knoww/logger
@knoww/shared-types
@knoww/services
decimal.js
zod
```

Requirements:

- Pin the selected `agents` and OAuth Provider versions exactly.
- Use the exact MCP version required by that `agents` release.
- Keep the lockfile committed.
- Do not import `@modelcontextprotocol/server` through another package.
- Do not use a transitive dependency as the MCP implementation.
- Verify the dependency tree after installation.

The current lockfile contains a transitive `@modelcontextprotocol/server@2.0.0-alpha.4` through the `accounts` dependency chain. The MCP Worker must use a direct stable dependency. It must never import the alpha package accidentally.

The workspace currently uses TypeScript 6.0.3, Zod 4.4.3, Wrangler 4.123.0, and Node 20.19 or newer. The SDK v2 TypeScript declarations reference Node types, so the MCP package must include `node` in its TypeScript `types` configuration if required by the installed package.

## Runtime architecture

```text
AI client
   |
   v
mcp.knoww.app/mcp
   |
   v
OAuth token validation and consent scopes
   |
   v
Host, Origin, body-size, and rate-limit checks
   |
   v
createMcpHandler from agents/mcp/server
   |
   v
Official MCP SDK v2 server
   |
   v
Thin tool adapter
   |
   v
Knoww shared service
   |
   +--> Polymarket and approved upstream APIs
   +--> D1, KV, R2, or Durable Objects where appropriate
   +--> Existing Knoww trading services only in a future write phase
```

### Storage responsibilities

Use each Cloudflare storage product for its intended job:

| Product | Suitable MCP use |
| --- | --- |
| D1 | Relational users, grants, audit records, durable idempotency records, saved agent configuration |
| KV | Read-heavy configuration and caches where eventual consistency is acceptable |
| R2 | Large exports, snapshots, and files |
| Durable Objects | Strong coordination for per-user or per-resource workflows, strict concurrency, and future live operations |
| Rate Limiting binding | Fast abuse controls and tier limits, not billing or exact accounting |

Do not keep correctness-critical state in module variables. Worker isolate memory may cache immutable configuration or compiled schemas, but it is disposable and may serve concurrent requests.

## Handler shape

There are two current functions named `createMcpHandler`:

| Import | Role |
| --- | --- |
| `agents/mcp/server` | Cloudflare Worker wrapper. Use this for Knoww. |
| `@modelcontextprotocol/server` | Runtime-neutral web-standard handler. Use only if Knoww later needs direct control such as a custom distributed event bus. |

Always include the import path in implementation discussions and reviews.

The Cloudflare API is:

```ts
createMcpHandler(factory, options?)
```

It returns a callable handler. The callable receives:

```ts
handler(request, env, ctx)
```

Do not pass `request`, `env`, or `ctx` as the first arguments to `createMcpHandler`.

The following sketch shows the intended boundary. It is not a copy-paste OAuth implementation. The exact OAuth Provider adapter must match the pinned package's current type definitions and official stateless example.

```ts
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { createLogger } from "@knoww/logger";

const log = createLogger("mcp.worker");

const handler = createMcpHandler(
  ({ authInfo }) =>
    createKnowwMcpServer({
      bindings: env,
      principal: principalFromVerifiedAuthInfo(authInfo),
    }),
  {
    route: "/mcp",
    allowedHostnames: ["mcp.knoww.app"],
    allowedOriginHostnames: ["knoww.app", "www.knoww.app"],
    onerror(error) {
      log.error("request.unhandled", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    },
  }
);

const mcpApiHandler = {
  fetch(request: Request, workerEnv: Env, ctx: ExecutionContext) {
    return handler(request, workerEnv, ctx);
  },
};
```

Rules for the real implementation:

- The OAuth Provider must validate tokens before invoking the MCP handler.
- `principalFromVerifiedAuthInfo` must reject missing or malformed verified identity in production.
- Never trust an `AuthInfo` object built from unverified request headers.
- Never log or return `authInfo.token` or OAuth application properties.
- Origin-less desktop and server-side MCP clients are valid. Do not reject a request only because it lacks `Origin`.
- Validate every present browser Origin and the Host header.
- Use environment-specific Host and Origin allowlists for local, preview, and production deployments.
- Module scope is safe for version 1 and becomes necessary if subscriptions or `handler.notify` are added later. Version 1 does not need notifications.
- Importing `env` from `cloudflare:workers` is supported, but shared services should accept explicit dependencies where practical so unit tests remain simple.

## OAuth and authorization

### Production rule

Every production MCP request must carry a valid OAuth access token issued for the Knoww MCP resource. `createMcpHandler` does not verify tokens. The Workers OAuth Provider or another trusted authentication layer must perform that work.

### Resource identity

Use this canonical protected resource unless the installed OAuth library requires a documented variation:

```text
https://mcp.knoww.app/mcp
```

Tokens must be audience-bound to the MCP resource. Do not accept:

- Knoww extension session tokens
- Agent admin tokens
- Polymarket API credentials
- Wallet signatures as reusable bearer tokens
- Tokens issued for another Knoww service

### Authentication and consent

Knoww may reuse its wallet login or account login to authenticate the person in the browser. After authentication, the OAuth consent page must show the MCP client and requested scopes. The MCP Worker then issues its own bound access token to the MCP client.

A wallet signature may prove account ownership during login. It must not become the long-lived MCP credential.

### Required metadata

Implement the discovery and metadata required by the current MCP authorization specification and the pinned Workers OAuth Provider. At minimum, verify:

- Protected Resource Metadata for the MCP resource
- Authorization Server Metadata or OpenID Connect discovery
- PKCE for public clients
- Resource and audience binding
- Issuer validation
- Refresh-token handling if refresh tokens are issued
- Client metadata or registration behavior supported by the pinned library
- Correct `WWW-Authenticate` metadata on `401` responses

Do not invent OAuth endpoint behavior from memory. Follow the installed provider version's official documentation and compile against its exact types.

### Scope model

Initial scopes:

| Scope | Allows |
| --- | --- |
| `markets:read` | Search and read events, markets, prices, order books, and history |
| `traders:read` | Read public trader profiles, positions, trades, and PnL |
| `whales:read` | Read whale and suspicious-activity analysis |
| `portfolio:read` | Read the authenticated user's private Knoww portfolio data in a later phase |
| `orders:read` | Read the authenticated user's order state in a later phase |
| `trade:intent:create` | Create a non-executing trade intent in a later phase |
| `trade:execute` | Execute an approved trade in a future separately reviewed phase |

Scope rules:

- Return only tools allowed by the caller's granted scopes.
- Recheck the required scope inside each tool handler.
- Authentication does not grant all tools.
- A client with `markets:read` cannot infer `portfolio:read` data through another tool.
- Administrative operations are never available through public MCP scopes.
- Scope changes must take effect within the documented token lifetime or through an immediate entitlement check.

### Revocation and entitlement checks

Do not rely only on eventually consistent KV for immediate account disablement, permission removal, paid-credit deduction, or trading authorization. Use a strongly consistent store or a durable per-user coordinator where immediate correctness matters. Short token lifetimes can reduce exposure but do not replace authorization checks for high-risk tools.

## Tool design rules

### Curate tools around user goals

Do not expose the full REST schema. Tools should represent tasks an agent understands:

- Search prediction markets
- Read one market and its current state
- Read an event and its markets
- Inspect an order book
- Retrieve price history
- Research a public trader
- Review whale activity

Avoid low-level tools that force the model to reconstruct Knoww's internal call graph.

### Contract requirements

Every tool must have:

- A unique stable name using lowercase words and underscores
- A plain description that says when to use the tool
- A strict Zod input schema
- A strict output schema
- Input and output examples in tests or documentation
- A maximum result size
- Pagination for lists
- Deterministic ordering
- A timeout and cancellation path
- Explicit tool annotations
- A required OAuth scope
- Structured error mapping
- Provenance and `asOf` timestamps for time-sensitive market data

Successful results should provide structured content and a concise text fallback for clients that do not consume structured content.

### Common response metadata

All successful data tools should include:

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

Rules:

- `asOf` is an ISO 8601 timestamp.
- `sources` names the upstream system used for the result.
- `nextCursor` is opaque. Clients must not parse it.
- `truncated` is true when Knoww enforced an output cap.
- Do not claim that Knoww is the settlement authority. Polymarket's official market and settlement infrastructure remains authoritative.

### Decimal and time representation

- Return prices, shares, notional, fees, balances, and PnL as canonical decimal strings.
- Use Decimal.js for arithmetic.
- Never return a JavaScript-calculated floating-point monetary value.
- Use ISO 8601 UTC timestamps for time.
- Include the source timestamp when the upstream API provides one.

### Untrusted upstream content

Treat every upstream API response as untrusted input. Validate it before using it.

Market descriptions, resolution rules, comments, news, and social content may contain instruction-like text. MCP handlers must return them as quoted data with provenance. They must never interpret upstream text as instructions for the server or bypass authorization because an upstream field asks them to.

### Tool annotations

Read-only data tools should normally use:

```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}
```

Annotations are client hints. They do not enforce security. OAuth scopes, server-side checks, confirmation flows, and idempotency records are the controls.

## Version 1 tool catalog

### Priority 0 tools

Implement these first:

| Tool | Scope | Purpose | Key inputs | Result |
| --- | --- | --- | --- | --- |
| `search_markets` | `markets:read` | Find active or closed markets from a user query and filters | `query`, `status`, `category`, `limit`, `cursor` | Ranked market summaries with pagination |
| `get_market` | `markets:read` | Read one market by slug, condition ID, or token ID | Exactly one identifier | Normalized market details, outcomes, prices, dates, and resolution source |
| `get_event` | `markets:read` | Read an event and its child markets | Event slug or ID | Event metadata and paginated market summaries |
| `get_orderbook` | `markets:read` | Inspect current bids and asks for one token | `tokenId`, optional depth | Bids, asks, spread, midpoint, and source timestamp |
| `get_price_history` | `markets:read` | Read historical prices for one token | `tokenId`, range, fidelity, limit, cursor | Ordered price points and pagination |

### Priority 1 tools

Implement after the Priority 0 contract is stable:

| Tool | Scope | Purpose |
| --- | --- | --- |
| `get_trader_profile` | `traders:read` | Read a public trader profile by wallet address |
| `get_trader_positions` | `traders:read` | Read public positions with pagination |
| `get_trader_trades` | `traders:read` | Read public trade history with pagination |
| `get_trader_pnl` | `traders:read` | Read normalized public PnL and history |
| `get_whale_activity` | `whales:read` | Read large-trader activity with explicit filters |
| `get_suspicious_activity` | `whales:read` | Read Knoww's scored suspicious-activity analysis with methodology metadata |

### Deferred user-specific tools

Do not add these until OAuth identity mapping and private-data authorization pass security review:

- `get_my_portfolio`
- `get_my_positions`
- `get_my_orders`
- `get_my_trade_history`
- `get_my_alerts`

### Deferred action tools

Do not add these in version 1:

- `create_trade_intent`
- `approve_trade_intent`
- `submit_trade`
- `cancel_order`
- `claim_position`
- `withdraw_funds`
- Any signing or relayer tool

## Tool-specific contract notes

### `search_markets`

Input rules:

- Trim the query.
- Require at least one non-whitespace character.
- Cap query length.
- Use enum filters for status and known categories.
- Default to active markets unless the caller requests another status.
- Cap `limit` to a small agent-friendly maximum.
- Use an opaque cursor rather than page numbers.

Result rules:

- Return compact summaries, not full upstream records.
- Include stable market identifiers, title, outcomes, current prices, status, start/end dates, liquidity or volume when available, and canonical Knoww or Polymarket URLs.
- State which fields may be missing.
- Rank deterministically when scores tie.

### `get_market`

Input rules:

- Accept exactly one of `slug`, `conditionId`, or `tokenId`.
- Reject ambiguous requests containing several identifiers.
- Validate identifier length and format before an upstream call.

Result rules:

- Return normalized outcome labels and token IDs.
- Return price values as decimal strings.
- Include resolution rules and source as untrusted quoted data.
- Distinguish active, closed, resolved, and unknown states.
- Do not infer resolution when the authoritative upstream state is missing.

### `get_event`

- Return event metadata separately from child markets.
- Paginate child markets.
- Preserve canonical market identifiers.
- Do not duplicate full market payloads when compact summaries are enough.

### `get_orderbook`

- Validate token IDs before calling CLOB.
- Cap book depth.
- Return levels in deterministic best-to-worst order.
- Use decimal strings for price and size.
- Calculate spread, midpoint, and depth with Decimal.js.
- Mark the result stale if its source timestamp exceeds the product threshold.

### `get_price_history`

- Bound the date range and point count.
- Validate fidelity against supported values.
- Return points in ascending timestamp order.
- Paginate or downsample large histories rather than returning unbounded arrays.
- State whether values came from trades, midpoint samples, or another upstream series.

## Resources and prompts

Version 1 should ship tools only. Add MCP resources or prompts after client testing shows a clear use case.

Possible later resources:

```text
knoww://markets/{slug}
knoww://events/{slug}
knoww://traders/{address}
```

Possible later prompts:

- Compare two markets without making a trading recommendation
- Summarize an event's resolution criteria
- Review a trader's public history with clear uncertainty

Do not add prompts merely to increase the feature count. Agent hosts can already compose tool calls.

## Error contract

### Error categories

Use stable machine-readable codes:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `VALIDATION_ERROR` | Input failed schema or semantic validation | No |
| `UNAUTHENTICATED` | Missing or invalid verified identity | No, authenticate first |
| `FORBIDDEN` | Valid identity lacks the required scope | No, request consent |
| `NOT_FOUND` | Requested event, market, token, or trader was not found | No |
| `RATE_LIMITED` | Caller exceeded a limit or quota | Yes, after the stated delay |
| `CONFLICT` | Idempotency or state conflict | Sometimes |
| `UPSTREAM_TIMEOUT` | Approved upstream did not answer in time | Yes |
| `UPSTREAM_UNAVAILABLE` | Approved upstream failed or returned invalid data | Yes |
| `INTERNAL_ERROR` | Unexpected server failure | Sometimes |

### Error behavior

- Set `isError: true` for tool execution failures.
- Return one concise text block that tells the agent what failed and whether retrying makes sense.
- Do not expose stack traces, SQL, bindings, secrets, raw provider errors, or internal paths.
- Log the internal error with a request ID through `@knoww/logger`.
- Include a safe retry delay for rate limits where available.
- Keep validation error details bounded.
- Use HTTP `401` and `403` for transport-level authentication and authorization failures before tool execution.
- Use HTTP `429` for request-level rate limits before MCP dispatch.

## Rate limiting and quotas

### Required layers

Use at least two layers:

1. Cloudflare edge or WAF controls for unauthenticated floods and malformed traffic.
2. A Workers Rate Limiting binding after authentication for user, client, and tool-class limits.

Suggested rate-limit key:

```text
userId:clientId:toolClass
```

Do not use IP address as the primary authenticated quota key. Many legitimate users share IP addresses.

### Initial configurable limits

Treat these as rollout defaults, not permanent product promises:

| Class | Example tools | Initial limit |
| --- | --- | --- |
| Discovery | Server and tool discovery | 120 calls per minute per client |
| Standard read | Market, event, price, trader reads | 60 calls per minute per user and client |
| Expensive analysis | Whale and suspicious-activity tools | 10 calls per minute per user and client |
| Future write | Intent creation or order actions | 5 calls per minute plus a concurrency limit |

The Workers Rate Limiting API is permissive and eventually consistent within a Cloudflare location. Use it for abuse controls. Do not use it as the source of truth for billing, prepaid credits, daily trading caps, or exact usage accounting.

## Caching

- Cache read-only provider responses only when the product can tolerate the chosen staleness.
- Include `asOf` in every time-sensitive response.
- Use different TTLs for static metadata, market prices, order books, and trader history.
- Never cache private responses under a key that omits the user or tenant.
- Never cache OAuth responses, access tokens, signing material, or write results in a shared public cache.
- Do not use Worker module memory as the only cache for correctness.
- Preserve upstream cache headers only when they match Knoww's privacy and freshness rules.

## Security requirements

### Boundary validation

- Validate every tool input with Zod.
- Apply semantic checks after schema validation.
- Validate every upstream response before normalization.
- Cap request body size before parsing.
- Bound arrays, strings, date ranges, depth, and pagination limits.
- Use allowlists for outbound hosts and URL-based inputs.
- Reject private, loopback, link-local, and metadata service addresses in any future URL-fetching tool.

### Data isolation

- Derive the user and tenant from verified server-side authentication context.
- Never accept a caller-supplied `userId` or tenant ID as authorization.
- Public trader tools may accept wallet addresses because the data is public. Private portfolio tools must ignore caller-supplied ownership claims.
- Check scopes before accessing user data and again before any write.

### Secrets

- Keep OAuth secrets and provider credentials in Cloudflare secrets or secret bindings.
- Never return secrets in tool output.
- Never log tokens, wallet signatures, private keys, API keys, cookies, or authorization headers.
- Do not read or modify real secret files during implementation. Use safe examples and documentation only.
- Give the MCP Worker only the bindings it needs.
- Keep signing keys and relayer secrets outside the MCP Worker.

### Trading safety for future phases

Any future live trading implementation requires a separate design and security review. At minimum it must have:

- A non-executing intent stage
- Clear user confirmation outside the model-generated text
- Scope `trade:execute`
- A UUID idempotency key bound to the complete trade intent
- Durable replay protection
- Decimal.js calculations for every amount
- Per-order and daily notional caps
- Token and condition allowlists where applicable
- Slippage and price bounds
- Partial-fill accounting
- Durable audit records
- Emergency stop and dry-run controls
- No private key or reusable CLOB credential in MCP output

Tool annotations and model confirmations do not replace these controls.

## Observability

Use `@knoww/logger`. Do not add `console.log`, `console.error`, or ad hoc JSON logging.

Recommended events:

```text
mcp.request.started
mcp.request.finished
mcp.request.failed
mcp.auth.denied
mcp.scope.denied
mcp.rate_limited
mcp.tool.started
mcp.tool.finished
mcp.tool.failed
mcp.upstream.failed
```

Safe fields:

- Request ID
- Tool name
- Hashed or internal user identifier
- OAuth client ID when safe
- Granted scope names
- Duration in milliseconds
- Result count
- Cache hit or miss
- Upstream provider name
- Safe upstream status category
- Outcome and retryability

Do not log:

- Access or refresh tokens
- Authorization headers
- OAuth application properties that contain secrets
- Wallet signatures or private keys
- Full request bodies by default
- Full tool output
- Upstream payloads that may contain personal data

Required metrics:

- Requests per tool and client
- Success, validation failure, authorization failure, rate limit, and upstream failure counts
- p50, p95, and p99 tool latency
- Upstream latency and timeout counts
- Output truncation counts
- Cache hit ratio
- OAuth flow failures

## Notifications and subscriptions

Version 1 does not support subscriptions.

Cloudflare's `agents/mcp/server` notifications are isolate-local. A notification published in one Worker isolate cannot reach a subscription stream in another isolate.

If a product requirement later needs live cross-isolate updates, make a new architecture decision before implementation. Options include:

- Keep request-response tools and let clients poll
- Use the upstream `@modelcontextprotocol/server` handler with a custom distributed `ServerEventBus`
- Build a Cloudflare-specific event system with Durable Objects, Queues, or another broker

Do not claim cross-isolate delivery until an integration test proves it.

## Implementation phases

### Phase 0: Contract and scaffold

Deliverables:

- Create `apps/mcp` with package, TypeScript, Wrangler, lint, test, typecheck, dev, and deploy scripts.
- Add exact compatible dependencies.
- Generate Worker binding types.
- Add the server factory and one local-only health check through tests, not a public route unless needed.
- Add structured logging and request IDs.
- Add the shared error types.
- Add CI commands through the existing recursive workspace scripts.
- Confirm no direct dependency on `apps/web`.

Acceptance criteria:

- The Worker builds and starts locally.
- MCP Inspector can discover the server.
- The modern 2026 protocol path succeeds.
- Ordinary legacy stateless discovery or tool calls behave as configured.
- Invalid Host and present invalid Origin requests fail.
- No authentication bypass exists outside local development.

### Phase 1: Shared market services and Priority 0 tools

Implement one vertical slice at a time in this order:

1. `search_markets`
2. `get_market`
3. `get_event`
4. `get_orderbook`
5. `get_price_history`

For each slice:

- Extract or add a shared Knoww service.
- Validate upstream responses.
- Keep the existing web route behavior stable.
- Add strict MCP input and output schemas.
- Add pagination or result caps.
- Add tool annotations.
- Add unit, contract, and integration tests.
- Add safe structured telemetry.

Acceptance criteria:

- Every tool returns structured content and a text fallback.
- Every monetary value is a decimal string.
- Every result has provenance and `asOf` metadata.
- Error responses contain no stack traces or raw upstream payloads.
- No tool calls a Knoww public REST route over the Internet.

### Phase 2: OAuth, scopes, and production limits

Deliverables:

- Add the Workers OAuth Provider using its current stateless handler pattern.
- Add protected-resource and authorization metadata.
- Add the consent screen and identity mapping.
- Require OAuth in production.
- Filter tools by granted scopes.
- Recheck scopes inside handlers.
- Add Workers Rate Limiting bindings.
- Add production Host and Origin allowlists.
- Add auth, quota, and redaction tests.

Acceptance criteria:

- An unauthenticated client receives the required `401` metadata.
- A valid token works only for its intended MCP resource.
- A token with `markets:read` cannot call trader or whale tools.
- Extension and admin tokens are rejected.
- Tokens and OAuth properties never appear in logs or results.

### Phase 3: Priority 1 public research tools

Add public trader and whale tools only after Priority 0 usage data is available.

Acceptance criteria:

- Wallet addresses are normalized and validated.
- List results are paginated.
- Suspicious-activity results explain Knoww's score and uncertainty.
- Expensive tools have stricter limits and timeouts.
- Upstream personal data is minimized.

### Phase 4: Private user reads

Add private portfolio and order reads after a security review of identity and tenant isolation.

Acceptance criteria:

- The server derives ownership from verified authentication context.
- Cross-user access tests fail closed.
- Private results never enter public caches.
- Audit logs identify access without storing returned financial data.

### Phase 5: Trade intents

Add only a non-executing `create_trade_intent` tool after a separate product and security specification.

The intent must be reviewable in Knoww and must expire. It must not sign or submit an order.

### Phase 6: Live actions

Live actions require a new ADR, threat model, security review, rollout plan, and explicit approval. This document does not authorize live trading implementation.

## Test plan

### Unit tests

- Input schema boundaries
- Mutually exclusive identifiers
- Decimal calculations and serialization
- Cursor encoding and decoding
- Deterministic ordering
- Error mapping and retryability
- Scope checks
- Output truncation
- Upstream response validation
- Prompt-injection-like upstream strings remain inert data

### Worker integration tests

- Modern Streamable HTTP request and response
- Legacy stateless compatibility or explicit rejection
- Discovery and tool listing
- Tool call with structured content
- Invalid method, content type, body, Host, and Origin handling
- Request size limit
- Cancellation and timeout behavior
- Rate-limit behavior
- OAuth `401`, valid token, invalid audience, expired token, and insufficient scope

Use a Workers-native test runtime so D1, KV, R2, Rate Limiting, and service bindings behave like production where those bindings are involved.

### Contract tests

- Snapshot tool names, descriptions, annotations, and schemas.
- Fail on accidental tool removal or incompatible schema change.
- Allow additive optional fields.
- Assert list ordering remains deterministic.
- Assert every list tool has pagination and a maximum limit.

### End-to-end tests

- Connect with MCP Inspector.
- Connect with at least two supported remote MCP hosts.
- Complete OAuth consent.
- Call every granted Priority 0 tool.
- Verify a denied tool is absent or fails with `FORBIDDEN`.
- Confirm logs contain request IDs but no tokens or payload secrets.

### Security tests

- Cross-user authorization attempts
- Scope escalation attempts
- Forged `AuthInfo` or bearer headers
- Token audience confusion
- Invalid and opaque Origins
- Host-header confusion
- Oversized strings and arrays
- SSRF attempts through URL fields
- Upstream HTML or instruction text in data fields
- Stack-trace and secret leakage
- Replayed future write requests

### Load tests

- Concurrent read calls across several Worker isolates
- Expensive whale queries under their lower limit
- Upstream timeout and retry storms
- Output and memory caps
- No reliance on module memory for user or quota correctness

## Agent implementation rules

Every implementation agent must:

1. Read `AGENTS.md`, this document, `docs/ARCHITECTURE.md`, and the relevant sections of `docs/API.md` before editing.
2. Check `git status` and preserve unrelated user changes.
3. Never read, print, modify, summarize, or infer values from real secret or environment files.
4. Use safe example files and documentation for environment variable names.
5. Verify the installed framework API against the official sources listed below before writing version-sensitive code.
6. Use `apply_patch` for source edits.
7. Add tests before or with behavioral changes.
8. Use `@knoww/logger` and avoid console logging.
9. Validate all external input and upstream responses.
10. Add OpenAPI annotations to any new conventional REST endpoints. The MCP protocol endpoint follows MCP schemas rather than an invented REST contract.
11. Add rate limiting to every new public route or tool class.
12. Never expose internal errors or stack traces.
13. Use Decimal.js for all monetary calculations.
14. Add durable idempotency to every future payment or trading mutation.
15. Keep each change incremental. Do not refactor unrelated routes while adding one tool.

## Pull request sequence

Prefer small pull requests in this order:

1. MCP Worker scaffold and dependency pins
2. Shared error and response contracts
3. `search_markets` service extraction and tool
4. `get_market` service extraction and tool
5. `get_event` service extraction and tool
6. `get_orderbook` service extraction and tool
7. `get_price_history` service extraction and tool
8. OAuth Provider and scope enforcement
9. Distributed rate limits and production deployment configuration
10. Production end-to-end tests and observability dashboards

Do not combine OAuth, all tools, a large web refactor, and deployment into one pull request.

## Definition of done for version 1

Version 1 is complete when:

- `mcp.knoww.app/mcp` is deployed through a dedicated Worker.
- The server uses `agents/mcp/server` and official SDK v2.
- Production access requires OAuth.
- Priority 0 tools pass unit, integration, contract, and end-to-end tests.
- Tool inputs and outputs have strict schemas.
- Results include provenance and timestamps.
- All values representing money or market quantities are decimal strings.
- Invalid scopes fail closed.
- The server enforces Host, Origin, body-size, timeout, output-size, and rate limits.
- Logs and metrics are available without secret or payload leakage.
- Existing Knoww web behavior remains unchanged.
- No admin, relayer, signing, raw RPC, internal AI, analytics, or extension-session capability is exposed.
- The MCP Inspector and supported agent clients can discover and call the granted tools.
- The public documentation explains connection, OAuth consent, scopes, quotas, tool contracts, and support policy.

## Product questions that do not block the scaffold

The scaffold and Priority 0 contracts can begin while product owners decide:

- Which account or wallet login appears on the OAuth consent page
- Whether free and paid users receive different quotas
- Which remote MCP clients Knoww officially supports at launch
- Whether public trader and whale tools ship in version 1 or the next release
- Data retention for OAuth grants and tool audit records
- Whether anonymous public read access is ever offered outside production OAuth

Use the defaults in this document until those decisions change.

## Official sources

Framework and protocol decisions in this document are based on these primary sources:

- [Cloudflare MCP handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
- [Cloudflare remote MCP server guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Cloudflare Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare Workers binding access](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
- [Cloudflare service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Official MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Official SDK `createMcpHandler` reference](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/createMcpHandler.html)
- [Official SDK protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)
- [Official SDK server notification guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/notifications.md)
- [MCP Streamable HTTP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP tool specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

Implementation agents must recheck version-sensitive APIs against these sources and the pinned package type definitions. If the docs and installed types disagree, stop and document the conflict before choosing a pattern.
