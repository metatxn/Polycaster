# API Reference

This document is generated from the route handlers under `apps/web/src/app/api`. It documents the request validation that exists in this codebase today. When a route proxies upstream JSON without a local Zod schema or typed transform, the response is documented as an opaque `object` or `array`.

## Conventions

- Base path: all routes are rooted at `/api`.
- Dynamic path parameters are shown as `:param` for runtime URLs, even though the filesystem routes live under Next.js segments such as `[param]`.
- Content type: all request and response bodies are JSON unless noted otherwise.
- Preflight handlers: these routes also export explicit `OPTIONS` handlers for CORS preflight and return headers only with no JSON body:
  - `/api/ai/extract-topics`
  - `/api/ai/validate-relevance`
  - `/api/analytics/batch`
  - `/api/extension/session/logout`
  - `/api/rpc/polygon`
- Rate limiting: routes that call `checkRateLimit()` are limited per IP and per normalized route template.
- Shared `429` response shape:

```json
{
  "success": false,
  "error": "Too many requests. Please try again later.",
  "rateLimit": {
    "limit": 60,
    "remaining": 0,
    "reset": "2026-04-02T10:15:00.000Z"
  }
}
```

- Shared rate-limit headers:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`
  - `Retry-After`

## Agent

These routes power the internal paper-trading dashboard at `/agent`.

Shared auth

- Read routes require either `Authorization: Bearer <AGENT_ADMIN_TOKEN>` or `X-Knoww-Agent-Token: <AGENT_ADMIN_TOKEN>`.
- Mutating routes use the same admin token and also enforce the web app's same-origin checks.
- In production, missing `AGENT_ADMIN_TOKEN` returns `503 { success: false, error: "Agent admin access is not configured" }`.

### GET `/api/agent/status`

Description: Returns agent readiness without exposing secrets.

Headers

- Auth: agent admin token

Success `200`

- Schema:
  - `success: true`
  - `status.llm: { provider: string, models: string[], ready: boolean, missing: string[] }`
  - `status.search: { enabled: boolean, mode: "native" | "direct" | "both", providers: { provider: "tavily" | "exa" | "firecrawl", ready: boolean, missing: string[] }[] }`
  - `status.admin: { configured: boolean }`

Errors

- `401`: `{ success: false, error: "Unauthorized" }`
- `429`: shared rate-limit response
- `503`: admin token not configured outside development

Rate limiting

- `60` requests/minute/IP

### GET `/api/agent/watchlist`

Description: Lists stored paper-trading watchlist items.

Headers

- Auth: agent admin token

Success `200`

- Schema:
  - `success: true`
  - `items: AgentWatchlistItem[]`
- `AgentWatchlistItem` fields:
  - `id: string (uuid)`
  - `question: string`
  - `tokenId: string`
  - Optional: `conditionId`, `marketSlug`, `side`, `outcomeLabel`, `marketType`, `eventType`, `outcomes`, `oppositeOutcomeLabel`, `oppositeTokenId`, `eventMarketCount`, `eventStartTime`, `eventEndTime`, `resolutionSource`
  - `newsUrls: string[]`
  - `socialNotes: string[]`
  - `active: boolean`
  - `createdAt: string`
  - `updatedAt: string`

Errors

- `401`: `{ success: false, error: "Unauthorized" }`
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to list watchlist" }`

Rate limiting

- `60` requests/minute/IP

### POST `/api/agent/watchlist`

Description: Creates or updates a watchlist item. The request may either provide a direct Polymarket URL to import or provide explicit market fields.

Headers

- `Content-Type: application/json`
- Auth: agent admin token

Request body

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `id` | `string` | No | Optional UUID for updates. |
| `polymarketUrl` | `string` | Conditionally | URL, max 500 chars. If present, it can supply/import market metadata. |
| `question` | `string` | Conditionally | Required unless `polymarketUrl` is provided. Trimmed, `8..240` chars. |
| `tokenId` | `string` | Conditionally | Required unless `polymarketUrl` is provided. Trimmed, `8..160` chars. |
| `conditionId` | `string` | No | Trimmed, `8..160` chars. |
| `marketSlug` | `string` | No | Trimmed, `1..180` chars. |
| `side` | `"YES" \| "NO"` | No | Optional token side. |
| `outcomeLabel` | `string` | No | Trimmed, `1..80` chars. |
| `marketType` | `"binary" \| "multi_outcome" \| "unknown"` | No | Optional. |
| `eventType` | `"single_market" \| "multi_market" \| "unknown"` | No | Optional. |
| `outcomes` | `string[]` | No | Up to 50 entries, each `1..120` chars. |
| `oppositeOutcomeLabel` | `string` | No | Trimmed, `1..80` chars. |
| `oppositeTokenId` | `string` | No | Trimmed, `8..160` chars. |
| `eventMarketCount` | `number` | No | Integer `0..500`. |
| `eventStartTime` | `string` | No | ISO datetime. |
| `eventEndTime` | `string` | No | ISO datetime. |
| `resolutionSource` | `string` | No | URL, max 500 chars. |
| `newsUrls` | `string[]` | No | URLs, up to 5 items. Defaults to `[]`. |
| `socialNotes` | `string[]` | No | Up to 10 trimmed strings, each `1..1000` chars. Defaults to `[]`. |
| `active` | `boolean` | No | Defaults to `true`. |

Success `200`

- Schema:
  - `success: true`
  - `item: AgentWatchlistItem`

Errors

- `400`: `{ success: false, error: "Invalid JSON payload" }` or `{ success: false, error: "Invalid watchlist input", details: zodFlattenedError }`
- `401`: `{ success: false, error: "Unauthorized" }`
- `403`: same-origin validation failure for mutating admin routes
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to save watchlist item" }`

Rate limiting

- `20` requests/minute/IP

### GET `/api/agent/runs`

Description: Lists recent paper-trading run summaries.

Headers

- Auth: agent admin token

Success `200`

- Schema:
  - `success: true`
  - `runs: { id: string, status: "RUNNING" | "COMPLETED" | "FAILED", startedAt: string, completedAt: string | null, itemCount: number, tradeCount: number, blockedCount: number }[]`

Errors

- `401`: `{ success: false, error: "Unauthorized" }`
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to list agent runs" }`

Rate limiting

- `60` requests/minute/IP

### POST `/api/agent/runs`

Description: Runs the paper-trading agent on all active watchlist items or on a selected subset.

Headers

- `Content-Type: application/json`
- Auth: agent admin token

Request body

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `watchlistItemIds` | `string[]` | No | UUIDs, max 25. |
| `portfolio.bankrollUsd` | `string` | No | Non-negative decimal string. |
| `portfolio.cashUsd` | `string` | No | Non-negative decimal string. |
| `portfolio.maxPositionUsd` | `string` | No | Non-negative decimal string. |
| `portfolio.maxTradeUsd` | `string` | No | Non-negative decimal string. |
| `portfolio.maxDrawdownPct` | `string` | No | Non-negative decimal string. |
| `portfolio.realizedPnlUsd` | `string` | No | Signed decimal string. |
| `executionMode` | `"paper" \| "live"` | No | Optional override. |

Success `200`

- Schema:
  - `success: true`
  - `run: { id: string, status: "RUNNING" | "COMPLETED" | "FAILED", startedAt: string, completedAt: string | null, itemCount: number, tradeCount: number, blockedCount: number }`

Errors

- `400`: `{ success: false, error: "Invalid JSON payload" }` or `{ success: false, error: "Invalid run input", details: zodFlattenedError }`
- `401`: `{ success: false, error: "Unauthorized" }`
- `403`: same-origin validation failure for mutating admin routes
- `500`: `{ success: false, error: "Failed to run paper-trading agent" }`

### GET `/api/agent/runs/:id`

Description: Returns the full detail for one paper-trading run.

Headers

- Auth: agent admin token

Path parameters

| Name | Type | Required | Validation |
| --- | --- | --- | --- |
| `id` | `string` | Yes | UUID. |

Success `200`

- Schema:
  - `success: true`
  - `run: RunDetail`
  - `RunDetail` extends the run summary fields and adds `items`, where each item contains:
    - `watchlistItem: AgentWatchlistItem`
    - `evidence: object`
    - `votes: object[]`
    - `decision: { action, approved, majorityAction, confidence, fairProbability, sizeUsd, reason, riskFlags, validVotes, invalidVotes }`
    - `fill: object | null`
    - `resolution: { tokenId, conditionId?, marketSlug?, outcomeYes: 0 | 1, settlementPrice: string, resolvedAt: string } | null`

Errors

- `400`: `{ success: false, error: "Invalid run id" }`
- `401`: `{ success: false, error: "Unauthorized" }`
- `404`: `{ success: false, error: "Run not found" }`
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to load agent run" }`

Rate limiting

- `60` requests/minute/IP

### GET `/api/agent/metrics`

Description: Returns aggregate paper-trading metrics.

Headers

- Auth: agent admin token

Success `200`

- Schema:
  - `success: true`
  - `metrics: { runCount: number, tradeCount: number, holdCount: number, blockedCount: number, notionalUsd: string }`

Errors

- `401`: `{ success: false, error: "Unauthorized" }`
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to load agent metrics" }`

Rate limiting

- `60` requests/minute/IP

### GET `/api/agent/calibration`

Description: Returns per-model calibration stats over resolved runs.

Headers

- Auth: agent admin token

Success `200`

- Schema:
  - `success: true`
  - `calibration: { models: { provider: string, brierMean: number, count: number }[], resolvedVoteCount: number }`

Errors

- `401`: `{ success: false, error: "Unauthorized" }`
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to load calibration" }`

Rate limiting

- `60` requests/minute/IP

### GET `/api/agent/positions`

Description: Lists paper-trading positions and aggregate realized/open P&L.

Headers

- Auth: agent admin token

Success `200`

- Schema:
  - `success: true`
  - `positions: { id, watchlistItemId, tokenId, side: "BUY", status: "OPEN" | "CLOSED", entryPrice, shares, entryNotionalUsd, exitPrice, exitNotionalUsd, realizedPnlUsd, openedAt, closedAt, closeReason, openedRunId, closedRunId }[]`
  - `pnl: { openPositionCount: number, closedPositionCount: number, realizedPnlUsd: string, openEntryNotionalUsd: string }`

Errors

- `401`: `{ success: false, error: "Unauthorized" }`
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to load positions" }`

Rate limiting

- `60` requests/minute/IP

### GET `/api/agent/live-orders`

Description: Lists recent live-order audit records plus non-secret live-execution config.

Headers

- Auth: agent admin token

Success `200`

- Schema:
  - `success: true`
  - `orders: { idempotencyKey, runId, watchlistItemId, tokenId, side, requestedSizeUsd, price, signedOrderHash, orderId, status: "DRY_RUN" | "POSTED" | "FILLED" | "CANCELED" | "FAILED", submittedAt, filledAt, createdAt, dryRun, error }[]`
  - `config: { enabled: boolean, dryRun: boolean, confirmedReal: boolean, hasWalletKey: boolean, maxLiveNotionalUsd: string, clobHost: string, chainId: number }`

Errors

- `401`: `{ success: false, error: "Unauthorized" }`
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to load live orders" }`

Rate limiting

- `60` requests/minute/IP

### GET `/api/agent/resolutions`

Description: Lists stored market-resolution rows used for settlement and calibration.

Headers

- Auth: agent admin token

Success `200`

- Schema:
  - `success: true`
  - `resolutions: { tokenId: string, conditionId?: string, marketSlug?: string, outcomeYes: 0 | 1, settlementPrice: string, resolvedAt: string }[]`

Errors

- `401`: `{ success: false, error: "Unauthorized" }`
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to list resolutions" }`

Rate limiting

- `60` requests/minute/IP

### POST `/api/agent/resolutions`

Description: Refreshes resolutions for active watchlist items whose end time has passed, then settles any matching open positions.

Headers

- Auth: agent admin token

Success `200`

- Schema:
  - `success: true`
  - `checked: number`
  - `resolved: number`
  - `settledPositions: number`
  - `stillUnresolved: string[]`

Errors

- `401`: `{ success: false, error: "Unauthorized" }`
- `403`: same-origin validation failure for mutating admin routes
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to refresh resolutions" }`

Rate limiting

- `12` requests/minute/IP

## AI

### OPTIONS `/api/ai/extract-topics`

