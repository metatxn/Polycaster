# Web Security & Server Performance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the server-side security and performance findings from the 2026-06-10 codebase review in `apps/web` (JSON-LD XSS, rate-limiter Workers bug, LLM cost-abuse hardening, whales route caching, KB build `waitUntil`, events/[id] parallelization, middleware matcher).

**Architecture:** All changes are confined to `apps/web`. Security fixes add a safe JSON-LD serializer, a lazily-swept rate limiter, and trust-aware rate limiting on the AI routes (Bearer-session callers keep current limits; spoofable Origin/Referer callers get an additional per-day bucket). Performance fixes add edge cache headers to the whales routes and `/api/events/[id]`, parallelize independent upstream fetches, register the insider knowledge-base build with the Workers execution context, and exclude static assets from the middleware matcher.

**Tech Stack:** Next.js 15 App Router on Cloudflare Workers via `@opennextjs/cloudflare`, vitest (jsdom, globals on), biome, pnpm workspace.

**Decisions made with the user (2026-06-10):**

1. AI routes: harden the low-trust fallback (per-day cap) but KEEP the anonymous extension flow working — do NOT require Bearer.
2. Scope: server fixes only. Client-bundle work (lazy AppKit, landing split, fonts) is a separate follow-up plan.
3. The third extension ID `chrome-extension://cefhmagobkjigobnmhnhldofoangmhei` is the **dev-environment build — keep it**, just fix the misleading `// remove this later` comment.

**Out of scope (deferred):** challenge-token replay (needs KV/R2 state), shared rate-limit store (WAF/KV/DO), all `apps/agent` findings, all client-bundle perf findings, quality/duplication refactors.

> **IMPORTANT — no git commits.** The repo owner commits manually. Never run `git add` or `git commit`. Leave all changes uncommitted in the working tree. Where a normal TDD loop would say "commit", just move on to the next step.

**Commands cheat-sheet** (run from `apps/web/`):

- Single test file: `pnpm vitest run src/lib/json-ld.test.ts`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`

---

### Task 1: Safe JSON-LD serializer (XSS fix)

**Files:**

- Create: `apps/web/src/lib/json-ld.ts`
- Create: `apps/web/src/lib/json-ld.test.ts`
- Modify: `apps/web/src/app/events/detail/[slug]/page.tsx:81`
- Modify: `apps/web/src/app/layout.tsx:150`

Background: `JSON.stringify` escapes quotes but not `<`. An event title/description containing the literal text `</script><script>…` terminates the inline JSON-LD `<script>` block and injects executable markup. Event titles come from upstream Polymarket data, so this is externally influenced. Escaping `<` as `\u003c` is JSON-identical (`JSON.parse` returns the same value) but can never close the script element.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/json-ld.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "./json-ld";

describe("serializeJsonLd", () => {
  it("round-trips plain values unchanged", () => {
    const value = { name: "Will BTC close above $100k?", nested: { n: 1 } };
    expect(JSON.parse(serializeJsonLd(value))).toEqual(value);
  });

  it("escapes </script> so the payload cannot break out of the script tag", () => {
    const value = { name: "pwn</script><script>alert(1)</script>" };
    const serialized = serializeJsonLd(value);
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it("escapes U+2028/U+2029 line separators", () => {
    const value = { name: "a\u2028b\u2029c" };
    const serialized = serializeJsonLd(value);
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(JSON.parse(serialized)).toEqual(value);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `pnpm vitest run src/lib/json-ld.test.ts`
Expected: FAIL — `Cannot find module './json-ld'` (or similar resolution error).

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/json-ld.ts`:

