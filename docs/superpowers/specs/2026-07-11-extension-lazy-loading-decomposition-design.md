# Extension Content-Script Lazy Loading + Large-Module Decomposition — Design

**Date:** 2026-07-11
**Status:** Proposed (pending user spec review)
**Scope decision:** This is sub-project 2 of the structural-debt work. Sub-project 1
(canonical funding state machine, 2026-07-10) is complete. This spec covers all three
remaining pieces: (1) lazy-load the trading stack in the content script, (2) lazy-load
platform adapters per host, (3) decompose `sidepanel.ts`, `trading-panel.ts`, and
`ui.ts` into focused modules.

## Problem

`content.js` ships **1.44 MB (minified)** into every supported page — Twitter, BBC,
ESPN, all ~45 hosts — via `chrome.scripting.executeScript`. Measured composition:

- **~45 platform adapters** (10,634 lines / 484 KB source in `src/content/platforms/`)
  are all imported eagerly by `src/content/index.ts`, though exactly one matches the
  current host on any given page.
- **The full trading stack** loads on every page even though most page visits never
  open a trading panel: `trading-panel.ts` (5,569 lines), `trading-service.ts`,
  the wallet bridge, the funding machine/gateways, plus their heavy dependencies —
  React, react-dom, react-qr-code, viem. React and viem enter the content bundle
  solely through `trading-panel.ts` and `walletconnect-qr.ts`, so the seam is clean.
- There are **no dynamic dispatchers** anywhere in the content path; `ui.ts` statically
  imports `TradingPanel`, `TradingService`, `WalletBridge`, stream-bet logic, and the
  WalletConnect QR renderer.

Independently of bundle size, three modules have grown past the point where they can
be held in context or reviewed reliably:

| File | Lines |
|---|---|
| `apps/extension/src/sidepanel.ts` | 6,538 |
| `apps/extension/src/content/trading/trading-panel.ts` | 5,569 |
| `apps/extension/src/content/ui.ts` | 5,544 |

## Goals

1. Pages that never trade stop paying for React, viem, and the trading panel:
   the trading stack loads on demand behind an explicit dispatcher.
2. Only the platform adapter matching the current host loads, instead of all ~45.
3. The three giant files are decomposed into focused modules, each with one clear
   responsibility.
4. A production-build assertion locks in the bundle win so it cannot silently regress.

**Non-goals:** lazy-loading inside `sidepanel.ts` (it is an extension page that only
loads when the user opens it — decomposition only); changing any user-visible
behavior; touching the background/offscreen bundles; moving off webpack.

**Cleanup policy (user decision):** behavior-preserving baseline — code moves verbatim
and the existing test suite plus typecheck is the gate — but opportunistic,
clearly-safe improvements are allowed along the way: deleting provably-dead code,
deduplicating near-identical helpers, tightening types, renaming confusing locals.
Anything that could change observable behavior needs its own test first.

## Architecture — chosen approach

**Separate entry bundles + explicit dispatchers using native
`import(chrome.runtime.getURL(...))`.**

Rejected alternatives:

- *In-place webpack code-splitting* (`import()` boundaries inside the single `content`
  entry): webpack's chunk-loading runtime is the classic MV3 failure mode inside
  `executeScript`-injected isolated worlds — `publicPath: "auto"` cannot resolve
  (no `document.currentScript`), and script-tag chunk loading executes in the page
  world, not the isolated world. Tunable, but fragile across webpack upgrades.
- *Background-mediated injection* (content messages background, background
  `executeScript`s the trading bundle): rock-solid loading, but the inter-bundle
  interface degrades to window globals/custom events instead of typed module imports.

Native `import()` of an extension URL is deterministic in the isolated world on
MV3-era Chrome, requires no webpack runtime cooperation, and returns a typed module
namespace. The codebase already uses dynamic `import()` successfully (offscreen
scoring runtime, unified CLOB SDK), so the pattern has precedent.

Cost accepted: shared helpers (decimal.js, `@knoww/shared-types`) duplicate across
`content.js` and the trading bundle. The trading bundle loads rarely and is cached by
the browser; duplication is cheaper than webpack-runtime fragility.

### New webpack entries

```js
entry: {
  // existing: background, offscreen, content, options, sidepanel, page-bridge
  "content-trading": "./src/content/trading/trading-entry.ts",
  // one small entry per platform adapter, emitted as platforms/<name>.js
  "platforms/twitter": "./src/content/platforms/twitter.ts",
  "platforms/linkedin": "./src/content/platforms/linkedin.ts",
  // ... generated from the canonical manifest artifact
  //     (src/content/platforms/manifest.json — see Platform adapter lazy
  //     loading), never from globbing the platforms directory
}
```

`web_accessible_resources` gains `"content-trading.js"` and `"platforms/*.js"`
(same generated `matches` as today). The existing `chunks/[name].js` output config
stays for the extension-page bundles that already use it.

**ESM output contract.** The current config emits classic self-executing bundles;
native `import()` of such a file executes it but yields an *empty module namespace* —
`TradingPanel` etc. would be undefined. The lazy entries therefore build from a
second webpack config in the exported config array (`module.exports = [classic,
esm]`), with `experiments.outputModule: true` and `output.library.type: "module"`,
so `content-trading.js` is a real ES module whose exports survive native import.
Platform adapter bundles need the same ESM treatment: they export their `adapter`
for core-side registration (they must not self-register — see Platform adapter
lazy loading), so their exports must survive native import too. Both dispatchers must write the
import as `import(/* webpackIgnore: true */ chrome.runtime.getURL(...))` so webpack
leaves the native boundary alone instead of rewriting it into its own chunk runtime.
Note the existing dynamic-import precedents in this codebase (offscreen scoring
runtime, unified CLOB SDK) go through webpack's internal chunk loading and prove
nothing about this native-URL path — the build assertion below is the proof.

**Build pipeline ownership.** The two compilers share `dist/`, and the current
config uses `output.clean: true` plus `CopyPlugin` — cloned naively, each compiler
would delete the other's output and race on static assets. One owner: the classic
compiler keeps `clean: true` and `CopyPlugin`; the ESM config sets `clean: false`,
has no `CopyPlugin`, and is ordered after the classic build (webpack MultiCompiler
`name` + `dependencies`). Both compilations write named stats artifacts (e.g.
`dist/.stats/{classic,esm}.json`, excluded from the release zip) because
`assert-production-bundle.mjs` runs as a separate process and cannot otherwise see
the module graph. A clean-build assertion verifies all classic and lazy assets
coexist after a from-scratch `build:prod`.

**Lazy-chunk policy: exactly one JS asset per lazy entry.** `splitChunks: false`
does not prevent a transitive dependency's own `import()` from emitting an extra
async chunk (the offscreen runtime chunk in `dist/` today is proof), and such a
chunk would be missing from `web_accessible_resources` or resolve an invalid
public path. The build assertion fails on any JS asset in the ESM compilation
beyond the declared entries; if a dependency legitimately needs an async chunk,
that is resolved explicitly (inline it or WAR-list it with an extension-safe URL),
never silently.

### Platform adapter lazy loading

Adapters currently self-register with `platform-registry.ts` as an import
side-effect; the registry needs the host-match rules *before* any adapter loads.
So the match metadata moves out of the adapters into a static manifest:

```
src/content/platforms/manifest.json — NEW, the canonical, build-readable artifact
  [{ "file": "twitter",
     "name": "twitter",
     "hostPatterns": [
       { "source": "^(www\\.)?twitter\\.com$", "flags": "" },
       { "source": "^(www\\.)?x\\.com$",       "flags": "" }
     ] }, ...]
  // LOSSLESS matcher data: adapters declare hostPatterns as RegExp[] today
  // (anchors, optional-www groups, flags — platform-registry.ts:50 runs
  // pattern.test(hostname)); the manifest stores each regex VERBATIM as
  // source + flags, so manifest matching is bit-identical to adapter matching.
  // `file` is the source-module basename while `name` is adapter.name and the
  // emitted asset basename. They differ for the established Kalshi mapping:
  // file `kalshi-website`, adapter/output name `kalshi-platform`.

src/content/platform-manifest.ts    — NEW, stays in content.js core
  // typed runtime wrapper: imports manifest.json (resolveJsonModule) and
  // rebuilds each entry's matchers with new RegExp(source, flags)
  export const PLATFORM_MANIFEST: PlatformManifestEntry[]
```

The manifest is a **data file** because the CommonJS `webpack.config.cjs` cannot
import a TypeScript module with matcher functions — the config `require()`s
`manifest.json` to generate the entry map, and `platform-manifest.ts` derives the
runtime matchers from the same data (precedent: the config already extracts
`SUPPORTED_MATCH_PATTERNS` from TS source; JSON is the cleaner version of that).

**Matching semantics and precedence.** Today `detectPlatform()`
(`platform-registry.ts:39`) returns the *first registered adapter* whose any
pattern matches the hostname, and registration order is `index.ts` import order.
To preserve selection exactly: manifest order replicates today's import order,
patterns are verbatim copies of each adapter's `hostPatterns`, and a build
assertion verifies both (manifest regex source/flags strictly equal the
adapter's exported `hostPatterns`, order matches the recorded baseline). Because
manifest and adapter matchers are the same regexes, "manifest first-match" and
"registry first-match" cannot disagree; as a defensive backstop against drift,
the loader still iterates matching candidates in manifest order and, after
importing and registering one, confirms `detectPlatform()` returned an adapter —
continuing to the next candidate if not. Fixtures cover positive, negative,
multi-pattern, overlap, and precedence cases.

**Routing-source cross-check (fixture contract, not containment).** The manifest
and `SUPPORTED_MATCH_PATTERNS` (`supported-hosts.ts` — which generates
content-script injection and WAR `matches`) are independent routing sources, and
they cannot be compared by universal containment: adapter matchers are arbitrary
regexes while injection routes are Chrome wildcard match patterns, and the two
*already* partially overlap by design — `https://*.stackoverflow.com/*` is
injectable while the adapter accepts only `/^(?:meta\.)?stackoverflow\.com$/`,
`https://*.slashdot.org/*` while the adapter accepts only bare/`www`. Subdomain
pages getting injection but no adapter is today's intended behavior and must be
preserved, not "fixed". The consistency gate is therefore a **checked-in
coverage-fixture contract**: a fixture file maps representative hostnames to an
expected outcome (`adapter: <name>` or `none`), with at least one fixture per
supported-host pattern (including a subdomain fixture wherever the pattern is
wildcarded) and one per manifest entry. The build assertion evaluates the
manifest regexes against every fixture and fails on any mismatch — so a routing
change is always a reviewed fixture edit, never an accident — and additionally
checks the decidable direction: every manifest entry must have at least one
fixture host that is injectable (covered by supported-host and WAR patterns),
otherwise that adapter bundle is unreachable at runtime.

```
src/content/platform-loader.ts     — NEW, the dispatcher
  export async function loadPlatformAdapter(url: URL): Promise<boolean>
  // finds the first manifest entry matching location, then
  // const mod = await import(chrome.runtime.getURL(`platforms/${entry.name}.js`))
  // and registers mod.adapter with the CORE registry instance;
  // returns false if no entry matches (unsupported host — no adapter loads)
```

Adapter bundles **export** their adapter; the loader registers it with the core
registry. Adapters must not self-register on import: a separately-compiled bundle
gets its own copy of any module it imports, so importing `platform-registry` from a
lazy bundle would register into a second registry instance (or lean on the
`window.KNOWW_PLATFORM` global as an untyped cross-bundle singleton). Export +
core-side registration keeps one registry, typed, and makes
`registerAdapterWithRetry`'s load-order retry dance unnecessary for lazy adapters.

`main.ts` awaits `loadPlatformAdapter(...)` before starting feed scanning, replacing
the 45 eager imports in `index.ts`. Each adapter's own match logic (today embedded in
its registration call) is the source of truth for its manifest entry; moving it must
not change which pages activate which adapter. `kalshi-adapter.ts` (a market source,
not a platform adapter) stays in the core bundle.