Description: CORS preflight handler for the extension-facing topic extraction route.

Headers

- `Origin: <allowed extension origin>` or an allowed app `Referer`

Request body

- None

Success `200`

- Empty body
- Returns extension CORS headers from `handleExtensionPreflight()`

Errors

- `400`: Not used.
- `401`: Not used.
- `403`: Returned when the request origin/referer is not allowed by the extension auth helpers.
- `404`: Not used.
- `500`: Not used.

Rate limiting

- No explicit rate limiter

### POST `/api/ai/extract-topics`

Description: Extracts topic/category metadata from extension text using OpenRouter. Requires extension access.

Headers

- `Content-Type: application/json`
- Auth: either `Authorization: Bearer <extension-session-token>` with scope `ai:extract`, or an allowed extension `Origin` / app `Referer`

Request body

| Field  | Type     | Required | Validation                                                                                                                                              |
| ------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text` | `string` | Yes      | Must exist and be a string. The extractor normalizes whitespace/URLs, truncates to 500 chars, and treats inputs under 20 meaningful chars as too short. |

Success `200`

- Schema:
  - `success: boolean`
  - `category: "politics" | "sports" | "crypto" | "tech" | "entertainment" | "economy" | "science" | "other"`
  - `entities: string[]` max 5
  - `tags: string[]` max 4
  - `topics: string[]` alias of `tags`
  - `searchQuery: string` max 100
  - `keywords: string` alias of `searchQuery`
  - `confidence: number` between `0` and `1`
  - `inputLength: number`
  - `truncated: boolean`
  - Optional: `cached`, `durationMs`, `fallbackReason`, `error`

Errors

- `400`: `{ error: "Missing or invalid 'text' field" }` or structured fallback body with `success: false` when JSON parsing fails.
- `401`: Returned only when bearer auth is supplied but invalid or expired.
- `404`: Not used by this handler.
- `500`: Not emitted directly; provider failures fail open into a `200` body with `success: false`, `fallbackReason`, and `error`.

Rate limiting

- `20` requests/minute/IP

Example

```http
POST /api/ai/extract-topics HTTP/1.1
Content-Type: application/json
Authorization: Bearer eyJ...

{"text":"Bitcoin is pushing back toward $100k after the latest Fed comments."}
```

```json
{
  "success": true,
  "category": "crypto",
  "entities": ["Bitcoin", "Fed"],
  "tags": ["bitcoin", "crypto", "fed"],
  "topics": ["bitcoin", "crypto", "fed"],
  "searchQuery": "Bitcoin Fed price",
  "keywords": "Bitcoin Fed price",
  "confidence": 0.91,
  "inputLength": 72,
  "truncated": false
}
```

### GET `/api/ai/extract-topics`

Description: Testing-friendly GET variant of the same extractor.

Headers

- Auth: same as `POST /api/ai/extract-topics`

Query parameters

| Name   | Type     | Required | Validation                                                                                |
| ------ | -------- | -------- | ----------------------------------------------------------------------------------------- |
| `text` | `string` | Yes      | Must be present. The same normalization, truncation, and short-input rules as POST apply. |

Success `200`

- Same response schema as `POST /api/ai/extract-topics`.

Errors

- `400`: `{ error: "Missing 'text' query parameter", usage: "GET /api/ai/extract-topics?text=your+text+here" }`
- `401`: Returned only when bearer auth is supplied but invalid or expired.
- `404`: Not used.
- `500`: Not emitted directly; extraction failures return `200` fallback bodies.

Rate limiting

- `20` requests/minute/IP

Example

```http
GET /api/ai/extract-topics?text=Chiefs%20vs%20Eagles%20Super%20Bowl%20rematch HTTP/1.1
Origin: chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc
```

```json
{
  "success": true,
  "category": "sports",
  "entities": ["Chiefs", "Eagles", "Super Bowl"],
  "tags": ["nfl", "super-bowl"],
  "topics": ["nfl", "super-bowl"],
  "searchQuery": "Chiefs Eagles Super Bowl",
  "keywords": "Chiefs Eagles Super Bowl",
  "confidence": 0.94,
  "inputLength": 34,
  "truncated": false
}
```

### OPTIONS `/api/ai/validate-relevance`

Description: CORS preflight handler for the extension-facing relevance validation route.

Headers

- `Origin: <allowed extension origin>` or an allowed app `Referer`

Request body

- None

Success `200`

- Empty body
- Returns extension CORS headers from `handleExtensionPreflight()`

Errors

- `400`: Not used.
- `401`: Not used.
- `403`: Returned when the request origin/referer is not allowed by the extension auth helpers.
- `404`: Not used.
- `500`: Not used.

Rate limiting

- No explicit rate limiter

### POST `/api/ai/validate-relevance`

Description: Uses OpenRouter to decide whether a market title is genuinely relevant to a piece of post text. Requires extension access.

Headers

- `Content-Type: application/json`
- Auth: either `Authorization: Bearer <extension-session-token>` with scope `ai:validate`, or an allowed extension `Origin` / app `Referer`

Request body

| Field         | Type                 | Required | Validation                                                                           |
| ------------- | -------------------- | -------- | ------------------------------------------------------------------------------------ |
| `postText`    | `string`             | Yes      | Must exist and be a string. Only the first 400 chars are used for caching/prompting. |
| `marketTitle` | `string`             | Yes      | Must exist and be a string.                                                          |
| `marketTags`  | `string[] \| string` | No       | Array is accepted directly. A comma-delimited string is split and trimmed.           |

Success `200`

- Schema:
  - `relevant: boolean`
  - `reason: string`
  - `confidence: number` between `0` and `1`
  - Optional: `cached`, `durationMs`, `error`
- Note: provider/config failures fail open with `relevant: true`, `reason: ""`, `confidence: 0`.

Errors

- `400`: `{ error: "Missing 'postText' or 'marketTitle'" }` or fallback body `{ relevant: true, reason: "", confidence: 0, error: "Invalid request body" }`
- `401`: Returned only when bearer auth is supplied but invalid or expired.
- `404`: Not used.
- `500`: Unexpected handler failures return `{ relevant: true, reason: "", confidence: 0, error: "Internal server error" }`

Rate limiting

- `30` requests/minute/IP

Example

```http
POST /api/ai/validate-relevance HTTP/1.1
Content-Type: application/json
Authorization: Bearer eyJ...

{
  "postText": "Trump says tariffs on Chinese imports could increase next year.",
  "marketTitle": "Will Trump impose new China tariffs in 2026?",
  "marketTags": ["trump", "china", "us-politics"]
}
```

```json
{
  "relevant": true,
  "reason": "Post discusses Trump's tariff policy",
  "confidence": 0.93,
  "durationMs": 812
}
```

## Analytics

### OPTIONS `/api/analytics/batch`

Description: CORS preflight handler for the extension analytics ingest route.

Headers

- `Origin: <allowed extension origin>`

Request body

- None

Success `200`

- Empty body
- Returns extension CORS headers from `handleExtensionPreflight()`

Errors

- `400`: Not used.
- `401`: Not used.
- `403`: Returned when the request origin is not allowed by the extension auth helpers.
- `404`: Not used.
- `500`: Not used.

Rate limiting

- No explicit rate limiter

### POST `/api/analytics/batch`

Description: Accepts a batch of sanitized extension analytics events and forwards them to the server-side PostHog client.

Headers

- `Content-Type: application/json`
- Auth: extension `Origin` / `Referer` is required for CORS; no bearer token is required

Request body

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `events` | `AnalyticsEvent[]` | Yes | Array length `1..20`. |

`AnalyticsEvent`

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `event` | `string` | Yes | Min length `1`, max length `64`. |
| `distinctId` | `string` | Yes | Must be a UUID. |
| `timestamp` | `string` | Yes | Must be an ISO datetime. |
| `properties` | `Record<string, string \| number \| boolean \| null>` | No | Keys must be non-empty and max length `64`. String values are capped at `200` chars. |

Success `202`

- Schema:
  - `success: true`
  - `accepted: number`

Errors

- `400`: `{ success: false, error: "Invalid JSON payload" }` or `{ success: false, error: "Invalid analytics payload", details: fieldErrors }`
- `401`: Not used by this handler.
- `404`: Not used.
- `429`: Shared rate-limit body.
- `503`: `{ success: false, error: "Analytics backend is not configured" }` or `{ success: false, error: "Failed to capture analytics events" }`

Rate limiting

- `30` requests/minute/IP

Example

```http
POST /api/analytics/batch HTTP/1.1
Content-Type: application/json
Origin: chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc

{
  "events": [
    {
      "event": "extension_opened",
      "distinctId": "11111111-1111-4111-8111-111111111111",
      "timestamp": "2026-04-02T10:00:00.000Z",
      "properties": {
        "platform": "twitter",
        "usageAnalyticsEnabled": true
      }
    }
  ]
}
```

```json
{
  "success": true,
  "accepted": 1
}
```

## Auth And Extension Sessions

### POST `/api/auth/derive-api-key`

Description: Creates a first-time Polymarket API key or derives an existing one using signed L1 auth headers supplied in the JSON body.

Headers

- `Content-Type: application/json`
- Auth: none at this route; auth material is supplied in the body

Request body

| Field       | Type     | Required | Validation                                           |
| ----------- | -------- | -------- | ---------------------------------------------------- |
| `address`   | `string` | Yes      | Must be a valid Ethereum address (`viem.isAddress`). |
| `signature` | `string` | Yes      | No format validation beyond string type.             |
| `timestamp` | `string` | Yes      | No numeric validation beyond string type.            |
| `nonce`     | `string` | No       | Defaults to `"0"` when omitted.                      |

Success `200`

- Schema:
  - `success: true`
  - `credentials: { apiKey: string, apiSecret: string, apiPassphrase: string }`
  - `method: "create" | "derive"`

Errors

- `400`: `{ success: false, error: "Invalid request body", details: string }` or `{ success: false, error: string }`
- `401`: Not returned by this handler.
- `404`: Not returned by this handler.
- `500`: `{ success: false, error: "Failed to create or retrieve API credentials." }`

Rate limiting

- `10` requests/minute/IP

Example

```http
POST /api/auth/derive-api-key HTTP/1.1
Content-Type: application/json

{
  "address": "0x1111111111111111111111111111111111111111",
  "signature": "0xabcdef",
  "timestamp": "1712051400",
  "nonce": "0"
}
```

```json
{
  "success": true,
  "credentials": {
    "apiKey": "pmk_live_xxx",
    "apiSecret": "secret_xxx",
    "apiPassphrase": "passphrase_xxx"
  },
  "method": "derive"
}
```

### POST `/api/extension/session/challenge`

Description: Issues a short-lived SIWX challenge and a signed challenge token for the extension login flow.

Headers

- `Content-Type: application/json`
- Auth: none

Request body

| Field           | Type     | Required | Validation                                                        |
| --------------- | -------- | -------- | ----------------------------------------------------------------- |
| `walletAddress` | `string` | Yes      | Must be a valid Ethereum address.                                 |
| `chainId`       | `number` | Yes      | Must equal Polygon chain ID `137`.                                |

Success `200`

- Schema:
  - `message: string`
  - `nonce: string`
  - `issuedAt: string` ISO datetime
  - `expiresAt: string` ISO datetime
  - `challengeToken: string`

Errors

- `400`: `{ error: "Invalid request payload", details: formattedZodError }` or `{ error: "Invalid request payload" }`
- `401`: Not used.
- `404`: Not used.
- `500`: Not used.
- `503`: `{ error: "Extension session secret is not configured" }`

Rate limiting

- `30` requests/minute/IP

Example

```http
POST /api/extension/session/challenge HTTP/1.1
Content-Type: application/json

