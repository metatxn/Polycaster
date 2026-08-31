# Changelog

## Unreleased

### Added

- Five read-only prediction-market tools over stateless Streamable HTTP.
- OAuth authorization-code flow with S256 PKCE, Google OpenID Connect consent, audience-bound opaque tokens, refresh rotation, and `markets:read` enforcement.
- Production custom domain with OAuth state isolated from the web application.
- Liveness and stateful-binding readiness probes.
- Whole-Worker edge, authentication, free-plan principal, and per-tool quotas.
- Structured request, authorization, quota, readiness, and tool-failure logs.
- Safe Google token-exchange and ID-token diagnostic fields, plus a localhost command for exercising the full OAuth flow.
- An HTTP OpenAPI contract and a deployment and rollback runbook.
- PR-only GitHub quality checks with a documented Cloudflare Workers Builds handoff for production deployment.
- Production-only remote deployment; local and CI checks replace a separate staging Worker.

### Fixed

- The Google consent page sends its own origin on authorization form posts, preventing incorrect 403 responses before sign-in.
- `get_wallet_pnl` reads all-time PnL from Polymarket's overall leaderboard instead of treating an empty current-position list as zero lifetime PnL.

### Security

- Host and Origin allowlists, one-time OIDC state, ID-token signature and claim verification, pre-parse body caps, CSP, HSTS, safe errors, and upstream response validation.
- x402 payment access remains disabled. Version 1 cannot trade, sign, relay, settle, or pay.