**`manifest.json` is the canonical adapter list** — webpack entries are generated
from it, *not* from globbing `src/content/platforms/*.ts`: the directory also
contains shared helper modules (`basic-adapter.ts`, `editorial-adapter.ts`,
`helpers.ts`, `story-adapter-helpers.ts`) that must never become entries, manifest
records, or web-accessible resources. Adapters are distinguished from helpers by a
detectable convention: **every adapter module has a top-level
`export const adapter: PlatformAdapter`; helper modules never export `adapter`**
(this replaces registration-call detection, which stops existing once
self-registration is removed). A build-time assertion checks both directions:
every manifest entry's `file` has a source file exporting `adapter` whose name
equals the entry's `name`, and exactly one emitted
bundle, and every `platforms/*.ts` file exporting `adapter` appears in the
manifest; any emitted platform output not in the manifest fails the build.

The convention represents **enabled, reachable adapters**, not every dormant
source file. `stackexchange.ts` remains as a legacy named adapter implementation,
but its supported-host routes are deliberately disabled; it therefore has no
canonical `adapter` export or manifest record and emits no lazy asset. Re-enabling
those routes requires adding it back to the manifest and routing fixtures in the
same reviewed change. The standalone, enabled `stackoverflow` adapter is separate
and remains in the manifest.

### Trading stack lazy loading

```
src/content/trading/trading-entry.ts   — NEW, webpack entry for content-trading.js
  // Exposes a NARROW facade, not the raw module surface. The facade contains
  // exactly the operations core UI invokes (panel open/mount, stream-bet
  // hydration, the runtime-message handler, wallet connect/switch), so the
  // lazy boundary stays reviewable and no `export * as` leaks the whole stack:
  export function createTradingRuntime(): TradingRuntime
  export type { TradingRuntime }   // interface defined in a core-safe types file

src/content/trading-loader.ts          — NEW, the dispatcher (lives in content.js,
                                          deliberately OUTSIDE src/content/trading/
                                          so the boundary rules below need no
                                          exceptions)
  export function loadTradingRuntime(): Promise<TradingRuntime>
  //   single in-flight promise shared by ALL callers (UI clicks and runtime
  //   messages alike); cached forever after first success; failure clears the
  //   cache so the next intent retries
  export function getLoadedRuntime(): TradingRuntime | null
  //   synchronous access for warm-tab sync-response messages; null until loaded
  export function prefetchTradingRuntime(): void
  //   fire-and-forget wrapper, called via requestIdleCallback — GATED (below)
```

**Side-effect-free import invariant.** Importing `content-trading.js` defines
`createTradingRuntime` and nothing else — no listener registration, no DOM,
storage, or `chrome.*` calls at module scope in the entry or any dependency it
initializes. This boundary must be *created*, not assumed: today
`trading-service.ts:1291-1308` registers a `chrome.runtime.onMessage` listener
and a `WalletBridge.onAccountsChanged` subscription at module scope, and
`WalletBridge.init()` self-registers the signing listener. Phase 2 moves every
such registration into `createTradingRuntime()`, which returns a runtime with an
explicit `dispose()` that removes them.

React-backed QR rendering is the one synchronous legacy dependency that needs
special care: `react-dom/client` and `react-dom/server` perform browser feature
probes when their module factories are evaluated. They remain bundled in the
single trading asset, but are reached through literal webpack `require(...)`
calls located inside `mountMobileQrCode()` / `renderWalletConnectQrSvg()` only.
That preserves the synchronous QR and one-asset contracts while deferring those
module factories until an explicit QR render; a top-level value import would
violate this invariant. Type-only React imports remain erased and are allowed.

The invariant is verified automatically, not by convention: a post-build smoke
test (Node + jsdom + instrumented `chrome` stub, run with the production-bundle
assertions) executes two phases — (1) import the built ESM, **drain pending
microtasks**, and assert zero observations across the full instrument set:
`chrome.*` calls (recursively proxied), storage reads *and* writes,
`window`/`document`/EventTarget listener registrations, DOM mutations, timer
scheduling (`setTimeout`/`setInterval`/`requestIdleCallback`/`requestAnimationFrame`),
observer construction (`MutationObserver`/`IntersectionObserver`/`ResizeObserver`),
and custom subscription installs (e.g. wallet-account listeners, exposed as a
countable hook); (2) call `createTradingRuntime()` and assert exactly one
installation of each handler against the same instruments, prove the single
Chrome callback does not handle a signing-shaped request, observe exactly one
bridge-to-service account subscription, then call idempotent `dispose()` and
assert exact callback/subscription removal once. The static export-name parse remains as the cheap
namespace-shape check. There is no legacy-module exception: if a transitive
module performs import-time work, the smoke test fails and that module gets
fixed as part of the phase. The same harness runs against **every emitted
platform ESM**: import it, assert the namespace exposes `adapter`, that
`adapter.name` equals its manifest name, and that import performs no
registration or side effects (source-syntax and output-name checks alone do not
prove the native namespace is usable). Each built-module smoke runs in an
**isolated context** (fresh VM context / child process per module) so module
caches and mutated globals cannot contaminate subsequent adapter tests. Note
the smoke cannot observe a separately bundled *private* registry copy being
mutated — that hole is closed by the platform-entry graph-purity assertion in
the build checks (each platform entry graph excludes `platform-registry.ts` and
registration helpers).

**Dependency direction is one-way.** Core (`content.js`) may import the loader and
`import type` anything; the trading bundle may consume narrow core ports passed to
`createTradingRuntime()` (or imported from leaf modules), but `trading-entry.ts` and
`trading-glue.ts` must not value-import the core `ui/index.ts` barrel — the barrel
imports the loader, and that edge would create a cross-bundle cycle. The
import-boundary check enforces both directions.

**Eager runtime-message dispatcher.** Today `ui.ts` eagerly runs `WalletBridge.init()`
(registering the `trading:signing-request` listener) and a `chrome.runtime.onMessage`
listener handling the portfolio wallet surface — discovery, connect, switch, reauth,
WalletConnect state, enable/approve trading (`ui.ts:5145-5420`). These messages
arrive from the sidepanel *before any panel click*; if their handlers move wholesale
into the lazy bundle, sidepanel funding regresses to "Receiving end does not exist"
on fresh tabs. So `content.js` keeps a small, synchronously-registered dispatcher:
it matches this message set by type, treats each as a trading intent, awaits
`loadTradingRuntime()`, and delegates to the runtime's message handler.
Notification-stack messages (`KNOWW_OPEN_EXTENSION`, snapshot/search/focus) have no
trading dependency and stay fully in core.

**The dispatcher preserves each message's existing semantics — there is no one
generic contract.** The moved messages differ in timing today, some branch on
payload, and the error envelope is `{ success: false, data: { error } }` (callers
consume `data.error`) — never a generic top-level `error` field. The plan MUST
contain an exhaustive table keyed by message type — and payload branch where
behavior branches — specifying for every row: synchronous return value
(`true`/`false`), response envelope, completion channel, and bundle-load failure
behavior, with state ownership noted wherever it deviates from the default (the
trading runtime). **That table is part of this design contract — it appears
below, verified against `ui.ts`/`bridge.ts`, and the plan inherits it verbatim.**
To make sync responses possible on a warm tab, the loader also exposes
`getLoadedRuntime(): TradingRuntime | null` (synchronous; null until the first
load resolves). The observed classes:

- *Respond-on-completion* (return `true`; one `sendResponse` when work finishes;
  errors as `{ success: false, data: { error } }`): `KNOWW_GET_PORTFOLIO_WALLETS`,
  `KNOWW_GET_PORTFOLIO_CONNECTED_WALLET`, `KNOWW_SWITCH_PORTFOLIO_WALLET`,
  `KNOWW_PORTFOLIO_REAUTH`, `KNOWW_APPROVE_PORTFOLIO_TRADING`, and the
  installed-wallet branch of `KNOWW_CONNECT_PORTFOLIO_WALLET`. On bundle-load
  failure: `{ success: false, data: { error } }`.
- *Synchronous started-ack, then fire-and-forget* (ack synchronously with the
  full envelope `{ success: true, data: { status: "started" } }`, return `false`,
  work continues in background): `KNOWW_ENABLE_PORTFOLIO_TRADING` (`ui.ts:5352`)
  and the **WalletConnect branch** of `KNOWW_CONNECT_PORTFOLIO_WALLET`
  (`ui.ts:5253` — payload-dependent: started-ack for the WalletConnect UUID,
  respond-on-completion otherwise). The dispatcher acks *before* the bundle
  loads; awaiting the import first would change observable timing. Load failure
  surfaces through the flow's existing polled/queried state (for WalletConnect,
  via the core transition record below), as pairing errors do today.