```ts
/**
 * Safe serialization for embedding JSON-LD inside
 * <script type="application/ld+json"> blocks.
 *
 * JSON.stringify alone is NOT safe for inline <script> content: a string
 * value containing "</script>" terminates the script element early and the
 * remainder is parsed as HTML — i.e. markup/script injection. Escaping "<"
 * as \u003c (plus the JS line separators U+2028/U+2029) yields a byte-
 * different but JSON-identical payload: JSON.parse returns the same value,
 * and breakout becomes impossible.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/json-ld.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Use the serializer at both injection sites**

In `apps/web/src/app/events/detail/[slug]/page.tsx`, add to the imports from `@/lib/...` block:

```ts
import { serializeJsonLd } from "@/lib/json-ld";
```

and change line 81:

```tsx
// before
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
// after
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
```

In `apps/web/src/app/layout.tsx`, add the same import and change line 150 identically (the layout JSON-LD is static site data today, but using the safe serializer everywhere means no future copy-paste reintroduces the bug).

- [ ] **Step 6: Verify no other unsafe JSON-LD sites remain**

Run: `grep -rn "JSON.stringify(jsonLd)" apps/web/src`
Expected: no matches.

Run: `pnpm typecheck`
Expected: clean.

---

### Task 2: Rate limiter — replace module-scope `setInterval` with lazy sweep

**Files:**

- Modify: `apps/web/src/lib/rate-limit.ts:90-100`
- Create: `apps/web/src/lib/rate-limit.test.ts`

Background: `setInterval` at module scope is unreliable on Cloudflare Workers (timers set outside a request context may never fire or can throw at init), so the cleanup never runs and `rateLimitMap` only sheds entries via lazy overwrite. Fix: sweep expired entries opportunistically inside `rateLimit()`, at most once per minute.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/rate-limit.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _rateLimitStoreSize,
  _resetRateLimitStore,
  rateLimit,
} from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00Z"));
    _resetRateLimitStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit and then blocks", () => {
    const opts = { interval: 60_000, uniqueTokenPerInterval: 3 };
    expect(rateLimit("ip-1", opts).success).toBe(true);
    expect(rateLimit("ip-1", opts).success).toBe(true);
    expect(rateLimit("ip-1", opts).success).toBe(true);
    expect(rateLimit("ip-1", opts).success).toBe(false);
  });

  it("resets after the interval", () => {
    const opts = { interval: 60_000, uniqueTokenPerInterval: 1 };
    expect(rateLimit("ip-2", opts).success).toBe(true);
    expect(rateLimit("ip-2", opts).success).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(rateLimit("ip-2", opts).success).toBe(true);
  });

  it("sweeps expired entries without a module-level timer", () => {
    const opts = { interval: 1_000, uniqueTokenPerInterval: 5 };
    rateLimit("old-1", opts);
    rateLimit("old-2", opts);
    expect(_rateLimitStoreSize()).toBe(2);

    // Both entries are long expired; the next call (any key) triggers the
    // lazy sweep and removes them.
    vi.advanceTimersByTime(61_000);
    rateLimit("fresh", opts);
    expect(_rateLimitStoreSize()).toBe(1); // only "fresh" remains
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/rate-limit.test.ts`
Expected: FAIL — `_rateLimitStoreSize` / `_resetRateLimitStore` are not exported (and the sweep assertion fails).

- [ ] **Step 3: Implement the lazy sweep**

In `apps/web/src/lib/rate-limit.ts`, DELETE lines 90-100 (the entire `setInterval` block and its comment):

```ts
/**
 * Cleanup old entries periodically to prevent memory leaks
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap.entries()) {
    if (now > value.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60 * 1000); // Clean up every minute
```

Replace with:

```ts
/**
 * Opportunistic cleanup. Module-scope timers are unreliable on Cloudflare
 * Workers (timers set outside a request context may never fire), so expired
 * entries are swept lazily: at most once per SWEEP_INTERVAL_MS, piggybacked
 * on an incoming rateLimit() call.
 */
const SWEEP_INTERVAL_MS = 60 * 1000;
let lastSweepAt = 0;

function sweepExpiredEntries(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, value] of rateLimitMap.entries()) {
    if (now > value.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}

/** Test-only introspection helper. Not for production use. */
export function _rateLimitStoreSize(): number {
  return rateLimitMap.size;
}

/** Test-only reset helper. Not for production use. */
export function _resetRateLimitStore(): void {
  rateLimitMap.clear();
  lastSweepAt = 0;
}
```

Then inside `rateLimit()`, immediately after `const now = Date.now();` (line 50), add:

```ts
sweepExpiredEntries(now);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/rate-limit.test.ts`
Expected: PASS (3 tests).

---

### Task 3: `keySuffix` support in `checkRateLimit`

**Files:**

- Modify: `apps/web/src/lib/api-rate-limit.ts:103-115`
- Create: `apps/web/src/lib/api-rate-limit.test.ts`

Background: Task 4 needs two independent rate-limit windows on the same route+IP (per-minute AND per-day). Today the bucket key is always `route:ip`, so two `checkRateLimit` calls would double-count into one bucket. Add an optional `keySuffix` discriminator.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/api-rate-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "./api-rate-limit";
import { _resetRateLimitStore } from "./rate-limit";