{"walletAddress":"0x1111111111111111111111111111111111111111","chainId":137}
```

```json
{
  "message": "knoww.app wants you to sign in with your Ethereum account:\n0x1111111111111111111111111111111111111111\n\nSign in to Knoww\n\nURI: https://knoww.app\nVersion: 1\nChain ID: 137\nNonce: 1234abcd\nIssued At: 2026-04-02T10:00:00.000Z\nExpiration Time: 2026-04-02T10:05:00.000Z",
  "nonce": "1234abcd",
  "issuedAt": "2026-04-02T10:00:00.000Z",
  "expiresAt": "2026-04-02T10:05:00.000Z",
  "challengeToken": "eyJ..."
}
```

### POST `/api/extension/session/verify`

Description: Verifies the signed SIWX challenge and returns a 15-minute extension session token.

Headers

- `Content-Type: application/json`
- Auth: none

Request body

| Field            | Type     | Required | Validation                                |
| ---------------- | -------- | -------- | ----------------------------------------- |
| `challengeToken` | `string` | Yes      | Min length `1`.                           |
| `chainId`        | `number` | Yes      | Must equal Polygon chain ID `137`.        |
| `message`        | `string` | Yes      | Must match the challenge payload.         |
| `signature`      | `string` | Yes      | Must be a `0x`-prefixed 65-byte hex signature and verify against `walletAddress`. |
| `walletAddress`  | `string` | Yes      | Must be a valid Ethereum address.         |

Success `200`

- Schema:
  - `success: true`
  - `token: string`
  - `expiresAt: string` ISO datetime

Errors

- `400`: `{ error: "Invalid request payload", details: formattedZodError }` or `{ error: "Invalid request payload" }`
- `401`: `{ error: "Invalid or expired challenge" }` or `{ error: "Invalid signature" }`
- `404`: Not used.
- `500`: Not used.
- `503`: `{ error: "Extension session secret is not configured" }` or `{ error: "Failed to establish extension session" }`

Rate limiting

- `30` requests/minute/IP

Example

```http
POST /api/extension/session/verify HTTP/1.1
Content-Type: application/json

{
  "challengeToken": "eyJ...",
  "chainId": 137,
  "message": "knoww.app wants you to sign in with your Ethereum account:\n0x1111111111111111111111111111111111111111\n...",
  "signature": "0xdeadbeef",
  "walletAddress": "0x1111111111111111111111111111111111111111"
}
```

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresAt": "2026-04-02T10:15:00.000Z"
}
```

### POST `/api/extension/session/logout`

Description: Revokes the current extension bearer token.

Headers

- Auth: `Authorization: Bearer <extension-session-token>` with a valid extension session

Request body

- None

Success `200`

- Schema:
  - `success: true`

Errors

- `400`: Not used.
- `401`: `{ error: "Unauthorized" }` or the structured error returned by `requireExtensionSession()`
- `404`: Not used.
- `429`: Shared rate-limit body.
- `503`: `{ error: "Failed to revoke extension session" }`

Rate limiting

- `20` requests/minute/IP

Example

```http
POST /api/extension/session/logout HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
Origin: chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc
```

```json
{
  "success": true
}
```

### OPTIONS `/api/extension/session/logout`

Description: CORS preflight handler for extension session logout.

Headers

- `Origin: <allowed extension origin>`

Request body

- None

Success `200`

- Empty body
- Returns extension CORS headers from `handleExtensionPreflight()`

Errors

- `400`: Not used.
- `401`: Not used.
- `403`: Returned when the request origin is not allowed by the extension auth helpers.
- `404`: Not used.
- `500`: Not used.

Rate limiting

- No explicit rate limiter

## Comments

### GET `/api/comments`

Description: Fetches comments from the Polymarket Gamma comments API.

Headers

- Auth: none

Query parameters

| Name                 | Type                              | Required | Validation                                                                  |
| -------------------- | --------------------------------- | -------- | --------------------------------------------------------------------------- |
| `parent_entity_type` | `"Event" \| "Series" \| "market"` | No       | Must match the enum when present.                                           |
| `parent_entity_id`   | `number`                          | No       | Coerced with `z.coerce.number()`.                                           |
| `limit`              | `number`                          | No       | Coerced number, min `1`, max `100`, default `40`.                           |
| `offset`             | `number`                          | No       | Coerced number, min `0`, default `0`.                                       |
| `order`              | `string`                          | No       | No further validation.                                                      |
| `ascending`          | `boolean`                         | No       | Query string transformed to `true` only when the literal value is `"true"`. |
| `get_positions`      | `boolean`                         | No       | Same `"true"` transform rule.                                               |
| `get_reports`        | `boolean`                         | No       | Same `"true"` transform rule.                                               |
| `holders_only`       | `boolean`                         | No       | Same `"true"` transform rule.                                               |

Success `200`

- Schema:
  - `success: true`
  - `comments: Comment[]`
  - `pagination: { limit: number, offset: number, hasMore: boolean }`
- `Comment` fields are defined locally and include `id`, `body`, `parentEntityType`, `parentEntityID`, `parentCommentID`, `userAddress`, `replyAddress`, timestamps, `profile`, `reactions`, `reportCount`, and `reactionCount`.

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used locally; upstream 404s are forwarded as the upstream status with `{ success: false, error: "Failed to fetch comments from Polymarket", details: number }`.
- `500`: `{ success: false, error: string }`

Rate limiting

- `100` requests/minute/IP

Example

```http
GET /api/comments?parent_entity_type=Event&parent_entity_id=35908&limit=2 HTTP/1.1
```

```json
{
  "success": true,
  "comments": [
    {
      "id": "cmt_1",
      "body": "This market is moving fast.",
      "parentEntityType": "Event",
      "parentEntityID": 35908,
      "parentCommentID": null,
      "userAddress": "0x1111111111111111111111111111111111111111",
      "replyAddress": null,
      "createdAt": "2026-04-02T09:20:00.000Z",
      "updatedAt": "2026-04-02T09:20:00.000Z",
      "profile": {
        "name": "Ava",
        "pseudonym": "AvaTrades",
        "displayUsernamePublic": true,
        "bio": null,
        "isMod": false,
        "isCreator": false,
        "proxyWallet": "0x2222222222222222222222222222222222222222",
        "baseAddress": "0x1111111111111111111111111111111111111111",
        "profileImage": null
      },
      "reactions": [],
      "reportCount": 0,
      "reactionCount": 0
    }
  ],
  "pagination": {
    "limit": 2,
    "offset": 0,
    "hasMore": false
  }
}
```

### POST `/api/comments`

Description: Posts a new comment or reply to Polymarket using L1 auth values in the request body.

Headers

- `Content-Type: application/json`
- Auth: none at HTTP-header level; Polymarket auth is supplied in `body.auth`

Request body

| Field              | Type                              | Required | Validation                         |
| ------------------ | --------------------------------- | -------- | ---------------------------------- |
| `body`             | `string`                          | Yes      | Min length `1`, max length `5000`. |
| `parentEntityId`   | `number`                          | Yes      | Must be a JSON number.             |
| `parentEntityType` | `"Event" \| "Series" \| "market"` | Yes      | Enum validation.                   |
| `parentCommentId`  | `string`                          | No       | No further validation.             |
| `auth.address`     | `string`                          | Yes      | Must be a valid Ethereum address.  |
| `auth.signature`   | `string`                          | Yes      | No further validation.             |
| `auth.timestamp`   | `string`                          | Yes      | No further validation.             |
| `auth.nonce`       | `string`                          | No       | Defaults to `"0"` when omitted.    |

Success `200`

- Schema:
  - `success: true`
  - `comment: object` raw upstream comment payload

Errors

- `400`: `{ success: false, error: "Invalid request body", details: fieldErrors }` or `{ success: false, error: "Failed to post comment to Polymarket", details: number }`
- `401`: `{ success: false, error: "Authentication failed. Please sign in again." }`
- `404`: Not used locally.
- `500`: `{ success: false, error: string }`
- `403`: `{ success: false, error: "You don't have permission to post comments." }`

Rate limiting

- `10` requests/minute/IP

Example

```http
POST /api/comments HTTP/1.1
Content-Type: application/json

{
  "body": "I think this resolves before the end of the week.",
  "parentEntityId": 35908,
  "parentEntityType": "Event",
  "auth": {
    "address": "0x1111111111111111111111111111111111111111",
    "signature": "0xabc123",
    "timestamp": "1712051400",
    "nonce": "0"
  }
}
```

```json
{
  "success": true,
  "comment": {
    "id": "cmt_99",
    "body": "I think this resolves before the end of the week."
  }
}
```

## Events

### GET `/api/events/list`

Description: Fetches a simple list of events, optionally filtered by tag.

Headers

- Auth: none

Query parameters

| Name           | Type             | Required | Validation                                                  |
| -------------- | ---------------- | -------- | ----------------------------------------------------------- |
| `tag`          | `string \| null` | No       | Optional nullable string.                                   |
| `limit`        | `string`         | No       | Optional string; no numeric validation. Default `"50"`.     |
| `after_cursor` | `string`         | No       | Optional keyset cursor for the next page.                   |
| `closed`       | `string`         | No       | Optional string passed through upstream. Default `"false"`. |

Success `200`

- Schema:
  - `success: true`
  - `count: number`
  - `events: unknown[]`
  - `pagination: { hasMore: boolean, nextCursor: string | null }`

Errors

- `400`: `{ success: false, error: "offset is no longer supported; use after_cursor" }` or `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: string }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/events/list?tag=nfl&limit=2&after_cursor=abc123 HTTP/1.1
```

```json
{
  "success": true,
  "count": 1,
  "events": [
    {
      "id": "35908",
      "slug": "chiefs-vs-bills",
      "title": "Chiefs vs. Bills"
    }
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": "def456"
  }
}
```

### GET `/api/events/paginated`

Description: Fetches paginated events and returns a slimmed event payload tailored for the UI.

Headers

- Auth: none

Query parameters

| Name             | Type     | Required | Validation                                                                                         |
| ---------------- | -------- | -------- | -------------------------------------------------------------------------------------------------- |
| `tag_slug`       | `string` | No       | Passed through upstream.                                                                           |
| `limit`          | `string` | No       | Default `"20"`. No numeric validation.                                                             |
| `after_cursor`   | `string` | No       | Optional keyset cursor for the next page.                                                          |
| `closed`         | `string` | No       | Default `"false"`.                                                                                 |
| `order`          | `string` | No       | Default `"volume24hr"`.                                                                            |
| `ascending`      | `string` | No       | Default `"false"`.                                                                                 |
| `markets`        | `"full"` | No       | When set to `"full"`, expanded market fields are returned. Otherwise only market IDs are returned. |
| `volume24hr_min` | `string` | No       | Mapped to upstream `volume_min`.                                                                   |
| `volume1wk_min`  | `string` | No       | Also mapped to upstream `volume_min`.                                                              |
| `liquidity_min`  | `string` | No       | Passed to upstream `liquidity_min`.                                                                |
| `live`           | `string` | No       | Only `"true"` adds the upstream filter.                                                            |
| `start_date_min` | `string` | No       | Passed through upstream as `start_date_min`.                                                       |
| `start_date_max` | `string` | No       | Passed through upstream as `start_date_max`.                                                       |
| `end_date_min`   | `string` | No       | Passed through upstream as `end_date_min`.                                                         |
| `end_date_max`   | `string` | No       | Passed through upstream as `end_date_max`.                                                         |

Success `200`

- Schema:
  - `success: true`
  - `data: SlimEvent[]`
  - `pagination: { hasMore: boolean, nextCursor: string | null }`
- `SlimEvent` contains:
  - event fields: `id`, `slug`, `title`, `description`, `image`, volume/liquidity fields, `active`, `closed`, `live`, `ended`, `competitive`, `negRisk`, `score`, `startDate`, `endDate`
  - `markets`: either `{ id }[]` or expanded market objects with `question`, `outcomes`, `outcomePrices`, `groupItemTitle`, `image`, `icon`, parsed `clobTokenIds: string[]`, `conditionId`, `gameStartTime`
  - `tags`: strings or `{ id?, slug?, label? }`

Errors