- *Synchronous state* (respond synchronously, return `false`):
  `KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE` and
  `KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT`. These never trigger a bundle load; on
  a warm tab `GET_STATE` delegates synchronously via `getLoadedRuntime()` only
  when no core transition record exists. `CANCEL` uses the already-loaded
  runtime's observable asynchronous cancel operation, but still responds
  synchronously and never loads a runtime.
  A bare "cold ⇒ idle" rule is NOT sufficient: the WalletConnect-connect
  started-ack fires *before* the import resolves, so there is a window where a
  flow is pending but `getLoadedRuntime()` is still `null` — and WalletConnect
  session data is persisted in `chrome.storage.local`
  (`ChromeWalletConnectStorage`, `walletconnect-bridge.ts:212`), so "runtime not
  loaded" does not mean "nothing exists". The dispatcher therefore keeps a
  **core-owned WalletConnect transition record**
  (`{ generation, status: "loading" | "error" | "cancelled", error }`), written
  when a WalletConnect-connect intent starts:
  - Cold `GET_STATE` with a pending load reports
    `{ success: true, data: { status: "initializing", error: null, qrSvg: null } }`
    (today's observable state right after connect starts,
    `walletconnect-bridge.ts:203`); after a failed import it reports
    `{ status: "error", error }` so the sidepanel's poller
    (`sidepanel.ts:2094`, 180 s deadline) fails fast instead of timing out;
    with no record it reports the exact idle shape
    `{ status: "idle", error: null, qrSvg: null }`.
  - Cold `CANCEL` acks `{ success: true, data: { status: "cancelled" } }` AND
    bumps/cancels the current generation — a **queued-cancel guard**: when the
    pending import resolves, the connect handler checks its generation before
    starting any runtime work, so a cancelled connect never begins pairing.
    **Cancel never touches established/persisted sessions** — this matches
    today's semantics exactly: `WalletConnectBridge.cancel()`
    (`walletconnect-bridge.ts:418`) only aborts the pending pairing attempt and
    emits idle (QR-dismiss), while disconnecting an established session is the
    separate `disconnect()` operation, which stays a runtime-only concern. Cold
    cancel therefore invalidates only the core queued generation; no cleanup
    runtime is loaded.

  **Transition-record lifecycle (complete):** every cancel — cold or warm —
  invalidates the core generation and writes `cancelled` *first*, before any
  optional runtime cancel, so ownership never shifts at the handoff boundary.
  `cancelled` is not a distinct observable state: `GET_STATE` checks the core
  record before the loaded runtime and reports the exact idle shape while that
  record exists. On a warm tab, the runtime exposes
  `cancelWalletConnect(): Promise<void>` backed by the bridge's actual cancel;
  only successful cleanup clears the record, and only if the same cancelled
  generation is still current **and every earlier outstanding cleanup has
  settled**. Cleanup rejection preserves cancelled-as-idle. Provider
  abort/pairing-cleanup failures are logged structurally and rethrown by the
  runtime. Because pinned UniversalProvider 2.23.10 does not actually abort a
  live approval (`abortPairingAttempt()` is a no-op and pairing cleanup only
  unsubscribes), the bridge treats those calls as best-effort signals, not
  cancellation proof: it captures the old connect promise, bumps generation,
  then waits for that exact attempt and its stale-topic cleanup to settle before
  clearing only the captured promise. Every concurrent cancel/force-new caller
  waits on the same captured attempt. If approval never settles, cancel and
  reconnect remain pending under core cancelled/loading authority—safe
  serialization takes precedence over a concurrent approval that could publish
  stale provider state last.
  A failed stale-topic disconnect persists a retry descriptor containing the
  exact provider, stale session identity, and topic. A later abort retries that
  descriptor before re-awaiting the captured old attempt. The old
  `StaleSessionCleanupError` is ignorable only after this retry successfully
  clears the descriptor; otherwise quarantine/core idle remains. A topicless
  stale session cannot be safely targeted and therefore remains blocked.
  Cold cancel never loads the runtime, never disconnects an established or
  persisted session, and may keep its cancelled record until reconnect.

  The loading record is cleared on successful connect handoff — once the import
  resolves and the runtime accepts the uncancelled intent, runtime state becomes
  authoritative. A reconnect bumps the generation and replaces the old record
  with a fresh `loading` entry. When warm cancellation is still settling, that
  reconnect still acks immediately but waits on a composed barrier covering
  every outstanding cleanup promise (each may succeed or reject), then rechecks
  its generation/loading record before invoking runtime connect. This prevents
  any stale provider cleanup from
  aborting a new pairing. Cancel cleanup and import completion/failure handlers
  carry the generation they started with and write back only if it is still
  current, so stale work can never clear or overwrite a newer cancellation or
  reconnect. All connect success exits after asynchronous work recheck their
  generation before publishing. If a superseded provider connect nevertheless
  creates a session, the bridge validates both object identity and topic, then
  closes only that stale topic through the Sign Client's topic-scoped
  `disconnect({ topic, reason })`; it never calls provider-wide `disconnect()`
  or clears generic provider state for stale cleanup. The stale attempt rejects
  as superseded without emitting visible connected/error state, while a newer
  connection cannot invoke `provider.connect()` until the stale attempt and its
  delayed topic cleanup finish. Only then may the new approval start, so the
  stale attempt cannot publish last or erase the newer connected session. Tests
  assert the exact state transitions (loading →
  handoff-cleared, loading → error, loading → cancelled-as-idle, cancelled →
  reconnect-loading, stale-failure ignored) in addition to the action-level races:
  cancel-during-import (queued connect never starts), import rejection followed
  by polling (poller sees `error`, no 3-minute hang), reconnect after
  cancellation (new generation proceeds after the cleanup barrier), stale
  cleanup resolution/rejection, and cancel with an established persisted
  session present (session untouched, pairing aborted only).
- *Two-channel signing* (`trading:signing-request`, `bridge.ts:208`): **the
  immediate acknowledgement is preserved exactly** — ack `{ ok: true }`
  synchronously as today, then load the runtime and execute. If the import fails,
  the error travels through the existing correlated `trading:signing-response`
  error variant (`bridge.ts:221`), so the background rejects through its normal
  correlated path instead of waiting out its signing timeout. (This supersedes the
  round-2 wording that delayed the ack until after the load.)

**Exhaustive dispatcher table (design contract, verified against
`ui.ts:5155-5433` and `bridge.ts:208-228`).** State owner is the trading runtime
unless noted; every error envelope is `{ success: false, data: { error } }`.

| Message (payload branch) | Sync return | Success envelope | Completion channel | Bundle-load failure |
|---|---|---|---|---|
| `KNOWW_GET_PORTFOLIO_WALLETS` | `true` | `{ success: true, data: { wallets } }` | one `sendResponse` after discovery wait (≤700 ms) | error envelope |
| `KNOWW_GET_PORTFOLIO_CONNECTED_WALLET` | `true` | `{ success: true, data: { address, status: "connected" \| "disconnected" \| "unavailable" } }` | one `sendResponse` on completion | error envelope |
| `KNOWW_CONNECT_PORTFOLIO_WALLET` (installed wallet) | `true` | `{ success: true, data: { address } }` | one `sendResponse` on completion | error envelope |
| `KNOWW_CONNECT_PORTFOLIO_WALLET` (WalletConnect UUID) | `false` | sync ack `{ success: true, data: { status: "started" } }` | polled via `GET_PORTFOLIO_WALLETCONNECT_STATE` | core WC transition record → `status: "error"` |
| `KNOWW_SWITCH_PORTFOLIO_WALLET` | `true` | `{ success: true, data: { address } }` | one `sendResponse` on completion | error envelope |
| `KNOWW_PORTFOLIO_REAUTH` | `true` | `{ success: true, data: { address } }` | one `sendResponse` on completion | error envelope |
| `KNOWW_ENABLE_PORTFOLIO_TRADING` | `false` | sync ack `{ success: true, data: { status: "started" } }` | none — fire-and-forget; work errors swallowed today (`catch(() => {})`), flow state observed via approval polling | swallowed, matching today's error path |
| `KNOWW_APPROVE_PORTFOLIO_TRADING` | `true` | `{ success: true, data: { status: "approved" } }` | one `sendResponse` on completion | error envelope |
| `KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE` | `false` | sync `{ success: true, data: { status, error, qrSvg } }` | n/a (synchronous) | never loads; cold answers from core WC transition record (state owner: **core dispatcher**) |
| `KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT` | `false` | sync `{ success: true, data: { status: "cancelled" } }` | n/a (synchronous ack; optional warm cleanup is fire-and-forget) | never loads; every cancel bumps/writes the core generation first; successful same-generation warm cleanup clears it, rejection/cold cancel retains cancelled-as-idle (state owner: **core dispatcher**) |
| `trading:signing-request` | `false` (after sync ack, as `bridge.ts:228-229`) | sync ack `{ ok: true }` | correlated `trading:signing-response` carrying the same request `id` plus `result` (success) or `error` (failure) | correlated `trading:signing-response` error variant, same `id` |

**Single listener ownership.** The core dispatcher is the only
`chrome.runtime.onMessage` owner for signing requests. Listener registration is
separate from bridge initialization, and `createTradingRuntime()` installs only
a non-listener signing lifecycle plus a runtime delegation method. A standalone
signing-listener installer may remain for compatibility tests, but the runtime
factory never calls it. Tests assert cold-load success, load failure, correlated
signing completion, and exactly one core handler after runtime initialization.

**Async-intent lifecycle — ownership split.** The loader owns only the import and
the runtime cache. UI concerns belong to each intent wrapper: disabling/restoring
its own trigger, checking its card/panel is still mounted after the await, and
showing its surface's error treatment on failure. Stream subscriptions and other
per-widget resources are owned by the hydrated component, and the runtime exposes
an explicit disposer (or `AbortSignal`) contract for teardown. Concurrent callers
share one import and one runtime instance without sharing or overwriting each
other's UI state.

**Loading policy:** the trading bundle loads on first *trading intent* — opening the
trading panel, a stream-bet interaction, a portfolio/signing runtime message, or any
other path that today constructs `TradingPanel`/`TradingService`/`WalletBridge`.
Idle prefetch is **gated on a strong trading signal**, not universal. The existing
setup-complete flag cannot be the gate: it is stored under an *address-keyed* key
(`setup-flow-storage.ts`), and core does not know the connected address without
loading `TradingService`. Instead, a dedicated non-sensitive boolean
(`knowwTradingWarmEligible` in `chrome.storage.local`, no address or credential in
key or value) is owned by **the background service worker** — the one context every
logout path already flows through, whether it originates in the sidepanel, options
page, or content script. The background sets it `true` when trading credentials are
stored / setup completes, and clears it in its session-disconnect handling; this is
an accepted minimal background change (the non-goal excludes restructuring the
background bundle, not a two-line flag write). Content only ever reads the flag.
Tests exercise every canonical logout origin, not just a runtime-owned disconnect.
After cards first inject, `prefetchTradingRuntime()` is scheduled via
`requestIdleCallback` only if that flag reads `true`. Staleness is benign in both
directions — a stale `true` merely warms a cache for an ex-trader; a stale `false`
means the first click pays the load once. Tests cover positive, negative, stale,
and cleared-session cases. On non-streaming pages, a visitor who never set up
trading never downloads or parses the trading bundle at all; on streaming
surfaces the companion-card mount intentionally hydrates it regardless (see the
stream-bet hydration boundary — that is where the widget shows live trading state
pre-click). A trader gets an instant first panel open everywhere. This keeps
Goal 1 true end-to-end for the feed/news hosts that dominate page views.

