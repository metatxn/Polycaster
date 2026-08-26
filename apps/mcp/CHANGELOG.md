# Changelog

## Unreleased

### Added

- Five read-only prediction-market tools over stateless Streamable HTTP.
- OAuth authorization-code flow with S256 PKCE, wallet consent, audience-bound opaque tokens, refresh rotation, and `markets:read` enforcement.
- Production custom domain with OAuth state isolated from the web application.
- Liveness and stateful-binding readiness probes.
- Whole-Worker edge, authentication, free-plan principal, and per-tool quotas.
- Structured request, authorization, quota, readiness, and tool-failure logs.
- An HTTP OpenAPI contract and a deployment and rollback runbook.
- PR-only GitHub quality checks with a documented Cloudflare Workers Builds handoff for production deployment.
- Production-only remote deployment; local and CI checks replace a separate staging Worker.

### Security

- Host and Origin allowlists, one-time wallet challenges, pre-parse body caps, CSP, HSTS, safe errors, and upstream response validation.
- x402 payment access remains disabled. Version 1 cannot trade, sign, relay, settle, or pay.