- `400`: `{ success: false, error: "offset is no longer supported; use after_cursor" }`
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: string }`

Rate limiting

- `100` requests/minute/IP

Example

```http
GET /api/events/paginated?tag_slug=crypto&limit=2&markets=full HTTP/1.1
```

```json
{
  "success": true,
  "data": [
    {
      "id": "41001",
      "slug": "bitcoin-above-100k-in-2026",
      "title": "Will Bitcoin trade above $100k in 2026?",
      "volume24hr": 823456.12,
      "liquidity": 2400000,
      "active": true,
      "closed": false,
      "negRisk": false,
      "markets": [
        {
          "id": "991",
          "question": "Will Bitcoin trade above $100k in 2026?",
          "outcomes": "[\"Yes\",\"No\"]",
          "outcomePrices": "[0.58,0.42]",
          "clobTokenIds": ["101", "102"],
          "conditionId": "0xabc",
          "gameStartTime": null
        }
      ],
      "tags": [{ "id": "1", "slug": "bitcoin", "label": "Bitcoin" }]
    }
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": "def456"
  }
}
```

### GET `/api/events/:id`

Description: Fetches an event by numeric ID or slug. Returns the event plus its markets.

Headers

- Auth: none

Path parameters

| Name | Type     | Required | Validation                                                                                            |
| ---- | -------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `id` | `string` | Yes      | Required. Numeric strings use `/events/{id}` upstream; non-numeric strings use `/events/slug/{slug}`. |

Success `200`

- Schema:
  - `success: true`
  - `event: object & { markets: unknown[], marketCount: number }`

Errors

- `400`: `{ success: false, error: "Event ID or slug is required" }`
- `401`: Not used.
- `404`: `{ success: false, error: "Event not found" }`
- `500`: `{ success: false, error: string }`

Rate limiting

- `100` requests/minute/IP

Example

```http
GET /api/events/35908 HTTP/1.1
```

```json
{
  "success": true,
  "event": {
    "id": "35908",
    "slug": "who-will-win-the-election",
    "title": "Who will win the election?",
    "markets": [
      {
        "id": "991",
        "question": "Will Candidate A win?"
      }
    ],
    "marketCount": 1
  }
}
```

### GET `/api/events/trending`

Description: Returns slimmed event payloads ordered by total volume. Excludes hard-coded spam tag IDs `100639` and `102169`.

Headers

- Auth: none

Query parameters

- Same filter set as `GET /api/events/paginated`, except this route always forces:
  - `order=volume`
  - `ascending=false`
  - defaults `limit=15`, `closed=false`

Success `200`

- Same slim event response schema as `GET /api/events/paginated`, plus `pagination.totalResults`.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: string }`

Rate limiting

- `100` requests/minute/IP

Example

```http
GET /api/events/trending?limit=2&tag_slug=sports HTTP/1.1
```

```json
{
  "success": true,
  "data": [
    {
      "id": "501",
      "slug": "nba-finals-winner",
      "title": "Who will win the NBA Finals?",
      "volume": "2450000",
      "markets": [{ "id": "1201" }]
    }
  ],
  "pagination": {
    "hasMore": true,
    "totalResults": 75
  }
}
```

### GET `/api/events/breaking`

Description: Returns slimmed event payloads ordered by 24-hour volume. Excludes the same hard-coded spam tag IDs.

Headers

- Auth: none

Query parameters

- Same filter set as `GET /api/events/paginated`, except this route always forces:
  - `order=volume24hr`
  - `ascending=false`
  - defaults `limit=15`, `closed=false`

Success `200`

- Same slim event response schema as `GET /api/events/paginated`.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: string }`

Rate limiting

- `100` requests/minute/IP

Example

```http
GET /api/events/breaking?limit=2 HTTP/1.1
```

```json
{
  "success": true,
  "data": [
    {
      "id": "610",
      "slug": "fed-next-rate-cut",
      "title": "Will the Fed cut rates at the next meeting?",
      "volume24hr": 602340.5,
      "markets": [{ "id": "3301" }]
    }
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": "def456"
  }
}
```

### GET `/api/events/new`

Description: Returns slimmed event payloads ordered by `startDate` descending. Excludes the same hard-coded spam tag IDs.

Headers

- Auth: none

Query parameters

- Same filter set as `GET /api/events/paginated`, except this route always forces:
  - `order=startDate`
  - `ascending=false`
  - defaults `limit=15`, `closed=false`

Success `200`

- Same slim event response schema as `GET /api/events/paginated`.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: string }`

Rate limiting

- `100` requests/minute/IP

Example

```http
GET /api/events/new?limit=2 HTTP/1.1
```

```json
{
  "success": true,
  "data": [
    {
      "id": "700",
      "slug": "new-apple-event-announcement",
      "title": "Will Apple announce new hardware this month?",
      "startDate": "2026-04-02T08:00:00.000Z",
      "markets": [{ "id": "4401" }]
    }
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": "def456"
  }
}
```

### GET `/api/events/league-counts`

Description: Returns counts for allowlisted sports tag slugs plus a separate live-sports count. League-specific slugs use their configured `series_id`, and stale completed schedules are filtered out for league and single-sport counts.

Headers

- Auth: none

Query parameters

| Name | Type | Required | Validation |
| --- | --- | --- | --- |
| `slug` | `string[]` | Yes | Repeated query param. Must be one or more supported sports tag slugs and no more than the allowlist size. |

Success `200`

- Schema:
  - `sports: number`
  - `live: number`
  - `byTagSlug: Record<string, number>`

Errors

- `400`: `{ success: false, error: "At least one slug is required" }`, `{ success: false, error: "Maximum N slugs per request" }`, or `{ success: false, error: "One or more slugs are not supported" }`
- `401`: Not used.
- `404`: Not used.
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to load league counts" }`

Rate limiting

- `60` requests/minute/IP

## Leaderboard And Profiles

### GET `/api/leaderboard`

Description: Returns trader rankings from Polymarket Data API.

Headers

- Auth: none

Query parameters

| Name         | Type     | Required | Validation                                                                                                                                                 |
| ------------ | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `category`   | `string` | No       | Uppercased, must be one of `OVERALL`, `POLITICS`, `SPORTS`, `CRYPTO`, `CULTURE`, `MENTIONS`, `WEATHER`, `ECONOMICS`, `TECH`, `FINANCE`. Default `OVERALL`. |
| `timePeriod` | `string` | No       | Uppercased, must be `DAY`, `WEEK`, `MONTH`, or `ALL`. Default `DAY`.                                                                                       |
| `orderBy`    | `string` | No       | Uppercased, must be `PNL` or `VOL`. Default `PNL`.                                                                                                         |
| `limit`      | `number` | No       | Parsed integer, clamped to `1..50`, default `25`.                                                                                                          |
| `offset`     | `number` | No       | Parsed integer, min `0`, default `0`.                                                                                                                      |
| `user`       | `string` | No       | Passed upstream if present.                                                                                                                                |
| `userName`   | `string` | No       | Passed upstream if present.                                                                                                                                |

Success `200`

- Schema:
  - `traders: LeaderboardTrader[]`
  - `category: string`
  - `timePeriod: string`
  - `orderBy: string`
  - `total: number`
- `LeaderboardTrader` fields: `rank`, `proxyWallet`, `userName`, `vol`, `pnl`, `profileImage`, `xUsername`, `verifiedBadge`

Errors

- `400`: `{ error: string }` for invalid `category`, `timePeriod`, or `orderBy`
- `401`: Not used.
- `500`: `{ error: "Internal server error" }`
- Upstream non-OK responses (including 404) are forwarded with the upstream HTTP status and `{ error: "Failed to fetch leaderboard data" }`.

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/leaderboard?category=SPORTS&timePeriod=WEEK&orderBy=VOL&limit=2 HTTP/1.1
```

```json
{
  "traders": [
    {
      "rank": "1",
      "proxyWallet": "0x2222222222222222222222222222222222222222",
      "userName": "SharpMoney",
      "vol": 1250000,
      "pnl": 143000,
      "profileImage": null,
      "xUsername": "sharpmoney",
      "verifiedBadge": true
    }
  ],
  "category": "SPORTS",
  "timePeriod": "WEEK",
  "orderBy": "VOL",
  "total": 1
}
```

### GET `/api/profile/:address`

Description: Builds a composite trader profile by fanning out to public profile, PnL, positions, trades, and leaderboard endpoints.

Headers

- Auth: none

Path parameters

| Name      | Type     | Required | Validation                        |
| --------- | -------- | -------- | --------------------------------- |
| `address` | `string` | Yes      | Must be a valid Ethereum address. |

Success `200`

- Schema:
  - `proxyWallet: string`
  - `userName: string | null`
  - `profileImage: string | null`
  - `bio: string | null`
  - `xUsername: string | null`
  - `verifiedBadge: boolean`
  - `totalVolume: number`
  - `totalPnl: number`
  - `positionsCount: number`
  - `tradesCount: number`
  - `rankings: { overall, day, week, month }`

Errors

- `400`: `{ error: "Invalid Ethereum address format" }`
- `401`: Not used.
- `404`: Not used.
- `500`: `{ error: "Failed to fetch profile" }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/profile/0x1111111111111111111111111111111111111111 HTTP/1.1
```

```json
{
  "proxyWallet": "0x1111111111111111111111111111111111111111",
  "userName": "AvaTrades",
  "profileImage": null,
  "bio": "Macro and crypto trader",
  "xUsername": "avatrades",
  "verifiedBadge": true,
  "totalVolume": 1800000,
  "totalPnl": 210000,
  "positionsCount": 14,
  "tradesCount": 100,
  "rankings": {
    "overall": { "rank": "42", "pnl": 210000, "vol": 1800000 },
    "day": null,
    "week": { "rank": "18", "pnl": 34000, "vol": 210000 },
    "month": { "rank": "25", "pnl": 76000, "vol": 640000 }
  }
}
```

### GET `/api/trader/x-profile`

Description: Resolves an X handle to a public Polymarket trader profile using a short-lived cached leaderboard index.

Headers

- Auth: none

Query parameters

| Name | Type | Required | Validation |
| --- | --- | --- | --- |
| `handle` | `string` | Yes | `@` prefix is allowed; normalized value must match `^[A-Za-z0-9_]{1,15}$`. |

Success `200`

- Schema:
  - `success: true`
  - `profile: { proxyWallet, userName, profileImage, bio, xUsername, verifiedBadge, volumeTraded, profitLoss }`

Errors

- `400`: `{ success: false, error: "Invalid X handle" }`
- `404`: `{ success: false, error: "Trader profile not found" }`
- `429`: shared rate-limit response
- `500`: `{ success: false, error: "Failed to resolve trader profile" }`

Rate limiting

- `120` requests/minute/IP

## Markets

### GET `/api/markets/by-tag`

Description: Fetches markets for a tag ID from Gamma's keyset endpoint and returns cursor-based pagination metadata.

Headers

- Auth: none

Query parameters

| Name       | Type     | Required | Validation                          |
| ---------- | -------- | -------- | ----------------------------------- |
| `tag_id`   | `string` | Yes      | Required string.                    |
| `closed`   | `string` | No       | Optional string. Default `"false"`. |
| `limit`    | `number` | No       | Integer from `1` to `100`. Default `50`. |
| `after_cursor` | `string` | No    | Optional keyset cursor for the next page. |

Success `200`

- Schema:
  - `success: true`
  - `count: number`
  - `markets: object[]`
  - `tag_id: string`
  - `pagination: { hasMore: boolean, nextCursor: string | null }`

Errors

- `400`: `{ success: false, error: "tag_id is required" }`, `{ success: false, error: "offset is no longer supported; use after_cursor" }`, or `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: "Failed to fetch markets" }`

Rate limiting

- `100` requests/minute/IP

Example

```http
GET /api/markets/by-tag?tag_id=342&limit=2 HTTP/1.1
```

```json
{
  "success": true,
  "count": 1,
  "markets": [
    {
      "id": "991",
      "question": "Will California legalize X this year?"
    }
  ],
  "tag_id": "342",
  "pagination": {
    "hasMore": false,
    "nextCursor": null
  }
}
```

### GET `/api/markets/by-token/:tokenId`

Description: Resolves a market from a CLOB token ID using Gamma and returns a normalized subset used by the UI.

Headers

- Auth: none

Path parameters

| Name      | Type     | Required | Validation                                           |
| --------- | -------- | -------- | ---------------------------------------------------- |
| `tokenId` | `string` | Yes      | Required path segment. No further format validation. |

Success `200`

- Schema:
  - `success: true`
  - `market: { question: string, slug: string, eventSlug: string, conditionId: string, outcome: string, endDate: string | null, icon: string | null }`

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used; not-found currently returns `200` with `{ success: false, error: "Market not found for token ID" }`
- `500`: `{ success: false, error: string }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/markets/by-token/101 HTTP/1.1
```

```json
{
  "success": true,
  "market": {
    "question": "Will Bitcoin trade above $100k in 2026?",
    "slug": "bitcoin-above-100k-in-2026",
    "eventSlug": "bitcoin-above-100k-in-2026",
    "conditionId": "0xabc",
    "outcome": "Yes",
    "endDate": "2026-12-31T23:59:59.000Z",
    "icon": "https://polymarket-upload.s3.amazonaws.com/bitcoin.png"
  }
}
```

### GET `/api/markets/closed-time`

Description: Looks up closed timestamps for up to 50 condition IDs by querying the CLOB `/markets/{conditionId}` endpoint.

Headers

- Auth: none

Query parameters

| Name  | Type     | Required | Validation                                                                                                                                            |
| ----- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ids` | `string` | Yes      | Comma-delimited list. After trimming, empty values are dropped and only the first 50 IDs are used. Every ID must match `^(?:0x)?[a-fA-F0-9]{1,128}$`. |