While the bundle loads on a click, the triggering control shows its existing
loading/disabled affordance; a load failure surfaces the existing error treatment for
the surface and the next click retries.

**Type discipline:** everything in `content.js` may use `import type` from trading
modules freely (types are erased); value imports, re-exports, requires, and dynamic
imports from `src/content/trading/` (and transitively React/viem/react-qr-code) are
forbidden outside the trading bundle. Unresolved require/import expressions fail
closed. Only AST/token-validated contracts for the exact `trading-loader.ts`
and `platform-loader.ts` paths are accepted: resource string/template contents
must match and the magic comment text must be exactly
`/* webpackIgnore: true */`; formatter trivia outside tokens/comments is ignored.

### Decomposition targets

Modules below are the responsibility map; exact function-by-function placement is
plan-level detail. All moves are re-exports-free: importers update to the new paths.

**`src/content/ui.ts` (5,544) → `src/content/ui/`** — split along the trading seam
first, because it is what makes the dispatcher possible:

```
src/content/ui/
  cards.ts            — market card creation/rendering (core bundle)
  notifications.ts    — notification stack + container mgmt (core bundle)
  stream-bet-ui.ts    — stream companion card shell (core; see hydration boundary)
  trading-glue.ts     — the trading-dependent rendering/wiring extracted from ui.ts
                        (moves INTO the trading bundle, imported by trading-entry)
  index.ts            — public surface consumed by injection.ts/main.ts
```

**Stream-bet hydration boundary.** The quick-bet widget is not click-only today: it
reads `TradingService` state, holdings, and setup/allowance gates during render and
subscribes via `TradingService.onStateChange` (`ui.ts:3620`, `ui.ts:3755`) — moving
all of `stream-bet-logic` behind the loader while claiming the widget "stays in
core" would contradict itself. The boundary is therefore: synchronous,
dependency-free calculations (`pickHolding`, `clampStake`, `stepStake`,
`resolvePrimarySportsMoneyline`, `formatHoldingLine` — already pure in
`stream-bet-logic.ts`) **move to a core path** (`src/content/ui/stream-bet-calc.ts`)
so the import-boundary rule needs no exception for them; the complete quick-bet widget
**hydrates from the trading bundle when the companion card mounts** on streaming
surfaces. Stream surfaces are where users actively trade, so mount-time hydration
preserves today's behavior exactly (holdings and setup state visible pre-click)
while every non-streaming page still loads nothing. Tests cover the pre-hydration
placeholder state, the hydration transition, a live trading-state update after
hydration, and `onStateChange` unsubscription on card teardown.

**`src/content/trading/trading-panel.ts` (5,569) → `src/content/trading/panel/`** —
all inside the trading bundle:

```
src/content/trading/panel/
  panel.ts            — TradingPanel class shell: lifecycle, mount/unmount, routing
  order-view.ts       — order form rendering + submit wiring
  positions-view.ts   — positions/holdings rendering
  deposit-view.ts     — deposit flow rendering (funding controller wiring stays
                        exactly as sub-project 1 left it)
  setup-view.ts       — guided setup / approval surfaces
  panel-state.ts      — module-level state that today lives at trading-panel.ts top
  format.ts           — pure display helpers
```

**`src/sidepanel.ts` (6,538) → `src/sidepanel/`** — pure decomposition, no lazy
loading; `sidepanel.ts` becomes a thin entry that wires the modules:

```
src/sidepanel/
  portfolio.ts        — balances, positions, P&L rendering
  funding-ui.ts       — deposit/withdraw UI incl. requestWithdrawRequote and the
                        funding-controller wiring
  setup.ts            — setup wizard/banner orchestration
  markets.ts          — watchlist/markets sections
  messaging.ts        — runtime-message listeners and background RPC helpers
  shared.ts           — cross-section DOM helpers and formatters
```

Existing structural tests (`trading-panel-ux.test.ts` and friends) that
`readSource(...)` specific files are updated to point at the new module paths, and
their assertions must keep passing against the moved code — they are the regression
net for "moved verbatim".

## Sequencing — four independently shippable phases

1. **Platform adapters:** platform-manifest + platform-loader + per-adapter webpack
   entries + WAR + build assertion. `index.ts` drops the 45 imports.
2. **Trading dispatcher:** split `ui.ts` along the trading seam (`ui/` modules),
   add `trading-entry.ts` + `loader.ts` + `content-trading` entry + WAR + prefetch.
   This is the phase that removes React/viem from `content.js`.
3. **Trading panel decomposition:** `trading-panel.ts` → `trading/panel/` modules
   (bundle composition unchanged from phase 2).
4. **Sidepanel decomposition:** `sidepanel.ts` → `src/sidepanel/` modules.

Each phase ends green on the full verification suite before the next starts.

## Verification

- **Existing suite:** `npx vitest run` (440 tests today) and `pnpm typecheck` pass
  after every phase.
- **New unit tests:** manifest ↔ platforms/ adapter-convention completeness;
  `loadPlatformAdapter` picks the right entry for representative URLs (and returns
  false on unsupported hosts); `loadTradingRuntime` shares one in-flight promise
  across concurrent UI intents and runtime messages (one import, one runtime
  instance); a failed first import clears the cache and a retry succeeds, with the
  intent wrapper (not the loader) restoring its trigger and error surface;
  dispatcher tests **per message class** with exact envelopes — respond-on-
  completion (returns `true`, one completion response, load failure →
  `{ success: false, data: { error } }`), synchronous started-ack (ack
  `{ success: true, data: { status: "started" } }` before any import, returns
  `false`), conditional `KNOWW_CONNECT_PORTFOLIO_WALLET` (WalletConnect payload
  → started-ack branch, installed-wallet payload → respond-on-completion
  branch), synchronous state (returns `false`; cold answers from the core WC
  transition record — no record → idle shape, pending load → `initializing`,
  failed import → `error`, cancelled → idle — plus the full state-transition
  and generation-race assertions from the transition-record lifecycle; warm tab
  → delegated via `getLoadedRuntime()`; never triggers a bundle load), and
  two-channel signing (immediate `{ ok: true }` ack with `return false`,
  cold-load success completes via correlated `trading:signing-response` with
  the same request `id`, import failure delivers the correlated error variant,
  no background timeout, exactly one listener after runtime init);
  the prefetch gate never fires without the trading signal.
- **Build assertions** (extend `scripts/assert-production-bundle.mjs`):
  - `content.js` under a hard byte budget (set from the measured post-phase-2 size
    plus headroom; expected well under half of today's 1.44 MB);
  - `content.js` contains no React/viem markers after phase 2;
  - emitted `dist/platforms/*.js` outputs match `manifest.json` **exactly** —
    every manifest entry has one emitted bundle and a WAR pattern covering it,
    any emitted platform output not in the manifest fails the build (helper
    modules must never emit), each emitted platform ESM passes the
    module-contract smoke (exports `adapter`, `adapter.name` equals the manifest
    name, no import-time side effects), and `content-trading.js` exists and is
    WAR-listed;
  - manifest ↔ routing consistency: manifest regexes strictly equal each
    adapter's exported `hostPatterns` (source + flags) in baseline order, and
    the coverage-fixture contract from the platform section holds (every
    fixture hostname resolves to its expected adapter-or-none; every manifest
    entry has at least one injectable, WAR-covered fixture host);
  - platform-entry graph purity: each platform entry's ESM module graph (from
    stats/source boundaries) excludes `platform-registry.ts`,
    `registerAdapterWithRetry`, and registration helpers — a separately
    bundled private registry copy is invisible to the jsdom smoke, so this is
    asserted from the graph, not at runtime;
  - `content-trading.js` is a real ES module exposing the expected exports —
    statically parsed export names (e.g. `es-module-lexer`) as the cheap shape
    check, plus the automated two-phase import-purity smoke test defined in the
    side-effect-free import invariant (Node + jsdom + instrumented `chrome` stub:
    import → zero side effects; `createTradingRuntime()` → exactly one
    installation; `dispose()` → removal). No legacy-module exception.
  - exactly one canonical built-manifest WAR entry owns both
    `content-trading.js` and `platforms/*.js`; both resources occur once and its
    `matches` set exactly equals the origin-normalized supported-host set (no
    split ownership, duplicate owner, `<all_urls>`, missing, or drifted match);
- **Import-boundary check:** two layers with **zero exceptions** — the loader lives
  at `src/content/trading-loader.ts` (outside `trading/`) and the pure stream
  calculations move to `ui/stream-bet-calc.ts` precisely so no allowlist is
  needed. A TypeScript-AST source test asserts no value imports, value re-exports,
  CommonJS requires, or dynamic imports from `src/content/trading/` (or
  react/viem) in core-bundle modules, fails closed on unresolved forms except
  the two exact loader contracts above, and a
  webpack-stats module-graph assertion in `assert-production-bundle.mjs` (reading
  the persisted classic/ESM stats artifacts) asserts that no react/viem/trading
  module is a member of the `content` entry's module graph. The stats are
  persisted with the fields needed to associate assets/chunks with entrypoints
  and to expose nested modules and reasons, and the traversal is **recursive**:
  production module concatenation nests constituent modules inside
  `modules[].modules`, so a top-level scan can miss React/trading/adapter code
  hidden in a concatenated module — recurse or, failing that, disable
  concatenation for the verification build. A separate negative assertion checks
  the platform boundary against a **deterministic forbidden set** — "adapter-only
  dependency" is defined structurally, not inferred from graph exclusivity: no
  module under `src/content/platforms/` may appear in the `content` entry's
  graph, with `platforms/manifest.json` as the single checked-in exception
  (imported by `platform-manifest.ts`). Anything that genuinely needs sharing
  moves out of `platforms/` or onto an explicit checked-in shared-module
  allowlist. This protects Goal 2 independently of the byte budget
  (string-marker greps on minified output are brittle; the stats graph is
  authoritative).
- **Manual QA (owner):** one adapter-heavy host (e.g. Twitter) — cards inject, panel
  opens, a small trade and a deposit flow work, including one trade opened
  *before* idle prefetch could fire; a fresh never-traded profile browses a
  supported **non-streaming** page through the idle period and DevTools shows
  `content-trading.js` was never fetched; a sidepanel deposit/withdraw against a freshly loaded tab
  (exercises the message dispatcher cold path); one streaming host — stream bet
  works, including holdings/setup state visible on card mount; sidepanel —
  portfolio, deposit, withdraw render and function. Record before/after
  transfer size and parse/execute timing for `content.js` (DevTools coverage +
  performance panel) so the win is documented, not assumed.

