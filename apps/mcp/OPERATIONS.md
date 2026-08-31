# Knoww MCP operations runbook

This runbook covers the production Worker. Knoww does not run a remote MCP staging environment. It does not authorize a deployment. An operator with approved Cloudflare access must run every command that changes remote state.

## Service endpoints

| Environment | MCP resource | Liveness | Readiness |
|---|---|---|---|
| Production | `https://mcp.knoww.app/mcp` | `https://mcp.knoww.app/healthz` | `https://mcp.knoww.app/readyz` |

`/healthz` proves that the Worker can execute. `/readyz` also reads the OAuth KV namespace and calls the one-time authorization-transaction Durable Object. Both endpoints return `cache-control: no-store` and an `x-request-id`.

## Quotas

| Layer | Binding | Limit | Key |
|---|---|---:|---|
| Authentication | `MCP_AUTH_RATE_LIMITER` | 30 per minute | Route and source IP |
| Edge abuse control | `MCP_EDGE_RATE_LIMITER` | 300 per minute | Source IP across the Worker |
| Free-plan principal | `MCP_FREE_PRINCIPAL_RATE_LIMITER` | 120 per minute | Plan and authenticated principal |
| Free-plan tool | `MCP_FREE_TOOL_RATE_LIMITER` | 30 per minute per tool | Plan, authenticated principal, and tool |

Cloudflare Rate Limiting counters are permissive, eventually consistent, and local to a Cloudflare location. These limits protect capacity and upstream APIs. They are not billing counters and must never authorize payment, credit, or trading decisions.

Before deploying, confirm that production namespace IDs `1001` through `1004` do not collide with another Worker in the same Cloudflare account.

## Questions the telemetry must answer

1. Is the Worker serving requests, and which routes are failing?
2. Are OAuth, principal, or tool quotas rejecting a material share of traffic?
3. Which upstream-backed tool is failing, and is the failure retryable?
4. Did latency or error rate change after a new Worker version received traffic?
5. Which clients, MCP methods, and tools are used, and how many authenticated principals return?

The Worker emits structured events with a request ID. Useful event names include:

```text
mcp.request.started
mcp.request.finished
mcp.request.failed
mcp.auth.denied
mcp.quota.principal.denied
mcp.health.readiness.failed
mcp.tools.tool.failed
```

Logs must never include bearer tokens, Google codes or tokens, authorization headers, request bodies, tool output, or raw exceptions.

PostHog receives `mcp_http_request_completed`, `mcp_protocol_request_completed`, and `mcp_tool_called`. The Worker batches them after the response through `waitUntil()`. Delivery failure never changes the MCP response. Dashboard properties are bounded, and authenticated principal IDs are hashed before ingestion. Request bodies, tool arguments, wallet addresses, queries, response bodies, and OAuth material are excluded.

## Required Cloudflare setup

Complete these items in the intended Cloudflare account before the first production deployment:

1. Confirm that `knoww.app` is an active Cloudflare zone.
2. Confirm that `mcp.knoww.app` has no conflicting CNAME record.
3. Confirm that the deployment identity can edit Workers, Custom Domains, KV, Durable Objects, and Rate Limiting bindings.
4. Confirm that Wrangler automatic provisioning may create the production `OAUTH_KV` namespace.
5. Confirm the rate-limit namespace IDs listed above are unique in the account.
6. Configure Workers Logs retention and access for the release operator and on-call team.
7. Configure the alerts in the next section and test their delivery channel.
8. Create a Google OAuth client of type **Web application** and configure `https://mcp.knoww.app/auth/google/callback` as an exact Authorized redirect URI.
9. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `POSTHOG_PROJECT_API_KEY` to the `knoww-mcp` Worker as encrypted Cloudflare secrets. Reuse project `585396`'s project token for PostHog ingestion. Do not use a personal API key in the Worker, and do not add the callback path to Authorized JavaScript origins.
10. Confirm `POSTHOG_HOST` is `https://us.i.posthog.com`.
11. Confirm the OAuth consent screen is published for the intended users and requests only `openid email`.

Do not place secret values in `wrangler.jsonc`, this runbook, GitHub Actions, build variables, URLs, or command history. The production Worker requires the Google bindings and PostHog project token. Cloudflare Workers Builds must use the secrets already attached to `knoww-mcp`; it must not recreate them on every deployment.

## Alerts and release thresholds

Create these alerts or equivalent monitors before production receives traffic:

| Signal | Page or rollback threshold | Action |
|---|---|---|
| `/readyz` | Two consecutive failures | Hold rollout and inspect binding errors |
| HTTP 5xx | More than 1% for 5 minutes with at least 20 requests | Roll back |
| P95 request duration | More than 2 seconds for 10 minutes | Hold rollout; roll back if more than 50% above baseline |
| OAuth failures | More than twice the previous-hour baseline for 10 minutes | Hold and inspect provider errors |
| Quota denials | More than 5% of MCP requests for 10 minutes | Hold and inspect abuse or quota sizing |
| Upstream tool failures | More than 5% for one tool over 10 minutes | Hold and inspect Gamma, Data API, or CLOB status |

Every alert must point to this runbook and deliver to a channel watched during the release window. Test each delivery channel before deployment, then confirm that production signals reach the alert after deployment.

## Local release checks

Run these commands from the repository root:

```bash
pnpm --filter @knoww/mcp lint
pnpm --filter @knoww/mcp typecheck
pnpm --filter @knoww/mcp test
pnpm --filter @knoww/services lint
pnpm --filter @knoww/services typecheck
pnpm --filter @knoww/services test
pnpm --filter @knoww/web typecheck
pnpm --filter @knoww/web exec vitest run src/app/api/search/route.test.ts
pnpm --filter @knoww/extension typecheck
pnpm --filter @knoww/extension test
pnpm --filter @knoww/mcp build
pnpm audit --prod --audit-level=high
bash -n apps/mcp/scripts/curl-smoke-test.sh
git diff --check
git diff --cached --check
```

