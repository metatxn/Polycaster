## Review guidelines

- Flag missing input validation on API endpoints
- Flag console.log statements (use our structured logger)
- Ensure all new API endpoints have OpenAPI annotations
- Verify that error responses do not leak internal stack traces
- Check that new routes include rate limiting middleware
- Treat typos in user-facing strings as P1 issues
- Flag any new dependencies that are not in the dependency graph
- All monetary calculations must use Decimal.js, not floating point
- Verify idempotency keys on all payment-related mutations
- Check that refund logic handles partial amounts correctly

## Secret and env file policy

Never read, print, summarize, modify, or infer contents from secret files.

Do not open files matching:

- `.env`
- `.env.*`
- `*.env`
- `*.pem`
- `*.key`
- `*.p12`
- `*.crt`
- `secrets.*`
- `.dev.vars`
- files containing API keys, private keys, tokens, passwords, seed phrases, or credentials

If a task requires environment variable names, inspect only safe examples like `.env.example`, `.env.sample`, or documentation. Never inspect real secret values.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on metatxn/Knoww, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context. A root `CONTEXT-MAP.md` points at one `CONTEXT.md` per app or package, and ADRs live in `docs/decisions/`. See `docs/agents/domain.md`.