## Risks

- **Isolated-world dynamic import:** native `import()` in content scripts requires
  MV3-era Chrome; the extension is MV3-only already, so this is not a compat
  regression. The dispatcher's failure path (retry on next intent) covers transient
  load errors.
- **Init-order coupling:** `content/index.ts` documents that import order preserves
  `window.KNOWW_*` global initialization. Adapter and trading loads move to runtime;
  both must happen after the core modules initialize (they do — `main.ts` runs last
  and drives both dispatchers).
- **Adapter match drift:** moving match rules into the manifest risks activating the
  wrong adapter on edge-case URLs. Mitigation: manifest entries are extracted
  verbatim from each adapter's registration, plus per-adapter URL tests for hosts
  with non-trivial rules.
- **Idle prefetch masking breakage:** prefetch could hide a broken on-demand path in
  QA. The loader test covers the cold path directly, and QA includes one
  click-before-idle trade open.

## Round-1 review history — resolved (do not implement from this section)

> All items below were verified, adopted, and folded into the normative design
> sections above on 2026-07-11. Kept for review history only.

**Verdict:** The Phase 2 seam is directionally correct, but the design needs the
required clarifications below before implementation. In particular, the emitted
trading entry must be a real ESM module, and wallet requests originating outside the
content UI must remain functional before the trading bundle has loaded.

### Required changes

1. **Specify an ESM output contract for `content-trading.js`.** The current webpack
   configuration emits ordinary self-executing entry bundles. Native
   `import(chrome.runtime.getURL("content-trading.js"))` will execute such a file,
   but its module namespace will not automatically contain webpack's internal
   `TradingPanel`, `TradingService`, and other exports. Phase 2 must use a dedicated
   ESM webpack configuration (or an explicitly verified `output.module` /
   `experiments.outputModule` equivalent) for the lazy entry. The loader must also
   preserve the browser-native boundary with
   `import(/* webpackIgnore: true */ chrome.runtime.getURL(...))`; otherwise webpack
   may transform the import back into its own chunk runtime. Add a production test
   that imports the built URL and asserts the expected public exports, rather than
   only checking that the file exists.

2. **Keep an eager, lightweight runtime-message dispatcher in `content.js`.** Today
   `ui.ts` calls `WalletBridge.init()` eagerly because sidepanel deposit/withdraw
   signing requests can arrive before the user opens a trading panel. The same file
   also handles portfolio wallet discovery, connect, reauthorization, setup, and
   approval messages. Phase 2 should register a core listener synchronously, treat
   these messages as trading/wallet intents, await `loadTradingStack()`, and delegate
   to one trading-runtime handler. Its contract must preserve Chrome's asynchronous
   `sendResponse` lifetime, guarantee exactly one response, and return a safe error
   if loading fails. Without this dispatcher, sidepanel funding can regress to
   `Receiving end does not exist` on a fresh content tab.

3. **Make the core/trading dependency direction explicit.** `content.js` may import
   the loader and erased types, while the lazy bundle may consume narrow core ports;
   neither `trading-entry.ts` nor `trading-glue.ts` should value-import the core
   `ui/index.ts` barrel if that barrel imports the loader. Define a small facade such
   as `TradingRuntime` containing only the operations core UI invokes, instead of
   exporting entire classes and `export * as streamBetLogic`. This prevents a new
   cross-bundle cycle and keeps the lazy boundary reviewable.

4. **Define the stream-bet hydration boundary explicitly.** Current market-card
   rendering uses pure helpers such as `pickHolding`, `clampStake`, `stepStake`, and
   `resolvePrimarySportsMoneyline`, but it also reads `TradingService` state, loads
   holdings, derives setup/allowance/deposit states, and subscribes to service
   updates before an order click. Moving the complete `stream-bet-logic` namespace
   behind the loader conflicts with the statement that `stream-bet-ui.ts` stays in
   core and loads the stack only on interaction. Keep synchronous dependency-free
   calculations in core, then choose and document one behavior-preserving boundary:
   either hydrate the complete quick-bet widget from the lazy bundle when it becomes
   visible/expanded, or render a core placeholder that explicitly loads and hydrates
   on the first user intent. Test the placeholder/loading transition and state
   subscription cleanup.

5. **Reconcile idle prefetch with the stated performance goal.** Unconditionally
   prefetching after the first cards inject means nearly every normal page eventually
   downloads and parses React, viem, and the trading stack even when the user never
   trades. Either remove universal prefetch, gate it on a strong trading signal, or
   narrow Goal 1 to initial-load cost only. Verification should measure both the
   cold core bundle and whether `content-trading.js` was requested on a non-trading
   session; a `content.js` byte budget alone cannot prove the latter.

6. **Define lifecycle behavior for asynchronous intents.** Multiple clicks and a
   simultaneous portfolio message must share the loader's one in-flight promise.
   After it resolves, handlers must confirm that the initiating card/panel is still
   mounted before changing its loading state or opening UI. A failed import should
   clear the cache, restore every disabled trigger, produce one user-visible error,
   and allow the next intent to retry.

### Verification additions

- Build the lazy entry as ESM and assert that its native module namespace exposes
  the declared `TradingRuntime` factory/facade.
- Start with only `content.js`, send a signing or portfolio-wallet message, and prove
  that the lazy runtime loads and responds successfully before any panel click.
- Trigger two UI intents plus one runtime-message intent concurrently and assert one
  network import and one runtime instance.
- Exercise a failed first import followed by a successful retry, including restored
  button state and a completed Chrome message response.
- Observe a representative non-trading session through the idle period and assert
  that `content-trading.js` is not fetched if the goal remains true on-demand loading.
- Prefer a webpack-stats/module-graph assertion for the React/viem boundary in
  addition to string-marker checks, which can be brittle after minification.
- Cover the stream-bet cold state, hydration trigger, live trading-state update, and
  teardown so the split does not leave stale subscriptions or change setup/deposit
  affordances silently.

### Optional hardening

- Minimize `web_accessible_resources` matches for the trading entry and consider
  dynamic WAR URLs to reduce extension-resource fingerprinting. Keep the lazy entry
  free of import-time behavior that assumes it can only execute in the isolated
  extension world.
- Record before/after transfer sizes and parse/execute timings separately. Source
  size and minified byte size do not show the main-thread cost that motivates this
  phase.

### Dispositions (verified against source, 2026-07-11)

1. **ESM output contract — CONFIRMED, adopted.** `webpack.config.cjs` has no
   `experiments.outputModule`; all entries emit classic bundles whose native-import
   namespace would be empty. Both in-repo dynamic-import precedents use webpack's
   internal chunk runtime, so they prove nothing for native URL imports. Resolved in
   "New webpack entries": second ESM config in the exported array, `webpackIgnore`
   comments, and a built-file export-names assertion (static parse; Node import is
   not viable since trading modules touch `chrome.*` at module scope).