function makeRequest(ip: string): NextRequest {
  return {
    headers: new Headers({ "cf-connecting-ip": ip }),
    nextUrl: new URL("http://localhost/api/ai/extract-topics"),
  } as unknown as NextRequest;
}

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitStore();
  });

  it("returns null under the limit and 429 over it", () => {
    const req = makeRequest("1.1.1.1");
    const opts = { interval: 60_000, uniqueTokenPerInterval: 2 };
    expect(checkRateLimit(req, opts)).toBeNull();
    expect(checkRateLimit(req, opts)).toBeNull();
    const blocked = checkRateLimit(req, opts);
    expect(blocked?.status).toBe(429);
  });

  it("keySuffix creates an independent bucket on the same route+ip", () => {
    const req = makeRequest("2.2.2.2");
    const tight = { interval: 60_000, uniqueTokenPerInterval: 1 };
    expect(checkRateLimit(req, tight)).toBeNull();
    expect(checkRateLimit(req, tight)).not.toBeNull(); // base bucket exhausted
    // Same route+ip but suffixed bucket is fresh:
    expect(checkRateLimit(req, { ...tight, keySuffix: "daily" })).toBeNull();
  });
});
```

Note: if `next/server` fails to import under jsdom, add `// @vitest-environment node` as the first line of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/api-rate-limit.test.ts`
Expected: first test PASSES, second test FAILS (the suffixed call is blocked because `keySuffix` is ignored — TypeScript may also reject the unknown option at typecheck).

- [ ] **Step 3: Implement `keySuffix`**

In `apps/web/src/lib/api-rate-limit.ts`, change the `checkRateLimit` signature and key derivation (lines 103-115):

```ts
export function checkRateLimit(
  request: NextRequest,
  options?: {
    interval?: number;
    uniqueTokenPerInterval?: number;
    /**
     * Optional bucket discriminator. Lets one route enforce several
     * independent windows (e.g. a per-minute and a per-day limit) without
     * the two checks double-counting into the same bucket.
     */
    keySuffix?: string;
  }
): NextResponse | null {
  const baseKey = getRateLimitKey(request);
  const identifier = options?.keySuffix
    ? `${baseKey}:${options.keySuffix}`
    : baseKey;

  const rateLimitResult = rateLimit(identifier, {
    interval: options?.interval || 60 * 1000, // Default: 1 minute
    uniqueTokenPerInterval: options?.uniqueTokenPerInterval || 60, // Default: 60 req/min
  });
```

(The rest of the function body — the 429 construction — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/api-rate-limit.test.ts`
Expected: PASS (2 tests).

---

### Task 4: Trust-aware AI rate limiting (LLM cost-abuse hardening)

**Files:**

- Modify: `apps/web/src/lib/extension-auth.ts:10,118-132`
- Create: `apps/web/src/lib/extension-auth.test.ts`
- Create: `apps/web/src/lib/ai-rate-limit.ts`
- Create: `apps/web/src/lib/ai-rate-limit.test.ts`
- Modify: `apps/web/src/app/api/ai/extract-topics/route.ts:461-476,518-533`
- Modify: `apps/web/src/app/api/ai/validate-relevance/route.ts:231-246`

Background: when no Bearer token is present, the AI routes fall back to Origin/Referer checks, which any curl client can forge. Per the user's decision we keep that anonymous flow but make sustained abuse expensive: low-trust callers additionally consume from a per-day bucket (300/day per IP per route). Bearer-session callers keep today's limits exactly.

- [ ] **Step 1: Write the failing test for trust-aware pre-auth**

Create `apps/web/src/lib/extension-auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/extension-session", () => ({
  requireExtensionSession: vi.fn(async () => ({
    response: null,
    session: { sub: "0xabc" },
  })),
}));

import { requireExtensionSession } from "@/lib/auth/extension-session";
import { verifyExtensionAccessPreAuth } from "./extension-auth";

function makeRequest(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

describe("verifyExtensionAccessPreAuth", () => {
  it("returns session trust for Bearer-authenticated requests", async () => {
    const result = await verifyExtensionAccessPreAuth(
      makeRequest({ authorization: "Bearer token123" }),
      "ai:extract",
    );
    expect(result.trust).toBe("session");
    expect(result.response).toBeNull();
    expect(requireExtensionSession).toHaveBeenCalled();
  });

  it("returns low-trust for allowed-origin requests without a Bearer token", async () => {
    const result = await verifyExtensionAccessPreAuth(
      makeRequest({
        origin: "chrome-extension://ialnajflhafkmfnglapjaegjpbdifcmc",
      }),
      "ai:extract",
    );
    expect(result.trust).toBe("low-trust");
    expect(result.response).toBeNull();
  });

  it("rejects requests with neither Bearer nor allowed origin", async () => {
    const result = await verifyExtensionAccessPreAuth(
      makeRequest({}),
      "ai:extract",
    );
    expect(result.response?.status).toBe(403);
  });
});
```

(vitest runs with `NODE_ENV=test`, so the `development` bypass inside the function does not trigger. Same jsdom note as Task 3 if `next/server` import fails.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/extension-auth.test.ts`
Expected: FAIL — current `verifyExtensionAccessPreAuth` returns `NextResponse | null`, so `result.trust` is undefined (TypeScript error at typecheck too).

- [ ] **Step 3: Make `verifyExtensionAccessPreAuth` trust-aware and fix the dev-ID comment**

In `apps/web/src/lib/extension-auth.ts`:

(a) Change line 10's comment (the ID stays — it's the dev-environment build):