Success `200`

- Schema: `{ success: true, closedTimes: Record<string, string> }`
- Only IDs with a resolvable `end_date_iso` or `endDate` are included in `closedTimes`.

Errors

- `400`: `{ success: false, error: "Missing 'ids' query parameter" }`, `{ success: false, error: "No valid condition IDs provided" }`, or `{ success: false, error: "Invalid condition ID format" }`
- `401`: Not used.
- `404`: Not used.
- `500`: Not used locally.

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/markets/closed-time?ids=0xabc,0xdef HTTP/1.1
```

```json
{
  "success": true,
  "closedTimes": {
    "0xabc": "2026-03-31T23:59:59.000Z",
    "0xdef": "2026-04-01T12:00:00.000Z"
  }
}
```

### GET `/api/markets/info/:conditionID`

Description: Passes through the raw CLOB market payload for a condition ID.

Headers

- Auth: none

Path parameters

| Name          | Type     | Required | Validation                                         |
| ------------- | -------- | -------- | -------------------------------------------------- |
| `conditionID` | `string` | Yes      | Required path segment. No local format validation. |

Success `200`

- Schema: `{ success: true, market: object }`
- Note: `market` is not narrowed locally.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not handled locally; upstream fetch failures currently surface as `500`.
- `500`: `{ success: false, error: string }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/markets/info/0xabc HTTP/1.1
```

```json
{
  "success": true,
  "market": {
    "conditionId": "0xabc",
    "question": "Will Bitcoin trade above $100k in 2026?"
  }
}
```

### GET `/api/markets/orderbook/:tokenID`

Description: Passes through the raw CLOB order book for a token.

Headers

- Auth: none

Path parameters

| Name      | Type     | Required | Validation                                         |
| --------- | -------- | -------- | -------------------------------------------------- |
| `tokenID` | `string` | Yes      | Required path segment. No local format validation. |

Success `200`

- Schema: `{ success: true, tokenID: string, orderBook: object }`

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not handled locally; upstream failures become `500`.
- `500`: `{ success: false, error: string }`

Rate limiting

- `120` requests/minute/IP

Example

```http
GET /api/markets/orderbook/101 HTTP/1.1
```

```json
{
  "success": true,
  "tokenID": "101",
  "orderBook": {
    "bids": [["0.57", "1200"]],
    "asks": [["0.58", "900"]]
  }
}
```

### GET `/api/markets/price-history/:tokenId`

Description: Fetches historical price candles for a token from the CLOB API.

Headers

- Auth: none

Path parameters

| Name      | Type     | Required | Validation                                   |
| --------- | -------- | -------- | -------------------------------------------- |
| `tokenId` | `string` | Yes      | Required and must be at least 10 chars long. |

Query parameters

| Name       | Type     | Required | Validation                                                            |
| ---------- | -------- | -------- | --------------------------------------------------------------------- |
| `startTs`  | `number` | No       | Passed upstream as a string. Defaults to 30 days ago in Unix seconds. |
| `fidelity` | `number` | No       | Passed upstream as a string. Default `"60"`.                          |

Success `200`

- Schema:
  - `success: true`
  - `history: { t: number, p: number }[]`
  - `tokenId: string`
  - `startTs: number`
  - `fidelity: number`

Errors

- `400`: `{ success: false, error: "Token ID is required" }` or `{ success: false, error: "Invalid token ID format" }`
- `401`: Not used.
- `404`: `{ success: false, error: "Token not found", history: [] }`
- `500`: `{ success: false, error: string, history: [] }` for local exceptions only.
- Other upstream failures: the handler returns the upstream HTTP status with `{ success: false, error: "Failed to fetch price history", history: [] }`.

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/markets/price-history/1010101010?startTs=1710000000&fidelity=60 HTTP/1.1
```

```json
{
  "success": true,
  "history": [
    { "t": 1710000000, "p": 0.54 },
    { "t": 1710003600, "p": 0.57 }
  ],
  "tokenId": "1010101010",
  "startTs": 1710000000,
  "fidelity": 60
}
```

### POST `/api/markets/price-history/batch`

Description: Fetches historical price candles for multiple token IDs in one request. The handler deduplicates `tokenIds`, fans out to the CLOB `/prices-history` endpoint, and returns one combined payload.

Headers

- `Content-Type: application/json`
- Auth: none

Request body

| Field      | Type               | Required | Validation                                                                              |
| ---------- | ------------------ | -------- | --------------------------------------------------------------------------------------- |
| `tokenIds` | `string[]`         | Yes      | Must include `1..40` numeric string token IDs with length `>= 10`; duplicates are removed. |
| `startTs`  | `number \| string` | No       | Coerced to an integer in `0..4102444800`. Defaults to 30 days ago in Unix seconds.      |
| `fidelity` | `number \| string` | No       | Coerced to an integer in `1..1440`. Default `60`.                                       |

Success `200`

- Schema:
  - `success: true`
  - `histories: { tokenId: string, history: { t: number, p: number }[] }[]`
  - `startTs: number`
  - `fidelity: number`

Errors

- `400`: `{ success: false, error: "Invalid JSON body", histories: [] }` or `{ success: false, error: "Invalid request body", histories: [] }`
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: "Failed to fetch price history", histories: [] }`

Rate limiting

- `60` requests/minute/IP

Example

```http
POST /api/markets/price-history/batch HTTP/1.1
Content-Type: application/json

{
  "tokenIds": ["1010101010", "2020202020"],
  "startTs": 1710000000,
  "fidelity": 60
}
```

```json
{
  "success": true,
  "histories": [
    {
      "tokenId": "1010101010",
      "history": [{ "t": 1710000000, "p": 0.54 }]
    },
    {
      "tokenId": "2020202020",
      "history": [{ "t": 1710000000, "p": 0.43 }]
    }
  ],
  "startTs": 1710000000,
  "fidelity": 60
}
```

### GET `/api/markets/price`

Description: Passes through the CLOB price response for a token.

Headers

- Auth: none

Query parameters

| Name      | Type              | Required | Validation                                                                                                                 |
| --------- | ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `tokenID` | `string`          | Yes      | Required string.                                                                                                           |
| `side`    | `"BUY" \| "SELL"` | No       | Optional enum. The route documents it, but price fetching currently ignores it and returns the raw upstream price payload. |

Success `200`

- Schema: `{ success: true, tokenID: string, side: "BUY" | "SELL" | "midpoint", price: unknown }`

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not handled locally; upstream failures become `500`.
- `500`: `{ success: false, error: string }`

Rate limiting

- `120` requests/minute/IP

Example

```http
GET /api/markets/price?tokenID=101&side=BUY HTTP/1.1
```

```json
{
  "success": true,
  "tokenID": "101",
  "side": "BUY",
  "price": {
    "price": 0.58
  }
}
```

### GET `/api/markets/slug/:slug`

Description: Looks up a market by slug using Gamma and returns the first match.

Headers

- Auth: none

Path parameters

| Name   | Type     | Required | Validation             |
| ------ | -------- | -------- | ---------------------- |
| `slug` | `string` | Yes      | Required path segment. |

Success `200`

- Schema: `{ success: true, market: object }`

Errors

- `400`: `{ success: false, error: "Market slug is required" }`
- `401`: Not used.
- `404`: `{ success: false, error: "Market not found" }`
- `500`: `{ success: false, error: string }`

Rate limiting

- `100` requests/minute/IP

Example

```http
GET /api/markets/slug/bitcoin-above-100k-in-2026 HTTP/1.1
```

```json
{
  "success": true,
  "market": {
    "id": "991",
    "slug": "bitcoin-above-100k-in-2026",
    "question": "Will Bitcoin trade above $100k in 2026?"
  }
}
```

### GET `/api/markets/trades/:tokenID`

Description: Passes through recent CLOB trades for a token.

Headers

- Auth: none

Path parameters

| Name      | Type     | Required | Validation             |
| --------- | -------- | -------- | ---------------------- |
| `tokenID` | `string` | Yes      | Required path segment. |

Success `200`

- Schema: `{ success: true, tokenID: string, trades: unknown }`

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not handled locally; upstream failures become `500`.
- `500`: `{ success: false, error: string }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/markets/trades/101 HTTP/1.1
```

```json
{
  "success": true,
  "tokenID": "101",
  "trades": [
    {
      "price": 0.58,
      "size": 250,
      "side": "BUY"
    }
  ]
}
```

## Price

### GET `/api/price/pol`

Description: Returns the current POL price in USD from CoinMarketCap, with a 5-minute in-memory cache.

Headers

- Auth: none

Request body

- None

Success `200`

- Schema:
  - `{ price: number, cached: boolean }`
  - On stale-cache fallback: `{ price: number, cached: true, stale: true }`

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: `{ error: "API key not configured" }` or `{ error: "Failed to fetch POL price" }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/price/pol HTTP/1.1
```

```json
{
  "price": 0.74,
  "cached": false
}
```

### GET `/api/price/tokens`

Description: Returns USD prices for a fixed token set and wrapped aliases, backed by CoinMarketCap with fallback values when the API is unavailable.

Headers

- Auth: none

Request body

- None

Success `200`

- Schema:
  - `prices: Record<string, number>`
  - `data: { symbol: string, price: number, percentChange24h: number }[]`
  - `cached: boolean`
  - `timestamp: number`
  - Optional: `stale`, `warning`, `error`
- Supported symbols in the returned map include `POL`, `MATIC`, `WMATIC`, `ETH`, `WETH`, `BTC`, `WBTC`, `USDC`, `USDC.e`, `USDT`, `DAI`.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: Not used; failures degrade to a `200` response with fallback prices and `stale: true`.

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/price/tokens HTTP/1.1
```

```json
{
  "prices": {
    "POL": 0.74,
    "MATIC": 0.74,
    "ETH": 3680.12,
    "WETH": 3680.12,
    "BTC": 102450.18,
    "WBTC": 102450.18,
    "USDC": 1,
    "USDT": 1,
    "DAI": 1
  },
  "data": [
    { "symbol": "POL", "price": 0.74, "percentChange24h": 2.1 },
    { "symbol": "ETH", "price": 3680.12, "percentChange24h": 1.3 }
  ],
  "cached": false,
  "timestamp": 1712051400000
}
```

## Search

### GET `/api/search`

Description: Searches Polymarket public search and augments events with a derived `topOutcome`.

Headers

- Auth: none

Query parameters

| Name    | Type     | Required | Validation                                                                                                                                                                         |
| ------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`     | `string` | No       | Sanitized with `sanitizeSearchQuery()`: trimmed, max 200 chars, control chars removed, and common injection characters such as `<`, `>`, `"`, `'`, `` ` ``, `;`, and `\` stripped. |
| `query` | `string` | No       | Used only when `q` is absent; the same sanitization is applied.                                                                                                                    |
| `limit` | `string` | No       | Passed through upstream without numeric validation. Default `"10"`.                                                                                                                |

Success `200`