2. **Eager runtime-message dispatcher — CONFIRMED, adopted.** `ui.ts:5145` eagerly
   runs `WalletBridge.init()` (its own comment documents the "Receiving end does not
   exist" failure) and `ui.ts:5155+` handles the portfolio wallet message set.
   Resolved in "Trading stack lazy loading": synchronous core dispatcher that awaits
   the runtime and delegates, with the exactly-one-response contract.
3. **Dependency direction / facade — adopted.** `trading-entry` now exposes a narrow
   `TradingRuntime` facade instead of re-exporting classes and `export * as`; the
   barrel-cycle ban is explicit and enforced by the boundary check.
4. **Stream-bet hydration boundary — CONFIRMED, adopted.** Pre-click trading-state
   reads and `onStateChange` subscription verified at `ui.ts:477/3620/3755`.
   Resolved in the `ui/` decomposition section: pure helpers stay in core; the
   quick-bet widget hydrates from the trading bundle on companion-card mount
   (streaming surfaces only), preserving today's pre-click behavior.
5. **Prefetch vs goal — adopted.** Prefetch is now gated on a trading signal
   (setup-complete / stored trading session); never-traded visitors never fetch the
   bundle. Verified by a unit test on the gate plus a manual QA item watching a
   non-trading session's network.
6. **Async-intent lifecycle — adopted.** Shared in-flight promise across UI and
   message intents, mounted-check after resolve, failure clears cache + restores
   triggers + one user-visible error + completed message response; covered by the
   new loader unit tests.

**Optional hardening:** deferred, with one exception — the trading entry keeps no
import-time side effects that assume the isolated world (good hygiene regardless).
`use_dynamic_url`-style WAR fingerprinting reduction is out of scope for this
sub-project; before/after parse/execute timing capture was folded into Manual QA.

## Round-2 review history — resolved (do not implement from this section)

> All items below were verified, adopted, and folded into the normative design
> sections above on 2026-07-11. Dispositions at the end of this section.

**Verdict:** The revised Phase 2 design incorporates the first review well, but it
is not implementation-ready until the two Critical contracts below are resolved.
The remaining Required findings should also be made explicit so the build and
runtime behavior are deterministic rather than left to plan-level interpretation.

### Critical findings

1. **The classic and ESM webpack compilers can delete or race each other's output.**
   The proposed `module.exports = [classic, esm]` writes both compilations into
   `dist`, while the current configuration uses `output.clean: true` and runs
   `CopyPlugin`. If that configuration is cloned, either compiler can clean files
   emitted by the other, and both can race while copying the manifest and static
   assets. Specify one output owner: only the classic compiler cleans `dist` and
   copies static assets; the ESM compiler uses `clean: false`, omits `CopyPlugin`,
   and runs after the classic compiler (or emits to a separate directory that is
   merged deterministically). Add a clean-build assertion proving that all classic
   and lazy assets coexist.

2. **Signing requests require a distinct two-channel protocol.** The generic
   runtime-message contract does not preserve current signing behavior.
   `trading:signing-request` is acknowledged immediately with `{ ok: true }`, while
   its eventual result arrives separately as a correlated
   `trading:signing-response`; a bridge/load failure must acknowledge with
   `{ ok: false, error }` so the background rejects immediately instead of waiting
   for its signing timeout. Define this separately from portfolio messages and
   prevent `WalletBridge.init()` from registering a second signing listener after
   the eager core dispatcher owns the message. Extract listener registration from
   bridge initialization or inject the dispatcher into the bridge runtime. Tests
   must cover cold-load success, load failure, correlated completion, and exactly
   one handler after runtime initialization.

### Required findings

3. **Generate platform entries from a canonical adapter list, not every `.ts`
   file.** The directory contains helper libraries such as `basic-adapter.ts`,
   `editorial-adapter.ts`, `helpers.ts`, and `story-adapter-helpers.ts`; these must
   not become standalone entries, manifest records, or web-accessible resources.
   Make `PLATFORM_MANIFEST` the source of truth and assert both directions: every
   manifest adapter has a source/output, and every self-registering adapter appears
   in the manifest. Prefer exporting the adapter from the ESM entry and registering
   it through the core registry, rather than bundling another registry instance and
   relying on `window.KNOWW_PLATFORM` replacement as a cross-bundle singleton.

4. **Persist webpack stats for both compilations.** The documented build runs
   webpack and then starts `assert-production-bundle.mjs` as a separate process;
   the current assertion only scans files in `dist`, so it cannot inspect webpack's
   module graph. Require named classic/ESM stats artifacts (or an equivalent build
   plugin output) and make the assertion read both. This is necessary for the
   claimed authoritative proof that React, viem, and other trading modules are not
   members of the core `content` entry.

5. **Define the lazy-chunk policy.** `splitChunks: false` does not prevent async
   imports in transitive dependencies from emitting extra chunks. The proposed WAR
   list covers only `content-trading.js` and `platforms/*.js`; an unexpected ESM
   chunk could therefore be unreachable or use an invalid runtime public path.
   Either enforce and assert exactly one JavaScript asset per lazy entry, or define
   extension-safe URLs and WAR coverage for every emitted ESM chunk. The production
   build must fail on an unaccounted lazy asset.

6. **Name an implementable core-safe prefetch signal.** Setup completion is stored
   under an address-keyed key, but core does not know the connected address without
   loading `TradingService`. Define the exact signal and its stale-account behavior.
   A dedicated non-sensitive `hasPreviouslyTraded`/`tradingRuntimeWarmEligible`
   boolean maintained when setup completes would keep the gate cheap and independent
   of wallet initialization. Test positive, negative, stale, and cleared-session
   cases.

7. **Clarify ownership of async UI cleanup.** The shared loader can own only the
   import/runtime cache; it cannot reliably restore a caller's disabled control,
   determine whether a card remains mounted, or dispose a stream subscription.
   Assign those responsibilities to the intent wrapper/hydrated component and give
   the runtime an explicit disposer or `AbortSignal` contract. Concurrent callers
   should share one import without sharing or overwriting each other's UI state.

8. **Enumerate the eager dispatcher allowlist and preserve each response shape.**
   Portfolio messages currently have different timing semantics: some acknowledge
   `started` before long-running work, some respond only after completion, and
   signing uses the separate correlated response described above. List every moved
   message type with its acknowledgement shape, completion behavior, and error path
   instead of routing all messages through one generic handler contract.

9. **Fix the import-boundary rule's internal exceptions.** Core must value-import
   `trading/loader.ts`, and the pure stream helpers currently live below
   `content/trading/`. A blanket ban on value imports from that directory conflicts
   with the proposed structure. Move dependency-free stream calculations to a core
   path and explicitly allowlist only the loader; keep every other trading value
   import out of the classic `content` module graph.

10. **Resolve the import-time-side-effect contradiction.** Verification says the
    ESM entry cannot be evaluated in Node because trading modules touch `chrome.*`
    at module scope, while the disposition says the entry has no import-time behavior
    that assumes the isolated world. Choose and enforce one invariant. Prefer an
    entry whose import only defines `createTradingRuntime`, with listeners and other
    side effects installed by the factory. Static export-name parsing is then only a
    structural check; add an extension-context smoke test that imports the built
    module and creates the runtime.

11. **Mark the first-round feedback as resolved review history.** The document still
    contains a `Required changes` section saying clarification is needed, followed by
    dispositions saying those items were adopted. Rename the earlier appendix to
    `Round-1 review history — resolved`, or retain only the dispositions, so an
    implementation agent can distinguish the normative design from closed review
    comments.

### Approval condition

Phase 2 is ready to plan after both Critical findings have concrete contracts and
the Required build/runtime rules above are incorporated into the normative design.
The narrow `TradingRuntime` facade, explicit native-ESM boundary, stream-bet
hydration model, and non-universal prefetch direction should be retained.

### Round-2 dispositions (verified against source, 2026-07-11)

1. **Compiler output race — CONFIRMED, adopted.** `output.clean: true` and
   `CopyPlugin` exist in the current config; cloning them into a config array
   would make the compilers delete/race each other. Resolved in "Build pipeline
   ownership": classic compiler owns clean + copy, ESM config is `clean: false`
   without CopyPlugin, ordered via MultiCompiler `dependencies`, plus a
   clean-build coexistence assertion.
2. **Signing two-channel protocol — CONFIRMED, adopted.** `bridge.ts:208-228`:
   `trading:signing-request` is acked `{ ok: true }` immediately and the result
   arrives as a correlated `trading:signing-response`; `WalletBridge.init()` has
   its own `initialized` guard and registers the listener itself. Resolved in the
   dispatcher section: signing is its own message class (ack `{ ok: false, error }`
   on load failure so the background rejects fast), listener registration is
   extracted from bridge init, and single-handler ownership is tested.
3. **Canonical adapter list — CONFIRMED, adopted.** The platforms directory
   contains non-adapter helpers (`basic-adapter.ts`, `editorial-adapter.ts`,
   `helpers.ts`, `story-adapter-helpers.ts`); globbing would wrongly emit them.
   Also adopted export-and-register-in-core over cross-bundle self-registration
   (a lazy bundle importing the registry would get its own module copy).
   `PLATFORM_MANIFEST` is now the canonical list with a both-directions assertion.
4. **Persisted webpack stats — CONFIRMED, adopted.** `assert-production-bundle.mjs`
   runs post-build on `dist` files only. Both compilations now write named stats
   artifacts that the assertion reads for the module-graph boundary proof.
5. **Lazy-chunk policy — CONFIRMED, adopted.** `splitChunks: false` is already set
   and demonstrably does not prevent async chunks (the offscreen runtime chunk in
   `dist/` today). Adopted: exactly one JS asset per lazy entry, build fails on
   unaccounted assets.
6. **Prefetch signal — CONFIRMED, adopted.** Setup-complete storage is
   address-keyed (`setup-flow-storage.ts`), unreadable from core without the
   trading stack. Adopted the dedicated `knowwTradingWarmEligible` boolean with
   defined write/clear points, benign staleness, and four test cases.
7. **Cleanup ownership — adopted.** Loader owns import + cache only; intent
   wrappers own trigger state, mounted-checks, and error surfaces; hydrated
   components own subscriptions with an explicit disposer/`AbortSignal` contract.
8. **Per-message semantics — CONFIRMED, adopted.** `KNOWW_ENABLE_PORTFOLIO_TRADING`
   acks `{ status: "started" }` synchronously and returns `false` (`ui.ts:5352`),
   unlike the respond-on-completion messages. The dispatcher now defines three
   message classes with semantics preserved verbatim, and the plan must enumerate
   the full allowlist with shapes.
9. **Boundary-rule exceptions — CONFIRMED, adopted.** Loader is the single
   allowlisted value import from `src/content/trading/`; the pure stream
   calculations move to `src/content/ui/stream-bet-calc.ts` so they need no
   exception.
10. **Side-effect contradiction — CONFIRMED, adopted.** One invariant now governs:
    importing the entry only defines `createTradingRuntime`; the factory installs
    all side effects. Static export parsing is the build gate; an
    extension-context smoke test covers runtime creation; Node import is
    explicitly not a gate (legacy modules may touch `chrome.*` at module scope).
11. **Review-history hygiene — adopted.** Both feedback sections are retitled as
    resolved history with do-not-implement banners; the normative design is the
    body above them.

## Round-3 review history — resolved (do not implement from this section)

> All items below were verified, adopted, and folded into the normative design
> sections above on 2026-07-11. Dispositions at the end of this section.

**Verdict:** Request changes. The revised design resolves most Round-2 concerns and
is close to implementation-ready, but the normative dispatcher and import-purity
contracts remain incomplete. Resolve the Critical findings before planning; fold
the Required corrections into the normative sections and verification gates.

### Critical findings

1. **The dispatcher classification does not cover the current message protocol.**
   The current portfolio listener has payload-dependent and synchronous variants
   that do not fit the three classes as presently described:

   - `KNOWW_CONNECT_PORTFOLIO_WALLET` synchronously acknowledges `started` for
     WalletConnect, but responds on completion for an installed wallet.
   - `KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT` and
     `KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE` respond synchronously and return
     `false`.
   - Switch, reauthorization, and approval respond asynchronously.

   A cold dispatcher cannot synchronously return live WalletConnect state if that
   state exists only inside the unloaded runtime. Add an exhaustive table keyed by
   message type and, where necessary, payload branch. For every row specify the
   state owner, synchronous return value, response envelope, completion channel,
   and bundle-load failure behavior. Decide whether WalletConnect state remains in
   a lightweight core owner or whether its response intentionally becomes async.
   Preserve the existing error envelope (`{ success: false, data: { error } }`)
   where callers already consume `data.error`; do not replace it with a generic
   top-level `error` field.

2. **The side-effect-free import invariant is contradicted and not automatically
   verified.** The normative design says importing `content-trading.js` performs no
   DOM, listener, subscription, storage, or `chrome.*` work in the entry or any
   dependency it initializes. Verification later permits legacy trading modules to
   touch `chrome.*` at module scope, while static export-name parsing proves only
   namespace shape. Current trading modules include module-scope listener setup, so
   the factory boundary must be created deliberately rather than assumed.

   Add an automated extension-like smoke test with two phases: import the built ESM
   without calling the factory and assert no observable registrations/mutations;
   then call `createTradingRuntime()` and assert exactly one installation, followed
   by successful disposal. Remove the legacy-module exception from the normative
   verification wording, or weaken the invariant explicitly and document the
   accepted import-time behavior.

### Required findings

3. **Choose one signing acknowledgement contract.** The design calls the signing
   acknowledgement immediate but sends `{ ok: true }` only after the lazy runtime
   loads. Either hold the response channel (`return true`) and acknowledge after a
   successful import, using `{ ok: false, error }` on load failure, or preserve the
   existing immediate acknowledgement and report an import failure through the
   correlated `trading:signing-response`. Document the chosen timing and test cold
   success, cold failure, timeout avoidance, correlated completion, and single
   listener ownership.

4. **Make platform verification match the canonical manifest.** The normative
   platform section correctly excludes helper modules, but the build assertion
   still says every `src/content/platforms/*.ts` file must emit a platform bundle.
   Compare emitted platform entries exactly with `PLATFORM_MANIFEST`, reject
   unexpected outputs, and verify that no manifest adapter or adapter-only
   dependency appears in the classic `content` module graph.

5. **Define a build-readable canonical platform artifact.** A TypeScript manifest
   containing matcher functions cannot be consumed directly by the current CommonJS
   webpack configuration. Use a Node-readable declarative source (JSON/CJS/plain JS)
   from which both the runtime manifest and webpack entry map are derived, or specify
   an equally concrete extraction/generation step. Once self-registration is removed,
   reverse completeness can no longer search for registration calls; require a
   detectable adapter convention such as a top-level module exporting `adapter` and
   define how helpers are distinguished.

6. **Correct the import-boundary assertions.** Core is allowed to value-import
   `src/content/trading/loader.ts`, but the stated stats rule rejects every trading
   module in the `content` graph. Move the loader to a core namespace or exempt that
   exact module consistently in both source and stats checks. Add a separate negative
   assertion for platform adapters so Goal 2 is protected independently of the
   `content.js` byte budget.

7. **Assign ownership of `knowwTradingWarmEligible`.** The flag is promised to clear
   when the trading session fully disconnects, but logout can originate from the
   sidepanel, options page, or background without loading the trading runtime. Name
   the canonical writers/clearers and permit the minimal background/session change
   if necessary. Otherwise explicitly accept permanent benign `true` staleness and
   remove the clear guarantee. Tests should exercise every canonical logout path,
   not only a runtime-owned disconnect.

8. **Split verification by real message semantics.** The current test description
   still treats a generic portfolio/signing message as returning `true` and producing
   one response. Replace it with tests for respond-on-completion, synchronous state,
   synchronous started-ack, conditional WalletConnect connect, and two-channel
   signing. Include each class's exact success and load-failure envelopes.

### Documentation consistency

- Update the webpack-entry example that still says entries are generated by reading
  the platforms directory; the canonical source is now the manifest artifact.
- Rename the old description of platform bundles as “side-effect-only.” They now
  export adapters and must not self-register.
- Narrow the claim that a never-traded user never loads the trading bundle: streaming
  companion-card mount intentionally hydrates it even before a trade. The claim is
  true for non-streaming pages, not globally.

### Positive assessment and approval condition

The compiler ownership model, narrow `TradingRuntime` facade, core-side adapter
registration, one-asset lazy-chunk policy, stream-bet hydration/disposal ownership,
and non-universal prefetch direction are sound. The design is ready to plan once the
two Critical findings have executable contracts and the Required assertions above
are incorporated into the normative design.

### Round-3 dispositions (verified against source, 2026-07-11)

1. **Dispatcher classification incomplete — CONFIRMED, adopted.** Verified in
   `ui.ts:5253-5351`: `KNOWW_CONNECT_PORTFOLIO_WALLET` branches on payload
   (WalletConnect UUID → sync `started` ack + `return false`; installed wallet →
   respond-on-completion), `KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT` and
   `KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE` respond synchronously and return
   `false`, and errors use `{ success: false, data: { error } }` — not a
   top-level `error` field. Resolved: the dispatcher section now defines four
   observed classes including *synchronous state* with a cold-default rule
   (cold tab ⇒ no WC flow can exist ⇒ answer the exact idle shape from
   `walletconnect-bridge.ts:117` synchronously; warm tab ⇒ delegate via new
   `getLoadedRuntime()`), preserves the `data.error` envelope, and requires the
   plan to carry an exhaustive per-type/per-branch table (state owner, sync
   return, envelope, completion channel, load-failure behavior).
2. **Import invariant contradicted and unverified — CONFIRMED, adopted.**
   Verified: `trading-service.ts:1291-1308` registers `chrome.runtime.onMessage`
   and `WalletBridge.onAccountsChanged` at module scope today. Resolved: the
   invariant section now states the boundary must be created (registrations move
   into `createTradingRuntime()` with `dispose()`), the legacy-module exception
   is deleted from Verification, and an automated two-phase import-purity smoke
   test (Node + jsdom + instrumented chrome stub; import → zero side effects;
   factory → exactly one installation; dispose → removal) joins the build gates.
3. **Signing ack timing — CONFIRMED, adopted.** Chose behavior preservation:
   immediate `{ ok: true }` ack exactly as `bridge.ts:228` does today; import
   failure travels through the existing correlated `trading:signing-response`
   error variant (`bridge.ts:221`) so the background rejects without waiting out
   its timeout. Supersedes the round-2 ack-after-load wording.
4. **Platform verification vs manifest — CONFIRMED (stale wording), adopted.**
   The build assertion now compares emitted `platforms/*.js` exactly against the
   manifest (helpers must never emit; unexpected outputs fail), plus a negative
   module-graph assertion keeping adapters out of the `content` entry.
5. **Build-readable manifest — CONFIRMED, adopted.** `webpack.config.cjs` is CJS
   and cannot import a TS matcher module. Canonical source is now
   `src/content/platforms/manifest.json` (name + hostPatterns), consumed by both
   the webpack config and the typed runtime wrapper; adapter convention is a
   top-level `export const adapter` (helpers never export it), replacing
   registration-call detection for reverse completeness.
6. **Boundary-rule inconsistency — CONFIRMED, adopted.** The loader moves to
   `src/content/trading-loader.ts` (outside `trading/`), so both the source grep
   and the stats rule hold with zero exceptions.
7. **Warm-flag ownership — CONFIRMED, adopted.** Logout can originate in
   sidepanel/options/background without the content runtime loaded. The
   background service worker is the canonical owner (sets on credential
   store/setup completion, clears in session-disconnect handling); content only
   reads. Accepted as a minimal background change; tests cover every logout
   origin.
8. **Per-class verification — adopted.** The unit-test description now
   enumerates all five behaviors (respond-on-completion, started-ack,
   conditional connect, synchronous state cold/warm, two-channel signing) with
   exact success and load-failure envelopes.
9. **Documentation consistency — all three adopted.** Entry-map comment now
   points at the manifest artifact; "side-effect-only" adapter wording replaced
   with export-and-register; the never-traded claim is narrowed to non-streaming
   pages (streaming card mount intentionally hydrates) in both the loading
   policy and manual QA.

## Round-4 review history — resolved (do not implement from this section)

> All items below were verified, adopted, and folded into the normative design
> sections above on 2026-07-11. Dispositions at the end of this section.

**Verdict:** Request changes. The Round-3 dispositions resolve most earlier
findings, but the new cold WalletConnect model contains one blocking race. The
remaining items are required matching and verification contracts.

### Critical finding

1. **WalletConnect cancellation and failure are lost while the runtime import is
   pending.** The dispatcher acknowledges the WalletConnect connect request before
   loading the runtime, while `getLoadedRuntime()` remains `null` during the import.
   In that interval the documented cold `GET_STATE` path reports `idle`, and cold
   `CANCEL` acknowledges success with nothing to cancel.

   This permits two incorrect outcomes:

   - A user cancels during loading, but the queued connect runs after the import
     resolves and pairing begins despite cancellation.
   - The import fails, but every subsequent state poll reports `idle`; the sidepanel
     waits until its three-minute timeout instead of receiving the load error.

   A content tab can also have restorable WalletConnect session data in
   `chrome.storage.local`, so “runtime not loaded” is not equivalent to “no session
   exists.” Add a small core-owned WalletConnect transition record (generation plus
   `loading`/`error`/`cancelled`) or an abort/queued-cancel guard checked before the
   runtime starts work. Cold `GET_STATE` must expose a pending load error, and cold
   `CANCEL` must invalidate queued work and, where applicable, a restorable session.
   Tests must cover cancel-during-import, import rejection followed by polling,
   reconnect after cancellation, and cancellation of persisted/restorable state.

### Required findings

2. **Specify the complete started-ack envelope.** The existing handlers respond
   with `{ success: true, data: { status: "started" } }`, not the shorthand
   `{ status: "started" }` used in the normative dispatcher and verification text.
   State the full envelope for WalletConnect connect and enable-trading, and include
   it in the per-class tests. The exhaustive per-type/per-payload table should be
   part of the design contract rather than deferred entirely to the implementation
   plan.

3. **Define lossless manifest matcher semantics and overlap behavior.** Declarative
   `hostPatterns` need a precise grammar that preserves the current regex behavior:
   exact hosts, optional `www`, arbitrary subdomains, anchors, and flags. The loader
   currently selects only the first manifest match, so an over-broad candidate can
   import an adapter whose exact matcher rejects the page and prevent a later valid
   adapter from loading. Either use a lossless matcher representation (for example,
   explicit exact/suffix kinds or regex source plus flags) with collision/order
   assertions, or iterate matching candidates until the exported adapter confirms
   activation. Add positive, negative, overlap, and precedence fixtures.

4. **Cross-check the platform manifest with supported-host and WAR routing.** The
   new adapter manifest and `SUPPORTED_MATCH_PATTERNS` are independent routing
   sources. Assert that every enabled supported host maps to exactly one adapter or
   an explicit no-adapter exception, and that every manifest host is covered by
   content-script registration and WAR matches. Without this, a correct adapter
   bundle can be unreachable at runtime or a supported page can load no adapter.

5. **Verify the built platform-module contract.** For every emitted platform ESM,
   import or parse the production asset and assert that it exports the expected
   `adapter`, that `adapter.name` equals the manifest name, and that import performs
   no self-registration or core-registry replacement. Source syntax and output-name
   checks alone do not prove the native module namespace is usable.

6. **Broaden the import-purity smoke instrumentation.** The invariant forbids more
   than storage writes and Chrome listener registration. The import-only phase must
   observe storage reads and writes, `window`/`document`/Chrome EventTarget listener
   registration, timers, observers, queued microtasks, DOM mutation, and custom
   subscriptions such as wallet-account listeners. Drain pending microtasks before
   declaring the import phase clean; then verify factory installation and disposal
   against the same instruments.

7. **Make webpack stats inspection recursive.** Production module concatenation can
   hide React, trading, or adapter dependencies inside nested `modules`. Persist the
   stats fields needed to associate assets/chunks with entrypoints and recursively
   traverse concatenated/nested modules and reasons. Alternatively, disable module
   concatenation for the verification build. A top-level module scan is not a
   sufficient boundary gate.

### Positive assessment and approval condition

The immediate signing acknowledgement plus correlated failure, full dispatcher
class split, background-owned warm-prefetch flag, build-readable manifest, loader
placement, compiler ownership, exact emitted-entry set, and stream hydration model
are now coherent. Resolve the WalletConnect import-pending race before planning;
incorporate the Required matcher and verification contracts into the normative
design before approval.

### Round-4 dispositions (verified against source, 2026-07-11)

1. **WalletConnect import-pending race — CONFIRMED, adopted.** Both specifics
   verified: `sidepanel.ts:2094` polls WC state against a 180 s deadline (a lost
   error means a full 3-minute hang), and `walletconnect-bridge.ts:56-80,212`
   persists WC session data in `chrome.storage.local` via
   `ChromeWalletConnectStorage`, so "runtime not loaded" ≠ "no session exists".
   The round-3 cold model ("cold ⇒ idle / nothing to cancel") had a real race
   during the import window. Resolved in the *synchronous state* class: a
   core-owned WC transition record (`generation` + `loading`/`error`/
   `cancelled`), cold `GET_STATE` reporting `initializing` while loading and
   `error` after a failed import, and a queued-cancel guard so a cancel during
   import prevents the queued connect from ever starting pairing (and clears
   restorable session state where applicable). All four requested tests listed.
2. **Started-ack envelope — CONFIRMED, adopted.** `ui.ts:5256/5357` send
   `{ success: true, data: { status: "started" } }`; the shorthand in the
   normative text is corrected everywhere, and the exhaustive
   per-type/per-payload table (11 rows, verified against `ui.ts:5155-5433` and
   `bridge.ts:208-228`) is now part of the design contract rather than deferred
   to the plan.
3. **Lossless matcher semantics — CONFIRMED, adopted.** Adapters declare
   `hostPatterns: RegExp[]` with anchors/optional-www (`twitter.ts:307`), and
   `detectPlatform()` is first-registered-match (`platform-registry.ts:39-58`) —
   a glob grammar would be lossy. The manifest now stores each regex verbatim as
   `{ source, flags }`, manifest order replicates today's import order, a build
   assertion enforces strict pattern equality plus baseline order, the loader
   iterates candidates defensively until registration confirms activation, and
   overlap/precedence fixtures are required.
4. **Routing cross-check — CONFIRMED, adopted.** The manifest and
   `SUPPORTED_MATCH_PATTERNS` are independent routing sources. New build
   assertion: every supported host → at least one adapter or a checked-in
   no-adapter exception; every manifest host → injectable and WAR-covered.
5. **Built platform-module contract — CONFIRMED, adopted.** The import-purity
   smoke harness now also runs per emitted platform ESM: namespace exposes
   `adapter`, `adapter.name` equals the manifest name, no import-time
   registration/side effects.
6. **Broader purity instrumentation — CONFIRMED, adopted.** The import-only
   phase now drains microtasks and observes storage reads/writes, DOM/EventTarget
   listeners, DOM mutation, timers, observers, recursive `chrome.*` proxying, and
   custom subscription hooks; factory install and disposal are verified against
   the same instruments.
7. **Recursive stats traversal — CONFIRMED, adopted.** Production module
   concatenation nests modules inside `modules[].modules`, so a top-level scan
   is insufficient. Stats are persisted with entrypoint/chunk association and
   nested-module/reason fields, and the boundary assertion traverses recursively
   (fallback: disable concatenation for the verification build).

## Round-5 review history — resolved (do not implement from this section)

> All items below were verified, adopted, and folded into the normative design
> sections above on 2026-07-11. Dispositions at the end of this section.

**Verdict:** Request changes, but no new Critical blocker is confirmed. The Round-4
dispositions resolve the import-pending failure path and most matching/verification
concerns. The remaining findings are Required contract clarifications before the
design is implementation-ready.

### Required findings

1. **Choose an implementable cold persisted-session cancellation contract.** The
   normative design says WalletConnect state/cancel messages never trigger a bundle
   load, but also requires cold cancellation to clear restorable persisted session
   state through runtime cleanup. A genuinely cold tab has no runtime to invoke.
   Current `WalletConnectBridge.cancel()` aborts pending pairing and emits idle; it
   does not disconnect an established persisted session, which has a separate
   operation.

   Choose one explicit behavior:

   - Cold cancel invalidates only the core queued generation and explicitly does not
     disconnect an established/restorable session, preserving QR-dismiss semantics;
     or
   - Cold cancel acknowledges synchronously, then fire-and-forget loads a dedicated
     cleanup runtime/storage port and invokes a specified persisted-session cleanup
     operation.

   The persisted-session cancellation test must match the selected behavior and API.

2. **Complete the core WalletConnect transition lifecycle.** The transition record
   includes `cancelled`, but `GET_STATE` defines only loading-to-initializing,
   failure-to-error, and no-record-to-idle. Specify whether `cancelled` is observable
   or maps immediately to idle; when the record is cleared after successful runtime
   handoff; how reconnect replaces the old generation; and how stale import failure
   is prevented from overwriting a newer cancellation/reconnect.

   Every cancel should invalidate the core generation before optional runtime
   cleanup, regardless of the cold/warm branch, so ownership does not change at the
   handoff boundary. Add exact state-transition assertions in addition to the
   action-level race tests.

3. **Correct the exhaustive dispatcher table's signing row.** The `Sync return`
   column must contain `false`, matching the current listener. The immediate
   `{ ok: true }` acknowledgement belongs in the success-envelope column, and the
   completion column must identify the separate correlated
   `trading:signing-response` carrying the same request `id` plus `result` or
   `error`. The prose promises a state owner for every row, but the table has no
   state-owner column; add it or remove that promise.

4. **Remove stale verification wording.** The unit-test description still uses the
   shorthand `{ status: "started" }` rather than the full
   `{ success: true, data: { status: "started" } }` envelope, and still describes
   cold WalletConnect state as exact idle shapes rather than the new core transition
   states. Update verification so it tests the same contract the normative dispatcher
   now defines.

5. **Make routing consistency mechanically enforceable.** The proposed build check
   claims universal compatibility between arbitrary adapter regex languages and
   Chrome wildcard match patterns, but those are not generally comparable. Current
   routes already contain partial overlaps: supported-host patterns permit every
   `*.stackoverflow.com` while its adapter accepts only bare/meta hosts, and permit
   every `*.slashdot.org` while its adapter accepts only bare/`www`.

   Prefer declarative per-adapter Chrome match patterns as the canonical routing
   data and generate supported-host/WAR coverage from them, with explicit extra-
   injection exceptions. Otherwise restrict matcher grammar and define a finite,
   checked coverage-fixture contract instead of claiming universal regex containment.

6. **Add a source/stats boundary for platform registration imports.** A jsdom proxy
   cannot observe a separately bundled platform entry importing its own private copy
   of `platform-registry.ts` and mutating that private registry. Assert from ESM stats
   or source boundaries that each platform entry graph excludes
   `platform-registry.ts`, `registerAdapterWithRetry`, and registration helpers.
   Run each built-module smoke test in an isolated context so module caches and
   globals cannot contaminate subsequent adapter tests.

7. **Define `adapter-only dependency` structurally.** Graph exclusivity cannot infer
   architectural intent after an adapter dependency accidentally enters the core
   graph. Define the forbidden set as manifest entry modules plus designated
   platform-only helper paths, or generate the lazy-entry dependency closure and
   subtract a checked-in explicit shared-module allowlist. The content-graph assertion
   should compare against that deterministic set.

### Positive assessment and approval condition

The core generation guard, import-failure-to-polled-error path, immediate signing
acknowledgement with correlated failure, exact started envelope in normative prose,
lossless regex source/flags representation, per-platform ESM smoke direction,
broader purity instrumentation, recursive stats traversal, compiler ownership, and
stream hydration model are coherent. Incorporate the seven Required clarifications
above into the normative design before approval and implementation planning.

### Round-5 dispositions (verified against source, 2026-07-11)

1. **Cold persisted-session cancellation — CONFIRMED, option A adopted.**
   Verified: `WalletConnectBridge.cancel()` (`walletconnect-bridge.ts:418-421`)
   only aborts the pending pairing attempt and emits idle (its comment: QR
   dismissal); disconnecting an established session is the separate
   `disconnect()` operation. Cold cancel therefore invalidates only the core
   queued generation and **explicitly does not** disconnect
   established/restorable sessions — exactly today's QR-dismiss semantics; no
   cleanup runtime is ever loaded. The persisted-session test now asserts the
   session is untouched and only pairing is aborted.
2. **Transition lifecycle completion — adopted.** `cancelled` is not a distinct
   observable state (`GET_STATE` reports idle, matching today's immediate
   idle-emit on cancel); the record clears on successful runtime handoff;
   reconnect bumps the generation and replaces the record; import handlers
   write back only if their generation is still current, so a stale failure
   never overwrites a newer cancel/reconnect. Every cancel — cold or warm —
   invalidates the core generation before optional runtime cleanup. Exact
   state-transition assertions added alongside the action-level race tests.
3. **Signing table row — CONFIRMED, corrected.** `bridge.ts:228-229` does
   `sendResponse({ ok: true }); return false;`. The row now has `false` in the
   sync-return column, the `{ ok: true }` ack in the envelope column, and the
   correlated `trading:signing-response` (same request `id` + `result`/`error`)
   in the completion column. The state-owner promise in the prose was aligned
   with the table's "default runtime, deviations noted" convention.
4. **Stale verification wording — CONFIRMED, corrected.** The per-class test
   description now uses the full
   `{ success: true, data: { status: "started" } }` envelope and tests the
   transition-record states (idle/initializing/error/cancelled-as-idle plus
   generation races) instead of the obsolete "exact idle shapes".
5. **Routing consistency — CONFIRMED, fixture contract adopted.** Verified
   partial overlap in current routes: `https://*.stackoverflow.com/*` injectable
   vs adapter `/^(?:meta\.)?stackoverflow\.com$/`; `https://*.slashdot.org/*`
   vs `/^(?:www\.)?slashdot\.org$/`. Subdomain injection without adapter
   activation is today's intended behavior, so universal regex↔match-pattern
   containment was the wrong contract. Replaced with a checked-in
   coverage-fixture file (hostname → expected adapter-or-none; ≥1 fixture per
   supported-host pattern including wildcard-subdomain cases, ≥1 per manifest
   entry) plus the decidable reachability direction (every manifest entry has
   an injectable, WAR-covered fixture host).
6. **Registration-import boundary + isolation — adopted.** A private registry
   copy inside a platform bundle is invisible to the jsdom smoke, so a
   stats/source graph assertion excludes `platform-registry.ts`,
   `registerAdapterWithRetry`, and registration helpers from every platform
   entry graph; each built-module smoke runs in an isolated context (fresh VM
   context / process) so module caches and globals cannot leak between tests.
7. **Deterministic adapter-only set — adopted.** The forbidden set is
   structural: no module under `src/content/platforms/` in the `content` entry
   graph, sole exception `platforms/manifest.json`; genuine sharing requires
   moving the module out or a checked-in shared-module allowlist entry.