```ts
  "chrome-extension://cefhmagobkjigobnmhnhldofoangmhei", // dev-environment build of the extension — keep
```

(b) Replace the existing `verifyExtensionAccessPreAuth` (lines 118-132) with:

```ts
/** How a pre-auth extension request was authenticated. */
export type ExtensionTrust = "session" | "low-trust";

export interface ExtensionPreAuthResult {
  /** Non-null means the request must be rejected with this response. */
  response: NextResponse | null;
  /**
   * "session"   — Bearer token verified against a signed extension session.
   * "low-trust" — only the spoofable Origin/Referer gate passed. Callers
   *               invoking paid work (LLM routes) must apply stricter rate
   *               limits to this tier (see checkAiRateLimit).
   */
  trust: ExtensionTrust;
}

/**
 * Verify extension access for pre-auth endpoints (AI discovery).
 *
 * These endpoints are called during the post-scanning phase before
 * the user has connected a wallet, so a session token may not exist.
 * Falls back to origin-based verification when no Bearer token is present,
 * and reports which trust tier passed so callers can rate-limit accordingly.
 */
export async function verifyExtensionAccessPreAuth(
  request: NextRequest,
  requiredScope: ExtensionScope,
): Promise<ExtensionPreAuthResult> {
  if (process.env.NODE_ENV === "development") {
    return { response: null, trust: "session" };
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const { response } = await requireExtensionSession(request, requiredScope);
    return { response, trust: "session" };
  }

  return {
    response: await verifyExtensionRequest(request),
    trust: "low-trust",
  };
}
```