- When query is empty: `{ events: [], tags: [], profiles: [], pagination: { hasMore: false, totalResults: 0 } }`
- Otherwise: raw upstream search payload with optional `events[].topOutcome = { name: string, price: number }`

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used locally; upstream non-OK responses are forwarded with the upstream status and `{ error: "Failed to search" }`.
- `500`: `{ error: "Internal server error" }`
- Other upstream failures: the handler returns the upstream HTTP status with `{ error: "Failed to search" }`.

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/search?q=bitcoin&limit=2 HTTP/1.1
```

```json
{
  "events": [
    {
      "id": "41001",
      "slug": "bitcoin-above-100k-in-2026",
      "title": "Will Bitcoin trade above $100k in 2026?",
      "topOutcome": {
        "name": "Yes",
        "price": 0.58
      }
    }
  ],
  "tags": [],
  "profiles": [],
  "pagination": {
    "hasMore": true,
    "totalResults": 12
  }
}
```

## Relayer And RPC

### GET `/api/relayer/:path*`

Description: Server-side proxy for a small allow-listed subset of Polymarket relayer endpoints. Used by web and extension trading flows so relayer credentials stay server-side.

Headers

- Auth:
  - Web app flow: first-party browser request that passes `checkOriginAndFetchSite()`
  - Extension flow: `Authorization: Bearer <extension-session-token>` with scope `relayer:submit`

Query parameters

- Passed through to the upstream relayer unchanged.
- The first path segment must be one of: `deployed`, `nonce`, `transaction`, `submit`.

Success `200`

- Schema: raw upstream relayer response body

Errors

- `400`: `{ error: "Path not allowed: /<segment>" }`
- `401`: Possible when bearer auth is supplied but invalid or expired.
- `403`: Possible when the request fails same-origin checks or extension auth checks.
- `404`: Not used locally; upstream statuses are forwarded.
- `413`: Not used for GET requests.
- `500`: `{ error: "Internal server error" }`
- `503`: `{ error: "Relayer not configured" }`
- `504`: `{ error: "Relayer request timed out" }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/relayer/deployed?address=0x1234... HTTP/1.1
Origin: https://knoww.app
Sec-Fetch-Site: same-origin
```

```json
{
  "deployed": true
}
```

### POST `/api/relayer/:path*`

Description: Same relayer proxy for JSON POST requests such as transaction submission.

Headers

- `Content-Type: application/json`
- Auth:
  - Web app flow: first-party browser request that passes `checkOriginAndFetchSite()`
  - Extension flow: `Authorization: Bearer <extension-session-token>` with scope `relayer:submit`

Request body

- Any valid JSON object or array.
- The first path segment must be one of: `deployed`, `nonce`, `transaction`, `submit`.
- Body size is capped at `16 KB` using both `Content-Length` and streamed byte counting.

Success `200`

- Schema: raw upstream relayer response body

Errors

- `400`: `{ error: "Path not allowed: /<segment>" }` or `{ error: "Invalid JSON payload" }`
- `401`: Possible when bearer auth is supplied but invalid or expired.
- `403`: Possible when the request fails same-origin checks or extension auth checks.
- `404`: Not used locally; upstream statuses are forwarded.
- `413`: `{ error: "Request body too large" }`
- `500`: `{ error: "Internal server error" }`
- `503`: `{ error: "Relayer not configured" }`
- `504`: `{ error: "Relayer request timed out" }`

Rate limiting

- `60` requests/minute/IP

Example

```http
POST /api/relayer/submit HTTP/1.1
Content-Type: application/json
Authorization: Bearer eyJ...

{"from":"0xabc...","to":"0xdef...","data":"0x1234","signature":"0x5678"}
```

```json
{
  "transactionID": "relayer_tx_123"
}
```

### POST `/api/rpc/polygon`

Description: Server-side JSON-RPC proxy to Polygon/Alchemy. Only read-safe JSON-RPC methods are allowed.

Headers

- `Content-Type: application/json`
- `Origin`: required and must match the allowed origin list

Request body

- Either a single JSON-RPC request object or a batch array.
- Body size limit: `100 KB`.
- Each request must contain a string `method`.
- Blocked methods include transaction submission, signing, account access, and debug/admin methods such as `eth_sendRawTransaction`, `personal_sign`, `eth_accounts`, and `debug_traceTransaction`.

Success `200`

- Schema: raw upstream JSON-RPC response object or array

Errors

- `400`: `{ error: "Invalid JSON payload" }`, `{ error: "Invalid JSON-RPC request" }`, or `{ error: "Invalid JSON-RPC request: missing method" }`
- `401`: Not used.
- `404`: Not used locally.
- `500`: `{ error: "Internal server error" }`
- `403`: `{ error: "Forbidden: origin not allowed" }` or `{ error: "RPC method not allowed through proxy: <method>" }`
- `413`: `{ error: "Request body too large" }`
- `504`: `{ error: "RPC request timed out" }`

Rate limiting

- `30` requests/minute/IP

Example

```http
POST /api/rpc/polygon HTTP/1.1
Content-Type: application/json
Origin: https://knoww.app

{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x5bad55"
}
```

### OPTIONS `/api/rpc/polygon`

Description: CORS preflight for the Polygon RPC proxy.

Headers

- `Origin`: required and must be allowed

Request body

- None

Success `200`

- Empty response with:
  - `Access-Control-Allow-Methods: POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type`
  - `Access-Control-Allow-Origin: <origin>` when allowed

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: Not used.
- `403`: Empty response when the origin is missing or disallowed.

Rate limiting

- No explicit rate limiter

Example

```http
OPTIONS /api/rpc/polygon HTTP/1.1
Origin: https://knoww.app
Access-Control-Request-Method: POST
```

## Sports

### GET `/api/sports/list`

Description: Returns the sports list from Gamma.

Headers

- Auth: none

Query parameters

| Name    | Type     | Required | Validation                                |
| ------- | -------- | -------- | ----------------------------------------- |
| `limit` | `string` | No       | Passed through upstream. Default `"100"`. |

Success `200`

- Schema: `{ success: true, count: number, sports: object }`
- The route treats the upstream response as an untyped value.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: string }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/sports/list?limit=5 HTTP/1.1
```

```json
{
  "success": true,
  "count": 2,
  "sports": [
    { "slug": "nfl", "label": "NFL" },
    { "slug": "nba", "label": "NBA" }
  ]
}
```

### GET `/api/sports/teams`

Description: Returns teams from Gamma with optional filters.

Headers

- Auth: none

Query parameters

| Name           | Type             | Required | Validation                        |
| -------------- | ---------------- | -------- | --------------------------------- |
| `limit`        | `string`         | No       | Optional string. Default `"100"`. |
| `offset`       | `string`         | No       | Optional string. Default `"0"`.   |
| `league`       | `string \| null` | No       | Optional nullable string.         |
| `name`         | `string \| null` | No       | Optional nullable string.         |
| `abbreviation` | `string \| null` | No       | Optional nullable string.         |

Success `200`

- Schema: `{ success: true, count: number, teams: object[] }`

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: string }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/sports/teams?league=nfl&limit=2 HTTP/1.1
```

```json
{
  "success": true,
  "count": 2,
  "teams": [
    { "name": "Kansas City Chiefs", "abbreviation": "KC" },
    { "name": "Buffalo Bills", "abbreviation": "BUF" }
  ]
}
```

### GET `/api/sports/markets`

Description: Returns sports markets from Gamma, filtered by league or sport tag when supplied.

Headers

- Auth: none

Query parameters

| Name           | Type             | Required | Validation                             |
| -------------- | ---------------- | -------- | -------------------------------------- |
| `sport`        | `string \| null` | No       | Optional nullable string.              |
| `league`       | `string \| null` | No       | Optional nullable string.              |
| `limit`        | `number`         | No       | Integer from `1` to `100`. Default `20`. |
| `after_cursor` | `string`         | No       | Optional keyset cursor for the next page. |

Success `200`

- Schema:
  - `success: true`
  - `count: number`
  - `markets: object[]`
  - `filters: { sport: string, league: string, tag: string }`
  - `pagination: { hasMore: boolean, nextCursor?: string | null }`

Errors

- `400`: `{ success: false, error: "offset is no longer supported; use after_cursor" }` or `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: "Failed to fetch sports markets" }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/sports/markets?league=nba&limit=2 HTTP/1.1
```

```json
{
  "success": true,
  "count": 1,
  "markets": [{ "id": "1201", "question": "Who will win the NBA Finals?" }],
  "filters": {
    "sport": "all",
    "league": "nba",
    "tag": "nba"
  },
  "pagination": {
    "hasMore": false,
    "nextCursor": null
  }
}
```

## Tags

### GET `/api/tags`

Description: Returns tags from Gamma when available, otherwise a built-in fallback tag list.

Headers

- Auth: none

Query parameters

| Name    | Type     | Required | Validation                          |
| ------- | -------- | -------- | ----------------------------------- |
| `limit` | `string` | No       | Passed upstream without validation. |

Success `200`

- Schema:
  - `success: true`
  - `count: number`
  - `tags: object[]`
  - `fallback: boolean`
  - Optional `error` when fallback is used after an exception

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used; unavailable upstream still returns fallback `200`.
- `500`: Not used; exceptions still return fallback `200`.

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/tags?limit=5 HTTP/1.1
```

```json
{
  "success": true,
  "count": 2,
  "tags": [
    { "tag": "sports", "label": "Sports" },
    { "tag": "politics", "label": "Politics" }
  ],
  "fallback": true
}
```

### GET `/api/tags/:slug`

Description: Returns normalized tag details for a tag slug. The handler canonicalizes aliases before calling Gamma.

Headers

- Auth: none

Path parameters

| Name   | Type     | Required | Validation             |
| ------ | -------- | -------- | ---------------------- |
| `slug` | `string` | Yes      | Required path segment. |

Success `200`

- Schema: `{ success: true, tag: object }`

Errors

- `400`: `{ success: false, error: "Tag slug is required" }`
- `401`: Not used.
- `404`: `{ success: false, error: "Tag not found: <canonicalSlug>" }`
- Other upstream non-OK statuses: forwarded with `{ success: false, error: "Tag not found: <canonicalSlug>" }`
- `500`: `{ success: false, error: "Unable to load tag details" }`

Rate limiting

- `100` requests/minute/IP

Example

```http
GET /api/tags/bitcoin HTTP/1.1
```

```json
{
  "success": true,
  "tag": {
    "id": "1",
    "slug": "bitcoin",
    "label": "Bitcoin"
  }
}
```

## User

### GET `/api/user/details`

Description: Looks up leaderboard-derived profile stats for a single user.

Headers

- Auth: none

Query parameters

| Name         | Type                                              | Required | Validation                                                   |
| ------------ | ------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `user`       | `string`                                          | Yes      | Must be a valid Ethereum address.                            |
| `timePeriod` | `"day" \| "week" \| "month" \| "all"`             | No       | Empty string / null become `undefined`; default `"day"`.     |
| `category`   | `"overall" \| "crypto" \| "sports" \| "politics"` | No       | Empty string / null become `undefined`; default `"overall"`. |

Success `200`

- Schema:
  - `success: true`
  - `user: string`
  - `timePeriod: string`
  - `category: string`
  - `details: null | { rank: number, proxyWallet: string, userName: string, xUsername: string | null, verifiedBadge: boolean, volume: number, pnl: number, profileImage: string | null }`
  - Optional `message` when the user is not found

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used; missing users return `200` with `details: null`.
- `500`: `{ success: false, error: string }` for local exceptions only.
- Other upstream failures: the handler returns the upstream HTTP status with `{ success: false, error: "Failed to fetch user details from Polymarket", details: number }`.

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/user/details?user=0x1111111111111111111111111111111111111111&timePeriod=week HTTP/1.1
```

```json
{
  "success": true,
  "user": "0x1111111111111111111111111111111111111111",
  "timePeriod": "week",
  "category": "overall",
  "details": {
    "rank": 18,
    "proxyWallet": "0x2222222222222222222222222222222222222222",
    "userName": "AvaTrades",
    "xUsername": "avatrades",
    "verifiedBadge": true,
    "volume": 210000,
    "pnl": 34000,
    "profileImage": null
  }
}
```

### GET `/api/user/public-profile`

Description: Fetches a public profile from Gamma.

Headers

- Auth: none

Query parameters

| Name      | Type     | Required | Validation                        |
| --------- | -------- | -------- | --------------------------------- |
| `address` | `string` | Yes      | Must be a valid Ethereum address. |

Success `200`

- Schema:
  - `success: true`
  - `profile: null | { createdAt: string, proxyWallet: string, displayUsernamePublic: boolean, pseudonym: string, name: string, bio?: string, profileImage?: string, bannerImage?: string, website?: string, twitter?: string, users: { id: string, creator: boolean, mod: boolean }[], verifiedBadge: boolean }`
  - Optional `message` when profile not found

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used; upstream 404 is normalized to `200` with `profile: null`.
- `500`: `{ success: false, error: string }` for local exceptions only.
- Other upstream failures: the handler returns the upstream HTTP status with `{ success: false, error: "Failed to fetch profile from Polymarket", details: number }`.

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/user/public-profile?address=0x1111111111111111111111111111111111111111 HTTP/1.1
```

