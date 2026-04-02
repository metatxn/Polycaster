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
