# Knoww MCP implementation report

Date: 2026-08-26

Branch: `mcp`

Plan: [mcp.md](mcp.md)

## Status

The implementation provides five read-only tools from a dedicated Cloudflare Worker in `apps/mcp`: `search_markets`, `get_market`, `get_event`, `get_orderbook`, and `get_price_history`. Production-shaped requests pass through an OAuth 2.1 authorization-code flow with Google OpenID Connect, S256 PKCE, audience-bound tokens, and `markets:read` enforcement.

The code is a production release candidate. The repository contains one remote MCP environment: production. It has a custom-domain route, layered quotas, health probes, security headers, an MCP-specific PR gate, an HTTP contract, and a rollout and rollback runbook. Production traffic remains off until an approved operator verifies Cloudflare resources and alerts and performs the first attended deployment. After that bootstrap release, Cloudflare Workers Builds owns production deployment from `main`; GitHub Actions remains verification-only. Only the explicit local environment enables the development bypass.

## Verification

| Target | Result |
|---|---|
| `apps/mcp` tests | 136/136 across 13 files |
| `apps/mcp` typecheck and Biome | Pass |
| MCP protocol coverage | Legacy `initialize` at 2025-11-25 and modern `server/discover` at 2026-07-28 both pass |
| Worker dry-run | Pass; the production OAuth bundle builds with no environment-selection warning |
| Cloudflare build rehearsal | Pass from `/apps/mcp`; frozen workspace install and the exact production deploy command complete in dry-run mode |
| Browser consent smoke test | Google consent rendered at desktop and mobile sizes with no console errors, no horizontal overflow, and no client-side script |
| `packages/knoww-services` tests | 97/97 across 5 files |
| `packages/knoww-services` typecheck and Biome | Pass |
| `apps/web` typecheck and affected search-route tests | Pass; 6/6 search-route tests |
| `apps/extension` typecheck and tests | Pass; 661/661 tests |
| Production dependency audit | Pass; no known vulnerabilities reported by `pnpm audit --prod --audit-level=high` |
| Release automation | `MCP CI / quality` runs on every pull request; production Cloudflare Workers Builds settings and watch paths documented |
| Diff whitespace check | Pass after refreshing the staged MCP files |

## Delivered behavior

The work is organized as planned implementation slices rather than submitted pull requests:

1. **Worker and transport.** A stateless MCP Worker uses `@modelcontextprotocol/server@2.0.0` through `agents/mcp/server`. It validates Host and every present Origin while allowing origin-less desktop clients. Request IDs flow through AsyncLocalStorage into response headers, structured tool metadata, and safe failure logs.
2. **Search and market detail.** Gamma-backed search and identifier lookup expose decimal-string prices. Price and volume comparisons use Decimal.js. The existing web search contract keeps its historical numeric `topOutcome.price` field for compatibility, but no monetary comparison or arithmetic uses JavaScript floating point.
3. **Event detail.** Child-event fan-out runs only for `negRisk: true` events. Child and fallback failures degrade the market list without hiding the parent event. Service caps and partial results are explicit through response text, `marketsIncomplete`, and `meta.truncated`.
4. **Order books.** CLOB snapshots are validated before use, including token identity, price bounds, positive sizes, tick size, minimum order size, and timestamp shape. Bids and asks are sorted locally, depth sums use Decimal.js, and old snapshots are marked stale.
5. **Price history.** CLOB history points require safe timestamps inside the requested window and prices from 0 to 1. Points are sorted by time and prices become decimal strings. Series over 1,000 points are downsampled with endpoints retained and `meta.truncated` set.
6. **OAuth and scopes.** `@cloudflare/workers-oauth-provider@0.10.3` owns discovery, client registration, grants, token exchange, refresh rotation, revocation, and audience validation. The browser consent flow uses Google OpenID Connect with a nonce, S256 PKCE, and five-minute state stored in a Durable Object and consumed atomically. The Worker verifies Google's signed ID token before deriving the MCP principal. Access-token scopes are copied into encrypted per-token properties during authorization-code and refresh exchange, then checked before MCP dispatch and again inside every tool.
7. **Production controls.** The Worker exposes liveness and stateful-binding readiness probes, applies HSTS and baseline response security headers, rejects oversized MCP, OAuth token, and registration bodies before parsing, and enforces separate authentication, edge, free-plan principal, and per-tool quotas.

All tools are read-only and return the shared error format with retry guidance. Tool failures emit `mcp.tools.tool.failed` with only `toolName`, `requestId`, error `code`, and `retryable`; raw errors, messages, and stacks are not logged or returned. The Worker handler also has a safe `onerror` hook.

## Boundary and completeness fixes

- Gamma and CLOB responses are treated as untrusted. Zod schemas validate every nested field consumed by the services, including array contents, decimal ranges, and timestamps. Malformed records fail with the corresponding upstream error instead of being silently cast or dropped.
- Caller cancellation from `ctx.mcpReq.signal` is combined with the service timeout and passed to every upstream fetch. Caller aborts are not converted into degraded success responses.
- Search fetches one extra tag event to detect truncation. Event child lookup does the same at its 50-event cap.
- `search_markets` reports `totalMarkets`, `marketsTruncated`, `totalOutcomes`, and `outcomesTruncated`. Any nested cap sets `meta.truncated`.
- `get_market` and `get_event` declare capped descriptions, tags, and outcome lists in structured output. They report the full outcome count and set `meta.truncated` whenever a returned field is capped.
- `get_event` does not request child events for ordinary events. Capped or failed neg-risk fan-out marks the market list incomplete.
- `get_orderbook` rejects a snapshot whose returned asset ID does not match the requested token.