```json
{
  "success": true,
  "profile": {
    "createdAt": "2025-01-10T12:00:00.000Z",
    "proxyWallet": "0x2222222222222222222222222222222222222222",
    "displayUsernamePublic": true,
    "pseudonym": "AvaTrades",
    "name": "Ava",
    "verifiedBadge": true,
    "users": []
  }
}
```

### GET `/api/user/portfolio-value`

Description: Returns marked-to-market portfolio value in USD.

Headers

- Auth: none

Query parameters

| Name   | Type     | Required | Validation                        |
| ------ | -------- | -------- | --------------------------------- |
| `user` | `string` | Yes      | Must be a valid Ethereum address. |

Success `200`

- Schema:
  - `success: true`
  - `user: string`
  - `portfolioValue: number`
  - `description: string`
  - `includes: string[]`
  - `excludes: string[]`

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used locally; upstream non-OK responses are forwarded with the upstream status and `{ success: false, error: "Failed to fetch portfolio value from Polymarket", details: number }`.
- `500`: `{ success: false, error: string }`
- `504`: `{ success: false, error: "Request to Polymarket timed out" }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/user/portfolio-value?user=0x2222222222222222222222222222222222222222 HTTP/1.1
```

```json
{
  "success": true,
  "user": "0x2222222222222222222222222222222222222222",
  "portfolioValue": 18450.33,
  "description": "Total current positions value in USD (marked to market)",
  "includes": [
    "Value of YES/NO tokens held",
    "Value of fully matched trades",
    "Unrealized P/L"
  ],
  "excludes": ["Open order collateral", "Unused USDC balance"]
}
```

### GET `/api/user/positions`

Description: Returns current positions, plus separately tracked lost positions filtered from the upstream feed.

Headers

- Auth: none

Query parameters

| Name            | Type     | Required | Validation                                                                      |
| --------------- | -------- | -------- | ------------------------------------------------------------------------------- |
| `user`          | `string` | Yes      | Must be a valid Ethereum address.                                               |
| `limit`         | `number` | No       | String or number accepted, coerced to number, min `1`, max `100`, default `50`. |
| `offset`        | `number` | No       | String or number accepted, coerced to number, min `0`, default `0`.             |
| `sizeThreshold` | `number` | No       | String or number accepted, coerced to number, default `0.1`.                    |
| `market`        | `string` | No       | Empty string becomes `undefined`.                                               |

Success `200`

- Schema:
  - `success: true`
  - `user: string`
  - `positions: Position[]`
  - `lostPositions: LostPosition[]`
  - `summary: { totalValue: number, totalUnrealizedPnl: number, totalRealizedPnl: number, totalPnl: number, positionCount: number }`
  - `pagination: { limit: number, offset: number, hasMore: boolean }`
- `Position` includes `id`, `asset`, `conditionId`, `outcomeIndex`, `outcome`, `oppositeOutcome`, `size`, `avgPrice`, `currentPrice`, `currentValue`, `initialValue`, `unrealizedPnl`, `unrealizedPnlPercent`, `realizedPnl`, `realizedPnlPercent`, `totalBought`, `redeemable`, `mergeable`, `negRisk`, and nested `market`.
- `LostPosition` includes `id`, `asset`, `conditionId`, `outcomeIndex`, `outcome`, `size`, `avgPrice`, `initialValue`, `endDate`, and nested `market`.

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used locally; upstream non-OK responses are forwarded with the upstream status and `{ success: false, error: "Failed to fetch positions from Polymarket", details: number }`.
- `500`: `{ success: false, error: "Unknown error" }`
- `502`: `{ success: false, error: "Failed to reach Polymarket positions API" }`
- `504`: `{ success: false, error: "Request to Polymarket timed out" }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/user/positions?user=0x2222222222222222222222222222222222222222&limit=2 HTTP/1.1
```

```json
{
  "success": true,
  "user": "0x2222222222222222222222222222222222222222",
  "positions": [
    {
      "id": "0xabc-0",
      "asset": "101",
      "conditionId": "0xabc",
      "outcomeIndex": 0,
      "outcome": "Yes",
      "size": 150,
      "avgPrice": 0.44,
      "currentPrice": 0.58,
      "currentValue": 87,
      "initialValue": 66,
      "unrealizedPnl": 21,
      "realizedPnl": 0,
      "market": {
        "title": "Will Bitcoin trade above $100k in 2026?",
        "slug": "bitcoin-above-100k-in-2026",
        "eventSlug": "bitcoin-above-100k-in-2026",
        "eventId": "41001",
        "icon": "https://polymarket-upload.s3.amazonaws.com/bitcoin.png",
        "endDate": "2026-12-31T23:59:59.000Z",
        "negativeRisk": false
      }
    }
  ],
  "lostPositions": [],
  "summary": {
    "totalValue": 87,
    "totalUnrealizedPnl": 21,
    "totalRealizedPnl": 0,
    "totalPnl": 21,
    "positionCount": 1
  },
  "pagination": {
    "limit": 2,
    "offset": 0,
    "hasMore": false
  }
}
```

### GET `/api/user/trades`

Description: Returns transformed user activity history with summary aggregates.

Headers

- Auth: none

Query parameters

| Name            | Type                                                 | Required | Validation                                                                       |
| --------------- | ---------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `user`          | `string`                                             | Yes      | Must be a valid Ethereum address.                                                |
| `limit`         | `number`                                             | No       | String or number accepted, coerced to number, min `1`, max `100`, default `100`. |
| `offset`        | `number`                                             | No       | String or number accepted, coerced to number, min `0`, default `0`.              |
| `sortBy`        | `string`                                             | No       | Empty string becomes `undefined`; default `"TIMESTAMP"`.                         |
| `sortDirection` | `"ASC" \| "DESC"`                                    | No       | Default `"DESC"`.                                                                |
| `market`        | `string`                                             | No       | Empty string becomes `undefined`.                                                |
| `type`          | `"TRADE" \| "REDEEM" \| "MERGE" \| "SPLIT" \| "ALL"` | No       | Null/undefined become `"ALL"`.                                                   |

Success `200`

- Schema:
  - `success: true`
  - `user: string`
  - `trades: Trade[]`
  - `summary: { totalVolume: number, buyVolume: number, sellVolume: number, tradeCount: number, uniqueMarkets: number }`
  - `dailySummary: Record<string, { count: number, volume: number }>`
  - `pagination: { limit: number, offset: number, hasMore: boolean }`

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used locally; upstream non-OK responses are forwarded with the upstream status and `{ success: false, error: "Failed to fetch trades from Polymarket", details: number }`.
- `500`: `{ success: false, error: string }`
- `504`: `{ success: false, error: "Request to Polymarket timed out" }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/user/trades?user=0x2222222222222222222222222222222222222222&type=TRADE&limit=2 HTTP/1.1
```

```json
{
  "success": true,
  "user": "0x2222222222222222222222222222222222222222",
  "trades": [
    {
      "id": "0xtradehash",
      "timestamp": "2026-04-02T09:45:00.000Z",
      "timestampUnix": 1712051100,
      "type": "TRADE",
      "side": "BUY",
      "size": 100,
      "price": 0.58,
      "usdcAmount": 58,
      "outcomeIndex": 0,
      "outcome": "Yes",
      "transactionHash": "0xtradehash",
      "user": {
        "name": "Ava",
        "pseudonym": "AvaTrades",
        "profileImage": null
      },
      "market": {
        "conditionId": "0xabc",
        "title": "Will Bitcoin trade above $100k in 2026?",
        "slug": "bitcoin-above-100k-in-2026",
        "eventSlug": "bitcoin-above-100k-in-2026",
        "icon": null,
        "asset": "101"
      }
    }
  ],
  "summary": {
    "totalVolume": 58,
    "buyVolume": 58,
    "sellVolume": 0,
    "tradeCount": 1,
    "uniqueMarkets": 1
  },
  "dailySummary": {
    "2026-04-02": {
      "count": 1,
      "volume": 58
    }
  },
  "pagination": {
    "limit": 2,
    "offset": 0,
    "hasMore": false
  }
}
```

### GET `/api/user/pnl-history`

Description: Returns chart-ready P&L time series plus summary stats.

Headers

- Auth: none

Query parameters

| Name       | Type                                                      | Required | Validation                        |
| ---------- | --------------------------------------------------------- | -------- | --------------------------------- |
| `user`     | `string`                                                  | Yes      | Must be a valid Ethereum address. |
| `interval` | `"6h" \| "12h" \| "1d" \| "1w" \| "1m" \| "all" \| "max"` | No       | Null/undefined become `"1m"`.     |
| `fidelity` | `"1h" \| "1d" \| "1w"`                                    | No       | Null/undefined become `"1d"`.     |

Success `200`

- Schema:
  - `success: true`
  - `user: string`
  - `interval: string`
  - `fidelity: string`
  - `data: { timestamp: string, date: string, pnl: number }[]`
  - `summary: { startPnl: number, endPnl: number, change: number, changePercent: number, high: number, low: number, dataPoints?: number }`

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used locally; upstream non-OK responses are forwarded with the upstream status and `{ success: false, error: "Failed to fetch P&L history from Polymarket", details: number }`.
- `500`: `{ success: false, error: string }`

Rate limiting

- `30` requests/minute/IP

Example

```http
GET /api/user/pnl-history?user=0x2222222222222222222222222222222222222222&interval=1m&fidelity=1d HTTP/1.1
```

```json
{
  "success": true,
  "user": "0x2222222222222222222222222222222222222222",
  "interval": "1m",
  "fidelity": "1d",
  "data": [
    {
      "timestamp": "2026-03-01T00:00:00.000Z",
      "date": "3/1/2026",
      "pnl": 1200
    },
    { "timestamp": "2026-04-01T00:00:00.000Z", "date": "4/1/2026", "pnl": 3400 }
  ],
  "summary": {
    "startPnl": 1200,
    "endPnl": 3400,
    "change": 2200,
    "changePercent": 183.33333333333331,
    "high": 3400,
    "low": 1200,
    "dataPoints": 2
  }
}
```

### GET `/api/user/pnl`

Description: Computes aggregate P&L, portfolio, trading, and performance metrics by combining multiple upstream sources.

Headers

- Auth: none

Query parameters

| Name             | Type                                                | Required | Validation                                                                         |
| ---------------- | --------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `user`           | `string`                                            | Yes      | Must be a valid Ethereum address.                                                  |
| `period`         | `"1d" \| "7d" \| "30d" \| "90d" \| "365d" \| "all"` | No       | Null/undefined become `"all"`.                                                     |
| `includeHistory` | `boolean`                                           | No       | Accepts string or boolean. `"true"` becomes `true`; null/undefined become `false`. |

Success `200`

- Schema:
  - `success: true`
  - `user: string`
  - `period: string`
  - `pnl: { realized: number, unrealized: number, total: number, roi: number }`
  - `portfolio: { currentValue: number, initialInvestment: number, positionCount: number }`
  - `trading: { totalBuyValue: number, totalSellValue: number, netFlow: number, tradeCount: number, uniqueMarkets: number }`
  - `performance: { winRate: number, winningPositions: number, losingPositions: number, bestPerformer: object | null, worstPerformer: object | null }`
  - Optional `history: Record<string, { realized: number, trades: number, volume: number }>`
  - `pnlHistory: { t: number, p: number }[] | null`

Errors