The `MCP CI` GitHub workflow repeats these gates for every pull request. It never deploys a Worker and does not run again after merge. Running it on every pull request ensures that the required check cannot remain pending because of a path-filtered workflow. Configure branch protection so `MCP CI / quality` must pass before merge, require pull requests, and block direct pushes to `main`.

## Production-only release policy

Local Workers-native tests, the PR gate, and the production Wrangler dry run are the predeployment checks. There is no remote environment for testing OAuth, custom-domain TLS, Cloudflare-managed bindings, or real client compatibility before production.

The first deployment must therefore be attended. Keep the rollback and redeploy commands open, confirm the alert delivery channels first, and reserve at least one hour for live verification and monitoring.

## First production deployment

The first production deployment has no earlier production version for a traffic split. Proceed only after every local and CI gate passes and the alerts are active:

```bash
pnpm --filter @knoww/mcp deploy:first-production
```

This command creates the first active production version and attaches the custom domain. Save the version ID, then run:

```bash
curl --fail --silent --show-error https://mcp.knoww.app/healthz
curl --fail --silent --show-error https://mcp.knoww.app/readyz
curl --include --silent --show-error https://mcp.knoww.app/.well-known/oauth-protected-resource/mcp
curl --include --silent --show-error https://mcp.knoww.app/.well-known/oauth-authorization-server
```

Complete a Google OAuth flow using dynamic client registration and a Client ID Metadata Document client. Call every tool at least once, test cancellation, confirm callback replay is rejected, trigger each quota in a controlled test, and locate the requests in Workers Logs by `x-request-id`. Watch health, readiness, 5xx rate, latency, OAuth failures, and tool failures for at least one hour.

## Enable Cloudflare production deployments

After the first production version passes the one-hour observation period, connect the existing `knoww-mcp` Worker to this GitHub repository in **Workers & Pages > knoww-mcp > Settings > Builds**. Use these settings:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `/apps/mcp` |
| Build command | `pnpm --dir ../.. install --frozen-lockfile` |
| Deploy command | `pnpm exec wrangler deploy --env="" --strict` |
| Non-production branch builds | Disabled |
| Build caching | Enabled |
| Build variable | `NODE_VERSION=24` |
| Build variable | `PNPM_VERSION=10.25.0` |
| Build variable | `SKIP_DEPENDENCY_INSTALL=1` |

The root directory must contain `wrangler.jsonc`, and the Cloudflare Worker name must remain `knoww-mcp`, matching that file. The explicit build command installs from the repository's frozen pnpm lockfile so workspace packages resolve correctly; `SKIP_DEPENDENCY_INSTALL=1` prevents Cloudflare from running a second installer in `apps/mcp`. Use the same narrowly scoped Cloudflare build token for every deployment and confirm that it can edit Workers, KV, Durable Objects, custom-domain routes, and rate-limit bindings.

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

Leave exclude paths empty. These paths prevent unrelated web or extension changes from deploying the MCP Worker while still rebuilding it when its shared runtime dependencies change.

Do not enable this production trigger before the first attended deployment passes its release checks. Non-production branch builds stay disabled because Knoww has no remote non-production MCP environment and Cloudflare cannot provide preview URLs for a Worker that uses a Durable Object.

## Later production deployments

The normal path is:

1. Open a pull request with an MCP-affecting change.
2. Wait for the required `MCP CI / quality` check.
3. Merge to `main`.
4. Confirm that Cloudflare Workers Builds deploys the same merge commit to `knoww-mcp`.
5. Verify `/healthz`, `/readyz`, OAuth discovery, one authenticated tool call, logs, and release thresholds.

GitHub Actions owns pre-merge verification. Cloudflare Workers Builds owns production deployment. Do not add a second deployment job to GitHub Actions.

Cloudflare's normal `wrangler deploy` path assigns production traffic to the new version. For a deliberately gradual high-risk release, first disable the automatic production trigger, then use the manual version commands below.

Upload a version without assigning traffic:

```bash
pnpm --filter @knoww/mcp deploy
```

Review the returned version, then promote it with an interactive traffic split:

```bash
pnpm --filter @knoww/mcp deploy:promote
```

Use 5%, 25%, 50%, and 100% stages. Hold each stage long enough to collect useful traffic. Do not advance while any alert is firing.

Check the active deployment at any time:

```bash
pnpm --filter @knoww/mcp deploy:status
```

## Rollback

Roll back immediately for a security issue, data-integrity concern, readiness failure, more than 1% HTTP 5xx for 5 minutes, or more than a 50% P95 latency regression.

List recent versions, identify the last healthy version, and roll back:

```bash
pnpm --filter @knoww/mcp exec wrangler versions list --env=""
pnpm --filter @knoww/mcp deploy:rollback -- <healthy-version-id>
```

After rollback, verify `/healthz`, `/readyz`, OAuth discovery, one authenticated tool call, and log delivery. Cloudflare does not roll back KV contents or Durable Object storage with Worker code. Do not delete or rename those bindings during an ordinary code rollout.

## Launch limitations

- Production authentication requires a Google account with a verified email. Knoww does not expose the Google email or tokens to MCP clients.
- Version 1 is read-only. It cannot place trades, sign orders, move funds, or make x402 payments.
- `x402:pay` remains inactive and must not appear in OAuth metadata until paid tools have their own payment-proof and idempotency review.
- The HTTP endpoint contract is in [`openapi.yaml`](openapi.yaml). MCP tool schemas remain authoritative through protocol discovery.
