# Knoww MCP implementation report

Date: 2026-08-25

Branch: `mcp`

Plan: [mcp.md](mcp.md)

## Status

The local implementation now provides five read-only tools from a dedicated Cloudflare Worker in `apps/mcp`: `search_markets`, `get_market`, `get_event`, `get_orderbook`, and `get_price_history`.

The implementation is ready for code review, but it is not ready for production traffic. Production OAuth, distributed rate limits, the `mcp.knoww.app` route, deployment, and live smoke tests remain pending. Until OAuth is implemented, the production configuration fails closed with `401 UNAUTHENTICATED`; only the explicit local environment enables the development bypass.

## Verification

| Target | Result |
|---|---|
| `apps/mcp` tests | 93/93 across 7 files |
| `apps/mcp` typecheck and Biome | Pass |
| MCP protocol coverage | Legacy `initialize` at 2025-11-25 and modern `server/discover` at 2026-07-28 both pass |
| Worker dry-run | Pass; 1,144.52 KiB upload, 203.50 KiB gzip; no environment-selection warning |
| `packages/knoww-services` tests | 93/93 across 5 files |
| `packages/knoww-services` typecheck and Biome | Pass |
| `apps/web` typecheck | Pass |
| `apps/web` Vitest | 628 passed; 13 known failures in two localStorage-dependent hook files |
| `apps/web` Node tests | 82/82 pass |
| Production dependency audit | Pass; 0 vulnerabilities across 1,219 production dependencies |
| Diff whitespace check | Pass after refreshing the staged MCP files |

The 13 web failures are unchanged from the earlier baseline recorded during this work. They fail before the MCP search route is exercised because Node was started without a localStorage backing file. They are not fixed in this change.

## Delivered behavior

The work is organized as planned implementation slices rather than submitted pull requests:

1. **Worker and transport.** A stateless MCP Worker uses `@modelcontextprotocol/server@2.0.0` through `agents/mcp/server`. It validates Host and every present Origin while allowing origin-less desktop clients. Request IDs flow through AsyncLocalStorage into response headers, structured tool metadata, and safe failure logs.
2. **Search and market detail.** Gamma-backed search and identifier lookup expose decimal-string prices. Price and volume comparisons use Decimal.js. The existing web search contract keeps its historical numeric `topOutcome.price` field for compatibility, but no monetary comparison or arithmetic uses JavaScript floating point.
3. **Event detail.** Child-event fan-out runs only for `negRisk: true` events. Child and fallback failures degrade the market list without hiding the parent event. Service caps and partial results are explicit through response text, `marketsIncomplete`, and `meta.truncated`.
4. **Order books.** CLOB snapshots are validated before use, including token identity, price bounds, positive sizes, tick size, minimum order size, and timestamp shape. Bids and asks are sorted locally, depth sums use Decimal.js, and old snapshots are marked stale.
5. **Price history.** CLOB history points require safe timestamps inside the requested window and prices from 0 to 1. Points are sorted by time and prices become decimal strings. Series over 1,000 points are downsampled with endpoints retained and `meta.truncated` set.

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
- The unused `@cloudflare/workers-oauth-provider` dependency was removed. It should be added with the OAuth implementation, not before it.
- The stale global `nanoid: 3.3.17` override was replaced with a targeted redirect from `3.3.17` to patched `3.3.18`. Consumers that require NanoID 5 now resolve `5.1.16` instead of being forced onto the wrong major.
- Worker build and deploy scripts pass `--env=""` explicitly, so Wrangler uses the top-level production configuration without warning.

`pnpm install` still reports an upstream peer warning: `agents@0.21.0` brings Babel 8 decorator plugins while the wider workspace currently resolves `@babel/core@7.29.7`. The MCP Worker typecheck, tests, and bundle all pass. This warning should be revisited when the workspace moves to Babel 8 or when Agents adjusts that dependency edge; adding an unused Babel runtime dependency here would not improve the Worker.

## Version-sensitive findings

- The SDK supports two wire eras from the same stateless handler. Existing clients use the legacy 2025-11-25 `initialize` handshake. Modern 2026-07-28 requests use `server/discover` and the per-request `_meta` envelope. Both paths have integration coverage.
- SDK input-schema failures arrive as tool-level `isError` results rather than JSON-RPC `-32602` errors. Semantic identifier checks remain in handlers so agents receive useful retry guidance.
- `@cloudflare/vitest-pool-workers@0.21.3` does not expose the documented `fetchMock`. Tests use a one-shot `globalThis.fetch` route table and fail if an expected route is unused.
- Gamma hides closed markets unless `closed=true`, so exact market lookup retries once with that flag after an empty open-market result.
- `/prices-history` accepts the outcome token in a query parameter named `market`; unknown tokens return an empty history with HTTP 200.

## Remaining production work

1. **OAuth and scopes.** Select the identity provider and client-registration policy, add verified principal and scope handling, and add the OAuth Provider dependency. This requires owner decisions and deployment secrets.
2. **Distributed limits.** Add Cloudflare rate-limit bindings and quotas by principal, tool, and plan. Keep the current input and output bounds as the first protection layer.
3. **Deployment.** Attach the `mcp.knoww.app` custom domain, configure production bindings, and deploy with authorized Cloudflare access.
4. **Live verification.** Run authentication, protocol, tool, cancellation, rate-limit, and observability smoke tests against the deployed endpoint.

## Locked MCP versions

`agents@0.21.0`, `@modelcontextprotocol/server@2.0.0`, `zod@4.4.3`, `decimal.js@10.6.0`, `@cloudflare/vitest-pool-workers@0.21.3`, `vitest@4.1.10`, and `wrangler@4.123.0`.

## Change-set hygiene

The working tree also contains pre-existing dependency upgrades in `apps/agent`, `apps/extension`, `apps/video`, and parts of `apps/web` and `pnpm-lock.yaml`. They were preserved and not reverted. Before opening review requests, split those upgrades from the MCP implementation or clearly identify them as a separate dependency-maintenance change.