- `400`: `{ success: false, error: "Invalid query parameters", details: string }`
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: string }`

Rate limiting

- `30` requests/minute/IP

Example

```http
GET /api/user/pnl?user=0x2222222222222222222222222222222222222222&period=30d&includeHistory=true HTTP/1.1
```

```json
{
  "success": true,
  "user": "0x2222222222222222222222222222222222222222",
  "period": "30d",
  "pnl": {
    "realized": 800,
    "unrealized": 2600,
    "total": 3400,
    "roi": 18.4
  },
  "portfolio": {
    "currentValue": 18450.33,
    "initialInvestment": 15050.33,
    "positionCount": 14
  },
  "trading": {
    "totalBuyValue": 9200,
    "totalSellValue": 5800,
    "netFlow": 3400,
    "tradeCount": 27,
    "uniqueMarkets": 11
  },
  "performance": {
    "winRate": 61.5,
    "winningPositions": 8,
    "losingPositions": 5,
    "bestPerformer": {
      "title": "Will Bitcoin trade above $100k in 2026?",
      "slug": "bitcoin-above-100k-in-2026",
      "outcome": "Yes",
      "pnl": 1400,
      "pnlPercent": 42
    },
    "worstPerformer": null
  },
  "history": {
    "2026-04-02": {
      "realized": 0,
      "trades": 3,
      "volume": 640
    }
  },
  "pnlHistory": [
    { "t": 1710000000, "p": 1200 },
    { "t": 1712051400, "p": 3400 }
  ]
}
```

## Wallet

### POST `/api/wallet/validate`

Description: Validates that the supplied wallet address is syntactically valid.

Headers

- `Content-Type: application/json`
- Auth: none

Request body

| Field         | Type     | Required | Validation                                           |
| ------------- | -------- | -------- | ---------------------------------------------------- |
| `userAddress` | `string` | Yes      | Min length `1` and must be a valid Ethereum address. |

Success `200`

- Schema: `{ success: true, userAddress: string, isValid: true, message: "Valid Ethereum address" }`

Errors

- `400`: `{ success: false, error: "Invalid request body", details: string }`
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, error: string }`

Rate limiting

- `30` requests/minute/IP

Example

```http
POST /api/wallet/validate HTTP/1.1
Content-Type: application/json

{"userAddress":"0x1111111111111111111111111111111111111111"}
```

```json
{
  "success": true,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "isValid": true,
  "message": "Valid Ethereum address"
}
```

### GET `/api/wallet/balances`

Description: Deprecated. Always returns `410 Gone`.

Headers

- Auth: none

Request body

- None

Success

- No `200/201` success path exists.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: Not used.
- `410`: `{ success: false, error: string, hint: string }`

Rate limiting

- No explicit rate limiter

Example

```http
GET /api/wallet/balances HTTP/1.1
```

```json
{
  "success": false,
  "error": "This endpoint has been deprecated. Use wagmi's useBalance hook or the frontend useClobClient hook instead.",
  "hint": "Wallet operations require user wallet authentication which is now handled on the frontend."
}
```

### GET `/api/wallet/positions`

Description: Deprecated. Always returns `410 Gone`.

Headers

- Auth: none

Request body

- None

Success

- No `200/201` success path exists.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: Not used.
- `410`: `{ success: false, error: string, hint: string }`

Rate limiting

- `60` requests/minute/IP

Example

```http
GET /api/wallet/positions HTTP/1.1
```

```json
{
  "success": false,
  "error": "This endpoint has been deprecated. Use the frontend useClobClient hook's getOpenOrders() method instead.",
  "hint": "Wallet operations require user wallet authentication which is now handled on the frontend."
}
```

## Whales

### GET `/api/whales/activity`

Description: Aggregates large recent whale trades from leaderboard wallets plus a global trade scan, then deduplicates by transaction hash.

Headers

- Auth: none

Query parameters

| Name             | Type                                  | Required | Validation                                                                                                   |
| ---------------- | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `whaleCount`     | `number`                              | No       | Parsed integer, clamped to `5..100`, default `25`.                                                           |
| `minTradeSize`   | `number`                              | No       | Parsed float, defaults to `100` if invalid or negative.                                                      |
| `tradesPerWhale` | `number`                              | No       | Parsed integer, clamped to `1..100`, default `50`. Multiplied by `2` for `MONTH` and `ALL`, capped at `100`. |
| `timePeriod`     | `"DAY" \| "WEEK" \| "MONTH" \| "ALL"` | No       | Invalid values fall back to `WEEK`.                                                                          |

Success `200`

- Schema:
  - `success: true`
  - `activities: WhaleActivity[]`
  - `whaleCount: number`
  - `totalTrades: number`
  - `lastUpdated: string`
  - `dataAge: number`
- `WhaleActivity` contains nested `trader`, `trade`, `market`, and `source: "leaderboard" | "global_scan"`.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, activities: [], whaleCount: 0, totalTrades: 0, lastUpdated: string, dataAge: number, error: string }`

Rate limiting

- `15` requests/minute/IP

Example

```http
GET /api/whales/activity?whaleCount=10&minTradeSize=5000&timePeriod=WEEK HTTP/1.1
```

```json
{
  "success": true,
  "activities": [
    {
      "id": "0xtradehash",
      "timestamp": "2026-04-02T09:45:00.000Z",
      "trader": {
        "address": "0x2222222222222222222222222222222222222222",
        "name": "SharpMoney",
        "profileImage": null,
        "rank": 1,
        "totalPnl": 143000,
        "totalVolume": 1250000
      },
      "trade": {
        "side": "BUY",
        "size": 10000,
        "price": 0.62,
        "usdcAmount": 6200,
        "outcome": "Yes",
        "outcomeIndex": 0
      },
      "market": {
        "conditionId": "0xabc",
        "title": "Will Bitcoin trade above $100k in 2026?",
        "slug": "bitcoin-above-100k-in-2026",
        "eventSlug": "bitcoin-above-100k-in-2026",
        "image": null,
        "tokenId": "101"
      },
      "source": "leaderboard"
    }
  ],
  "whaleCount": 10,
  "totalTrades": 1,
  "lastUpdated": "2026-04-02T10:00:00.000Z",
  "dataAge": 412
}
```

### GET `/api/whales/backtest`

Description: Runs the insider-detector backtest against recently resolved Polymarket markets. This route executes in the Node.js runtime and can take tens of seconds because it paginates markets, trades, price history, and trader histories.

Headers

- Auth: none

Query parameters

| Name               | Type     | Required | Validation                                                                   |
| ------------------ | -------- | -------- | ---------------------------------------------------------------------------- |
| `maxDaysAgo`       | `number` | No       | Parsed integer, clamped to `2..60`, default `21`.                            |
| `minDaysAgo`       | `number` | No       | Parsed integer, clamped to `0..30`, default `2`. Must be less than `maxDaysAgo`. |
| `minDurationHours` | `number` | No       | Parsed integer, clamped to `0..720`, default `24`.                           |
| `minVolumeUsd`     | `number` | No       | Parsed float, clamped to `0..10000000`, default `5000`.                      |
| `maxMarkets`       | `number` | No       | Parsed integer, clamped to `1..40`, default `20`.                            |
| `minScore`         | `number` | No       | Parsed integer, clamped to `1..100`, default `30`; stored as `minSuspicionScore`. |
| `minTradeUsd`      | `number` | No       | Parsed float, clamped to `0..1000000`, default `500`.                        |

Success `200`

- Schema:
  - `generatedAt: string`
  - `options: { maxDaysAgo: number, minDaysAgo: number, minDurationHours: number, minVolumeUsd: number, maxMarkets: number, minSuspicionScore: number, minTradeUsd: number }`
  - `marketsScanned: number`
  - `totalTrades: number`
  - `eligibleTrades: number`
  - `flaggedTrades: number`
  - `uniqueFlaggedWallets: number`
  - `baseline: PnlAggregate`
  - `flagged: PnlAggregate`
  - `winRateLift: number`
  - `meanProfitLift: number`
  - `precisionAtK: { k: number, precision: number, n: number }[]`
  - `perMarket: { conditionId: string, question: string, volumeUsd: number, totalTrades: number, eligibleTrades: number, flaggedTrades: number, baseline: PnlAggregate, flagged: PnlAggregate }[]`
  - `perArchetype: { archetype: "account_loader" | "size_hider" | "timing_cluster", label: string, flaggedCount: number, aggregate: PnlAggregate, winRateLift: number, precisionAtK: { k: number, precision: number, n: number }[] }[]`
  - `topFlagged: object[]`
  - `runtimeMs: number`
  - `resolvedMarketsDiagnostics: { pagesFetched: number, rawMarketsSeen: number, drops: { parse: number, tooOld: number, tooFresh: number, draw: number, dur: number, vol: number, uma: number, outcomes: number } }`
- `PnlAggregate` contains `count`, `wins`, `losses`, `pushes`, `winRate`, `totalProfit`, `meanProfit`, `meanProfitPerShare`, and `totalVolume`.

Errors

- `400`: `{ error: "minDaysAgo must be less than maxDaysAgo" }`
- `401`: Not used.
- `404`: Not used.
- `429`: `{ success: false, error: "Too many requests. Please try again later.", rateLimit: object }`
- `500`: `{ error: "Backtest failed" }`

Rate limiting

- `2` requests per `5` minutes/IP

Example

```http
GET /api/whales/backtest?maxDaysAgo=21&minDaysAgo=2&maxMarkets=10&minScore=30 HTTP/1.1
```

```json
{
  "generatedAt": "2026-04-23T03:30:23.335Z",
  "marketsScanned": 10,
  "flaggedTrades": 27,
  "winRateLift": 1.34,
  "runtimeMs": 48211
}
```

### GET `/api/whales/suspicious`

Description: Detects suspicious large trades by new accounts, scores them, and returns factor breakdowns.

Headers

- Auth: none

Query parameters

| Name            | Type     | Required | Validation                                                |
| --------------- | -------- | -------- | --------------------------------------------------------- |
| `maxAccountAge` | `number` | No       | Parsed integer, clamped to `1..336`, default `168` hours. |
| `minUsdValue`   | `number` | No       | Parsed float, min `0`, default `5000`.                    |
| `minShares`     | `number` | No       | Parsed float, min `0`, default `0`.                       |
| `minScore`      | `number` | No       | Parsed integer, min `0`, default `30`.                    |
| `limit`         | `number` | No       | Parsed integer, clamped to `1..200`, default `50`.        |

Success `200`

- Schema:
  - `success: true`
  - `activities: SuspiciousActivity[]`
  - `stats: { totalTradesScanned: number, uniqueTradersFound: number, newAccountsFound: number, suspiciousActivities: number, criticalCount: number, highCount: number, mediumCount: number, repeatOffenders: number }`
  - `lastUpdated: string`
- `SuspiciousActivity` contains nested `account`, `trade`, `market`, and `analysis` with `suspicionScore`, `confidence`, `factors`, `repeatOffender`, and `marketsInvolved`.

Errors

- `400`: Not used.
- `401`: Not used.
- `404`: Not used.
- `500`: `{ success: false, activities: [], stats: {...zeros}, lastUpdated: string, error: string }`

Rate limiting

- `10` requests/minute/IP

Example

```http
GET /api/whales/suspicious?minUsdValue=5000&minScore=35&limit=2 HTTP/1.1
```

```json
{
  "success": true,
  "activities": [
    {
      "id": "0xtradehash",
      "timestamp": "2026-04-02T09:45:00.000Z",
      "account": {
        "address": "0x3333333333333333333333333333333333333333",
        "name": null,
        "profileImage": null,
        "firstTradeDate": "2026-04-02T06:00:00.000Z",
        "accountAgeHours": 3.75,
        "totalTrades": 1
      },
      "trade": {
        "side": "BUY",
        "outcome": "Yes",
        "outcomeIndex": 0,
        "size": 10000,
        "price": 0.11,
        "usdcAmount": 1100
      },
      "market": {
        "conditionId": "0xabc",
        "title": "Will Candidate A win?",
        "slug": "candidate-a-win",
        "eventSlug": "candidate-a-win",
        "image": null,
        "currentPrice": 0.11
      },
      "analysis": {
        "suspicionScore": 40,
        "confidence": "MEDIUM",
        "isContrarian": true,
        "marketSentiment": "BEARISH",
        "reason": "Very new account (3.8h old); Only 1 total trade(s) — almost no history",
        "factors": [
          {
            "name": "Account Age",
            "points": 35,
            "description": "Very new account (3.8h old)"
          }
        ],
        "repeatOffender": false,
        "marketsInvolved": 1
      }
    }
  ],
  "stats": {
    "totalTradesScanned": 500,
    "uniqueTradersFound": 120,
    "newAccountsFound": 8,
    "suspiciousActivities": 1,
    "criticalCount": 0,
    "highCount": 0,
    "mediumCount": 1,
    "repeatOffenders": 0
  },
  "lastUpdated": "2026-04-02T10:00:00.000Z"
}
```