(`verifyExtensionAccess` itself is unchanged — other routes keep using it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/extension-auth.test.ts`
Expected: PASS (3 tests). (`pnpm typecheck` will fail until Step 7 updates the three call sites — that's expected mid-task.)

- [ ] **Step 5: Write the failing test for the AI rate-limit helper**

Create `apps/web/src/lib/ai-rate-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { checkAiRateLimit, LOW_TRUST_DAILY_LIMIT } from "./ai-rate-limit";
import { _resetRateLimitStore } from "./rate-limit";

function makeRequest(ip: string): NextRequest {
  return {
    headers: new Headers({ "cf-connecting-ip": ip }),
    nextUrl: new URL("http://localhost/api/ai/extract-topics"),
  } as unknown as NextRequest;
}

describe("checkAiRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitStore();
  });

  it("enforces the per-minute limit for both tiers", () => {
    const req = makeRequest("3.3.3.3");
    expect(checkAiRateLimit(req, "session", 1)).toBeNull();
    expect(checkAiRateLimit(req, "session", 1)?.status).toBe(429);
  });

  it("caps low-trust callers at the daily limit even under the minute limit", () => {
    const req = makeRequest("4.4.4.4");
    // Minute limit high enough to never trip in this loop:
    for (let i = 0; i < LOW_TRUST_DAILY_LIMIT; i++) {
      expect(checkAiRateLimit(req, "low-trust", 100_000)).toBeNull();
    }
    expect(checkAiRateLimit(req, "low-trust", 100_000)?.status).toBe(429);
  });

  it("does not apply the daily cap to session-trust callers", () => {
    const req = makeRequest("5.5.5.5");
    for (let i = 0; i < LOW_TRUST_DAILY_LIMIT + 5; i++) {
      expect(checkAiRateLimit(req, "session", 100_000)).toBeNull();
    }
  });
});
```

- [ ] **Step 6: Run, then implement the helper**

Run: `pnpm vitest run src/lib/ai-rate-limit.test.ts`
Expected: FAIL — module does not exist.

Create `apps/web/src/lib/ai-rate-limit.ts`:

```ts
import type { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import type { ExtensionTrust } from "@/lib/extension-auth";

/**
 * Rate limits for the LLM-invoking AI routes (paid OpenRouter calls).
 *
 * Bearer-authenticated ("session") callers get the route's standard
 * per-minute limit. Low-trust callers — authenticated only by spoofable
 * Origin/Referer headers (the pre-auth extension flow) — additionally
 * consume from a per-day bucket, so a header-forging client cannot farm
 * paid LLM calls continuously. 300/day ≈ one post every 3 minutes for
 * 15 hours, comfortably above organic pre-auth usage.
 *
 * NOTE: buckets are per-isolate (see rate-limit.ts); this raises abuse
 * cost rather than enforcing a strict global ceiling. A shared store
 * (WAF rules / KV / Durable Objects) is the deferred follow-up.
 */
export const LOW_TRUST_DAILY_LIMIT = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

export function checkAiRateLimit(
  request: NextRequest,
  trust: ExtensionTrust,
  perMinuteLimit: number,
): NextResponse | null {
  const minuteLimited = checkRateLimit(request, {
    uniqueTokenPerInterval: perMinuteLimit,
  });
  if (minuteLimited) return minuteLimited;

  if (trust === "low-trust") {
    return checkRateLimit(request, {
      interval: DAY_MS,
      uniqueTokenPerInterval: LOW_TRUST_DAILY_LIMIT,
      keySuffix: "low-trust-day",
    });
  }

  return null;
}
```

Run: `pnpm vitest run src/lib/ai-rate-limit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Update the three AI route call sites**

In `apps/web/src/app/api/ai/extract-topics/route.ts`, add the import:

```ts
import { checkAiRateLimit } from "@/lib/ai-rate-limit";
```

In `POST` (lines 461-476), replace:

```ts
const authResponse = await verifyExtensionAccessPreAuth(request, "ai:extract");
if (authResponse) {
  for (const [k, v] of Object.entries(cors)) authResponse.headers.set(k, v);
  return authResponse;
}

const rateLimitResponse = checkRateLimit(request, {
  uniqueTokenPerInterval: 20,
});
```

with:

```ts
const { response: authResponse, trust } = await verifyExtensionAccessPreAuth(
  request,
  "ai:extract",
);
if (authResponse) {
  for (const [k, v] of Object.entries(cors)) authResponse.headers.set(k, v);
  return authResponse;
}

const rateLimitResponse = checkAiRateLimit(request, trust, 20);
```

Apply the identical transformation in `GET` (lines 518-533, same scope `"ai:extract"`, same per-minute limit 20).

In `apps/web/src/app/api/ai/validate-relevance/route.ts` (lines 231-246), apply the same transformation with scope `"ai:validate"` and per-minute limit 30:

```ts
const { response: authResponse, trust } = await verifyExtensionAccessPreAuth(
  request,
  "ai:validate",
);
if (authResponse) {
  for (const [k, v] of Object.entries(cors)) authResponse.headers.set(k, v);
  return authResponse;
}

const rateLimitResponse = checkAiRateLimit(request, trust, 30);
```

If `checkRateLimit` is now unused in either route file, remove its import (biome will flag it).

- [ ] **Step 8: Verify**

Run: `pnpm typecheck`
Expected: clean (the destructuring change is the only signature break, and all three call sites are updated).

Run: `pnpm vitest run src/lib/extension-auth.test.ts src/lib/ai-rate-limit.test.ts src/app/api/ai/extract-topics/route.test.ts`
Expected: PASS — including the pre-existing `model-config` tests.

---

### Task 5: Edge caching for the whales routes

**Files:**

- Modify: `apps/web/src/lib/cache-headers.ts:15-22,43-87`
- Modify: `apps/web/src/app/api/whales/activity/route.ts:375`
- Modify: `apps/web/src/app/api/whales/suspicious/route.ts:674`

Background: both routes run expensive multi-upstream pipelines per request and return no `Cache-Control`, while clients poll every 60s/2min. A 60-second shared cache makes the pipeline run ~once per minute globally instead of once per viewer. The responses are non-personalized public data keyed only by query params (Cloudflare caches per full URL), so shared caching is safe.

- [ ] **Step 1: Add a `whales` cache profile**

In `apps/web/src/lib/cache-headers.ts`, extend the union (line 15-22):

```ts
export type CacheProfile =
  | "static" // Long-lived data (tags, categories)
  | "events" // Event data (1 minute)
  | "realtime" // Price data, order books (10 seconds)
  | "user" // User-specific data (no cache)
  | "leaderboard" // Leaderboard data (1 minute)
  | "priceHistory" // Historical price data (5 minutes)
  | "search" // Search results (30 seconds, aligns with upstream fetch revalidate)
  | "whales"; // Whale feeds (1 minute — expensive multi-upstream pipelines)
```

and add to `CACHE_PROFILES` (after `search`):

```ts
  whales: {
    ...MINUTE_CACHE,
    isPrivate: false,
  },
```

- [ ] **Step 2: Apply headers in `/api/whales/activity`**

In `apps/web/src/app/api/whales/activity/route.ts`, add the import:

```ts
import { getCacheHeaders } from "@/lib/cache-headers";
```

and change the success return at line 375 to pass headers:

```ts
return NextResponse.json(
  {
    success: true,
    activities: limitedActivities,
    whaleCount: topTraders.length,
    totalTrades: limitedActivities.length,
    lastUpdated: new Date().toISOString(),
    dataAge,
  } satisfies WhaleActivityResponse,
  { headers: getCacheHeaders("whales") },
);
```

(Leave the catch-block error response uncached, as it is today.)

- [ ] **Step 3: Apply headers in `/api/whales/suspicious`**

In `apps/web/src/app/api/whales/suspicious/route.ts`, add the same `getCacheHeaders` import, and change the success return at line 674:

```ts
return NextResponse.json(
  {
    success: true,
    activities: limitedActivities,
    stats: {
      totalTradesScanned: recentTrades.length,
      uniqueTradersFound: uniqueTraders.length,
      newAccountsFound: [...traderHistories.values()].filter(
        (h) => h.accountAgeHours <= maxAccountAgeHours,
      ).length,
      suspiciousActivities: suspiciousActivities.length,
      criticalCount,
      highCount,
      mediumCount,
      repeatOffenders,
    },
    lastUpdated: new Date().toISOString(),
  } satisfies SuspiciousActivityResponse,
  { headers: getCacheHeaders("whales") },
);
```

Note: there is an early-return `NextResponse.json` around line 239 (the empty/degenerate path) — read it when editing; if it returns a successful empty payload, add the same headers there too so empty results don't bypass the cache.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. (Live header verification happens in Task 9 with chrome-devtools.)

---

### Task 6: Register the insider KB build with `waitUntil`

**Files:**

- Modify: `apps/web/src/lib/insider/market-resolutions.ts:180-197`

Background: `triggerBackgroundBuild` starts a 30-60s Gamma crawl as a detached promise. On Workers, async work not registered with `ctx.waitUntil` is not guaranteed to survive the response being sent — the crawl gets killed mid-flight and re-triggered on the next request, forever. `@opennextjs/cloudflare` exposes the execution context via `getCloudflareContext()` (already used in `src/lib/auth/extension-session.ts:88`).

- [ ] **Step 1: Implement**

In `apps/web/src/lib/insider/market-resolutions.ts`, add the import at the top of the file:

```ts
import { getCloudflareContext } from "@opennextjs/cloudflare";
```

Add this helper just above `triggerBackgroundBuild`:

```ts
/**
 * Keep a background promise alive past the response on Cloudflare Workers.
 * Without waitUntil, detached work is killed when the response is sent —
 * the KB build would be cancelled mid-crawl and re-triggered on every
 * request without ever completing.
 */
function registerBackgroundWork(promise: Promise<unknown>): void {
  try {
    const { ctx } = getCloudflareContext();
    ctx.waitUntil(promise);
  } catch {
    // Outside a Cloudflare request context (vitest, plain node): the
    // promise still runs, it just isn't protected from teardown.
  }
}
```

Then in `triggerBackgroundBuild` (lines 183-197), register the build right after assigning it:

```ts
function triggerBackgroundBuild(opts: {
  minVolumeUsd?: number;
  maxPages?: number;
}): void {
  if (kbBuildPromise) return;
  kbBuildPromise = buildResolutionKnowledgeBase(opts)
    .then((kb) => {
      kbCache = { kb, fetchedAt: Date.now() };
      return kb;
    })
    .catch((err) => {
      log.error("kb.build_failed", { error: err });
      throw err;
    })
    .finally(() => {
      kbBuildPromise = null;
    });
  // Swallow the rejection on the waitUntil copy — kb.build_failed is
  // already logged above; waitUntil must not surface a second error.
  registerBackgroundWork(kbBuildPromise.catch(() => undefined));
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

Run the existing insider tests if present: `pnpm vitest run src/lib/insider`
Expected: PASS (or "no test files found", which is fine).

---

### Task 7: Parallelize `/api/events/[id]` upstream fetches + cache headers

**Files:**

- Modify: `apps/web/src/app/api/events/[id]/route.ts:106-213`

Background: the markets fetch (depends on `event.slug`) and the negRisk-children fetch (depends on `event.id`) are independent of each other but currently awaited sequentially. Run them in `Promise.all`. Also the success response has no `Cache-Control` despite being the most-hit public detail endpoint — add the existing `events` profile, except when the caller explicitly requested `?fresh=1`.

- [ ] **Step 1: Implement**

In `apps/web/src/app/api/events/[id]/route.ts`, add the import:

```ts
import { getCacheHeaders } from "@/lib/cache-headers";
```

Replace everything from the `let markets: Record<string, unknown>[] = [];` line (line 108) through the success `return NextResponse.json({...})` (line 213) with:

```ts
// The markets fetch (keyed by event.slug) and the negRisk child-event
// fetch (keyed by event.id) are independent of each other — run them
// concurrently instead of back-to-back.
const fetchMarkets = async (): Promise<Record<string, unknown>[]> => {
  // If the event already embeds its markets, use them directly.
  if (event.markets && Array.isArray(event.markets)) {
    return event.markets as Record<string, unknown>[];
  }
  // Otherwise, fetch markets by event slug or ID (always filter closed=false)
  const marketsUrl = `${POLYMARKET_API.GAMMA.MARKETS}?events_slug=${
    event.slug || id
  }&closed=false`;
  try {
    const marketsResponse = await fetch(marketsUrl, {
      headers: {
        "Content-Type": "application/json",
      },
      ...(fresh
        ? { cache: "no-store" as const }
        : { next: { revalidate: CACHE_DURATION.MARKETS } }),
    });
    if (marketsResponse.ok) {
      return (await marketsResponse.json()) as Record<string, unknown>[];
    }
  } catch (error) {
    logger.warn("events.detail.markets_fetch_failed", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Continue with empty markets array
  }
  return [];
};

// Polymarket nests "Most Sixes" / "Top Batter" / "Toss Match Double" etc.
// as separate negRisk child events linked back via `parentEventId`. The
// standard `/events/slug/{slug}` payload does NOT include them, so the
// detail page would silently drop those rows. Fan out to fetch the
// children and append their markets to the response so the outcomes
// table renders the full set.
const eventId = typeof event.id === "string" ? event.id : null;
const fetchChildEvents = async (): Promise<Record<string, unknown>[]> => {
  if (!eventId) return [];
  try {
    const childrenUrl = `${POLYMARKET_API.GAMMA.EVENTS}?parent_event_id=${eventId}&limit=50&closed=false`;
    const childrenResponse = await fetch(childrenUrl, {
      headers: { "Content-Type": "application/json" },
      ...(fresh
        ? { cache: "no-store" as const }
        : { next: { revalidate: CACHE_DURATION.EVENTS } }),
    });
    if (childrenResponse.ok) {
      const childEvents = (await childrenResponse.json()) as Array<
        Record<string, unknown>
      >;
      if (Array.isArray(childEvents)) return childEvents;
    }
  } catch (error) {
    logger.warn("events.detail.children_fetch_failed", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Children fan-out is best-effort; missing children should not fail
    // the parent event response.
  }
  return [];
};

const [markets, childEvents] = await Promise.all([
  fetchMarkets(),
  fetchChildEvents(),
]);

const seenMarketIds = new Set(
  markets
    .map((m) => (typeof m.id === "string" ? m.id : null))
    .filter((v): v is string => v !== null),
);
for (const child of childEvents) {
  const childMarkets = Array.isArray(child.markets)
    ? (child.markets as Record<string, unknown>[])
    : [];
  const childEventId =
    typeof child.id === "string"
      ? child.id
      : typeof child.id === "number"
        ? String(child.id)
        : null;
  for (const market of childMarkets) {
    const mid = typeof market.id === "string" ? market.id : null;
    if (mid && seenMarketIds.has(mid)) continue;
    if (mid) seenMarketIds.add(mid);
    markets.push({
      ...market,
      // Tag with the IMMEDIATE child event id (Most Sixes, Top
      // Batter, …), not the grandparent event id. The UI groups
      // negRisk siblings by this so each section maps to one
      // child event — using the grandparent collapsed every
      // negRisk market into a single nine-button row.
      parentEventId: childEventId,
      parentEventTitle: child.title,
    });
  }
}

return NextResponse.json(
  {
    success: true,
    event: {
      ...event,
      markets,
      marketCount: markets.length,
    },
  },
  {
    headers: fresh
      ? { "Cache-Control": "no-store" }
      : getCacheHeaders("events"),
  },
);
```

(The surrounding `try`/`catch` and everything above line 106 stay exactly as they are.)

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. Behavior check happens in Task 9 (event detail page must still render its full outcomes table, including negRisk child sections).

---

### Task 8: Exclude static assets from the middleware matcher

**Files:**

- Modify: `apps/web/src/middleware.ts:138-146`

Background: `matcher: ["/:path*"]` runs CSP string assembly + ~8 header writes on every request including `/_next/static` chunks and images. Those assets are immutable and don't need per-request security headers or www-canonicalization. `robots.txt` and `sitemap.xml` are NOT under `_next/`, so they remain covered.

- [ ] **Step 1: Implement**

Replace lines 138-146 of `apps/web/src/middleware.ts`:

```ts
/**
 * Matcher configuration.
 *
 * Covers all routes EXCEPT Next.js build assets (`/_next/static`,
 * `/_next/image`) and the favicon — those are immutable static files that
 * don't need per-request security headers or host canonicalization, and
 * skipping them avoids running the middleware on every chunk request.
 * robots.txt and sitemap.xml are still matched for host canonicalization.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Run the existing middleware tests**

Run: `pnpm vitest run src/middleware.test.ts`
Expected: PASS. If any test asserts the old matcher value, update that assertion to the new pattern — the test is describing config, not behavior.

---

### Task 9: Full verification (tests, typecheck, then live chrome-devtools checks)

**Files:** none modified.

- [ ] **Step 1: Static verification**

Run from `apps/web/`:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: typecheck clean, biome clean, full vitest + node test suite green (including the 5 new test files).

- [ ] **Step 2: Start the dev server**

Run from `apps/web/` (background): `pnpm dev`
Expected: Next.js dev server on `http://localhost:8000`.

- [ ] **Step 3: chrome-devtools verification checklist**

Using the chrome-devtools MCP tools (`new_page`, `list_network_requests`, `get_network_request`, `evaluate_script`):

1. **Middleware headers on pages:** Navigate to `http://localhost:8000/`. The document response must include `Content-Security-Policy` and `X-Request-Id`. (Dev CSP includes `'unsafe-eval'` — expected, dev-only.)
2. **Middleware skipped for static assets:** Find any `/_next/static/...` request — it must NOT carry `X-Request-Id`. (In dev, Next may still add its own headers; the `X-Request-Id` absence is the signal that our middleware no longer runs there.)
3. **JSON-LD escaping:** Navigate to any event detail page (click an event card from the homepage). Run `JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)` via `evaluate_script` — it must parse and contain the event title. Confirm the raw `textContent` contains no `<` character.
4. **events/[id] caching + correctness:** In the network list, find `/api/events/<slug-or-id>` — response headers must include `Cache-Control: public, max-age=30, s-maxage=60, ...`. The event page must render its full outcomes table (for a cricket/sports event with child markets, the child sections must still appear — this validates the Promise.all refactor).
5. **Whales caching:** Navigate to `http://localhost:8000/whales`. Find `/api/whales/activity` (and `/api/whales/suspicious` if the insider tab is opened) — both must return `Cache-Control: public, max-age=30, s-maxage=60, ...`.
6. **AI route smoke test (dev bypasses auth, so this only checks the route still works):**
   ```bash
   curl -s -X POST http://localhost:8000/api/ai/extract-topics \
     -H "Content-Type: application/json" \
     -d '{"text":"Will the Lakers win the NBA championship this year?"}'
   ```
   Expected: HTTP 200 JSON (or a structured fallback response if `OPENROUTER_API_KEY` is unset in `.dev.vars` — either proves the handler wiring survived the refactor; a 500 does not).
7. **Whales pages still render:** `http://localhost:8000/whales` shows the activity ledger without console errors (`list_console_messages`).

- [ ] **Step 4: Report**

Summarize: tests green, headers observed, JSON-LD parses, event detail renders children, whales pages work. Leave all changes uncommitted for manual review (NO git add/commit).

---

## Self-review notes

- **Spec coverage:** review findings mapped → Task 1 (JSON-LD XSS #5), Task 2 (rate-limiter timer, part of #7), Tasks 3+4 (LLM cost abuse #6, with user-chosen "harden fallback" approach + dev-ID comment fix), Task 5 (whales caching #9a), Task 6 (KB waitUntil #9b), Task 7 (events/[id] sequential awaits + missing cache headers), Task 8 (middleware matcher). Deferred items listed in the header.
- **Type consistency:** `ExtensionTrust` defined in Task 4 Step 3, consumed by `ai-rate-limit.ts` (Task 4 Step 6) and route call sites (Step 7). `_resetRateLimitStore`/`_rateLimitStoreSize` defined in Task 2, used by tests in Tasks 2-4. `keySuffix` defined in Task 3, used in Task 4. `getCacheHeaders("whales")` requires Task 5 Step 1 before Steps 2-3.
- **Known risk:** if `next/server` (NextResponse) fails under jsdom in the new tests, add `// @vitest-environment node` at the top of the affected test file — noted inline in Tasks 3 and 4.