## Dependency and configuration changes

- `agents` is pinned to `0.21.0`.
- `@cloudflare/workers-oauth-provider` is pinned to `0.10.3` and is now used by the Worker.
- `jose@6.2.3` verifies Google ID-token signatures and claims against Google's remote JWKS.
- Wrangler defines the production custom domain, OAuth KV binding, authorization-transaction Durable Object, required Google secrets, and four rate-limit layers. Deployment must confirm that the resources are provisioned in the intended Cloudflare account and that the configured rate-limit namespace IDs do not collide with another Worker.
- The stale global `nanoid: 3.3.17` override was replaced with a targeted redirect from `3.3.17` to patched `3.3.18`. Consumers that require NanoID 5 now resolve `5.1.16` instead of being forced onto the wrong major.
- Worker build and deploy scripts pass `--env=""` explicitly, so Wrangler uses the top-level production configuration without warning.
- The MCP GitHub Actions workflow runs verification on every pull request so its required check is never skipped by path filters. Cloudflare Workers Builds is the sole automatic production deployer after the bootstrap release, preventing duplicate deployments from the same merge.

`pnpm install` still reports an upstream peer warning: `agents@0.21.0` brings Babel 8 decorator plugins while the wider workspace currently resolves `@babel/core@7.29.7`. The MCP Worker typecheck, tests, and bundle all pass. This warning should be revisited when the workspace moves to Babel 8 or when Agents adjusts that dependency edge; adding an unused Babel runtime dependency here would not improve the Worker.

## Version-sensitive findings

- The SDK supports two wire eras from the same stateless handler. Existing clients use the legacy 2025-11-25 `initialize` handshake. Modern 2026-07-28 requests use `server/discover` and the per-request `_meta` envelope. Both paths have integration coverage.
- SDK input-schema failures arrive as tool-level `isError` results rather than JSON-RPC `-32602` errors. Semantic identifier checks remain in handlers so agents receive useful retry guidance.
- `@cloudflare/vitest-pool-workers@0.21.3` does not expose the documented `fetchMock`. Tests use a one-shot `globalThis.fetch` route table and fail if an expected route is unused.
- Gamma hides closed markets unless `closed=true`, so exact market lookup retries once with that flag after an empty open-market result.
- `/prices-history` accepts the outcome token in a query parameter named `market`; unknown tokens return an empty history with HTTP 200.

## Remaining production work

The remaining gates require remote Cloudflare access or a product decision. They cannot be completed by a local code change.

1. **Repository protection.** Require pull requests and the `MCP CI / quality` check on `main`, and block direct pushes so Cloudflare cannot deploy an unverified commit.
2. **Cloudflare preparation.** Confirm automatic KV provisioning, the Durable Object migration, custom-domain TLS, all four rate-limit bindings, Workers Logs, alerts, and unique production rate-limit namespace IDs.
3. **Production activation and live verification.** Run the first attended production deployment through the approved Cloudflare identity. Immediately verify health, readiness, OAuth, protocol, all tools, cancellation, quotas, and observability with both CIMD and DCR clients. Capture the version ID and test evidence, then monitor the release thresholds for one hour.
4. **Production automation.** Connect the existing `knoww-mcp` Worker to this repository using the Workers Builds settings in `apps/mcp/OPERATIONS.md` only after the first deployment passes its observation window.
5. **Google configuration.** Confirm the production OAuth consent screen, exact `https://mcp.knoww.app/auth/google/callback` redirect URI, and both Google secret bindings before live verification.

## x402 scope assessment

`x402:pay` is reserved but deliberately inactive. It is absent from OAuth metadata and requests for it return `invalid_scope`. Activating it now would falsely imply that a paid tool, price contract, facilitator, and payment-proof verifier already exist.

In a future paid-tool release, `x402:pay` should permit the client to attempt an x402-gated tool. It must not authorize the MCP server or model to spend from a wallet. The agent host must apply budget and confirmation policy, and its wallet component must sign each payment payload. The server must require the relevant domain scope as well as a valid x402 payment proof before returning paid output.

This is a Knoww-defined OAuth scope, not a scope defined by x402 itself. Before activation, prove that the target MCP hosts preserve the x402 challenge and retry headers, choose the supported network, asset, recipient, facilitator, and settlement policy, and bind every quote and proof to the authenticated principal, OAuth client, tool, canonical request hash, amount, expiry, and one-time payment identifier. Store idempotency and settlement state in a strongly consistent system, use Decimal.js or integer base units for amounts, and launch with paid read-only data before considering any trading action.

## Locked MCP versions

`agents@0.21.0`, `@modelcontextprotocol/server@2.0.0`, `@cloudflare/workers-oauth-provider@0.10.3`, `jose@6.2.3`, `zod@4.4.3`, `decimal.js@10.6.0`, `@cloudflare/vitest-pool-workers@0.21.3`, `vitest@4.1.10`, and `wrangler@4.123.0`.

## Change-set hygiene

This work changes the MCP package, its documentation, Wrangler bindings, the MCP explorer guidance and callback copy, and the workspace lockfile. Extension source files are unchanged.
