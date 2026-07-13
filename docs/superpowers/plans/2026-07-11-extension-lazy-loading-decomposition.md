# Extension Lazy Loading + Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lazy-load the trading stack and platform adapters in the content script behind explicit native-`import()` dispatchers, and decompose `sidepanel.ts` / `trading-panel.ts` / `ui.ts` into focused modules — per the approved spec `docs/superpowers/specs/2026-07-11-extension-lazy-loading-decomposition-design.md` (five resolved review rounds; the normative sections above the review-history sections are the contract).

**Architecture:** Separate webpack entry bundles (`content-trading.js`, `platforms/<name>.js`) built by a second ESM compiler config, imported at runtime via `import(/* webpackIgnore: true */ chrome.runtime.getURL(...))`. Core `content.js` keeps two dispatchers (`platform-loader`, `trading-loader`) plus a synchronously-registered portfolio-message dispatcher with a core-owned WalletConnect transition record. Decomposition follows the same seams.

**Tech Stack:** TypeScript, webpack 5 (MultiCompiler, `experiments.outputModule`), vitest, jsdom, es-module-lexer (or equivalent static ESM parsing), Chrome MV3 extension APIs.

## Global Constraints

- **NEVER run `git add` or `git commit`. The owner commits manually.** Where this plan's steps would normally commit, instead leave changes in the working tree and append one line to `.superpowers/sdd/progress.md`.
- **Behavior-preserving baseline:** code moves verbatim; observable behavior (message envelopes, timing, return values, adapter selection) must not change. Opportunistic cleanups allowed only when provably behavior-neutral (dead code deletion, dedup, type tightening, local renames). Anything that could change observable behavior needs its own test first.
- **The spec's exhaustive dispatcher table is the contract** (spec section "Trading stack lazy loading"). Error envelope is always `{ success: false, data: { error } }`. Never invent a top-level `error` field.
- **Side-effect-free import invariant:** importing `content-trading.js` or any `platforms/*.js` defines exports and does nothing else. All side effects install via `createTradingRuntime()` / core-side registration.
- **Import-boundary rule (zero exceptions):** no value imports from `src/content/trading/` or react/viem in core-bundle modules; no module under `src/content/platforms/` in the `content` graph except `platforms/manifest.json`. The loaders live at `src/content/trading-loader.ts` and `src/content/platform-loader.ts` (outside those directories).
- Gate after every task: `npx vitest run` (all green), `npx tsc --noEmit`. Additionally at the end of each phase: `pnpm run build:prod` (which runs `assert-production-bundle.mjs`).
- All commands run from `apps/extension/` unless stated otherwise.
- Dynamic imports in dispatchers MUST be written `import(/* webpackIgnore: true */ chrome.runtime.getURL("..."))`.

---

## Phase 1 — Platform adapter lazy loading

### Task 1: Adapter export convention + canonical manifest + typed wrapper

**Files:**
- Modify: all 50 self-registering adapter files in `src/content/platforms/` (list: beincrypto, bankless, bitcoinmagazine, bluesky, cnbc, blockworks, cnet, coindesk, coinmarketcap, cnn, cointelegraph, decrypt, discord, cryptopanic, dlnews, extended-community, extended-editorial, espncricinfo, forbes, extended-markets, farcaster, hackernews, hindustan-times, fox-sports, lemmy, manifold-markets, kalshi-website, linkedin, nytimes, mastodon, paragraph, producthunt, reddit, quora, slashdot, skysports, stackexchange, sporting-news, stackoverflow, tomshardware, thehindu, theblock, threads, washington-post, twitter, unchained, twitch, yahoo-finance, wsj, zdnet)
- Create: `src/content/platforms/manifest.json`
- Create: `src/content/platform-manifest.ts`
- Test: `tests/content/platform-manifest.test.ts`

**Interfaces:**
- Produces: each adapter file adds `export const adapter: PlatformAdapter = <the existing adapter object>` (the object currently passed to `registerAdapterWithRetry`). **Self-registration calls stay in place in this task** (behavior unchanged; they are removed in Task 3).
- Produces: `manifest.json` — array of `{ "file": string, "name": string, "hostPatterns": [{ "source": string, "flags": string }] }`, one entry per adapter, **in the exact order the adapters are imported in `src/content/index.ts` today**, with each regex's `source`/`flags` copied verbatim from the adapter's `hostPatterns` (e.g. twitter → `{"source":"^(www\\.)?twitter\\.com$","flags":""}`). `file` is the source-module basename from the current import and `name` must equal the adapter's `adapter.name`. These are intentionally distinct: `kalshi-website.ts` exports the behaviorally established adapter name `kalshi-platform`, so webpack emits `platforms/kalshi-platform.js` from `platforms/kalshi-website.ts` without renaming either public identity.
- Produces: `platform-manifest.ts`:
  ```ts
  import rawManifest from "./platforms/manifest.json";

  export interface PlatformManifestEntry {
    file: string;
    name: string;
    matchers: RegExp[];
  }

  export const PLATFORM_MANIFEST: PlatformManifestEntry[] = rawManifest.map(
    (entry) => ({
      file: entry.file,
      name: entry.name,
      matchers: entry.hostPatterns.map(
        (p) => new RegExp(p.source, p.flags)
      ),
    })
  );

  export function findMatchingPlatforms(hostname: string): PlatformManifestEntry[] {
    return PLATFORM_MANIFEST.filter((entry) =>
      entry.matchers.some((re) => re.test(hostname))
    );
  }
  ```
  (Enable `resolveJsonModule` in tsconfig if not already on.)

- [x] **Step 1: Write failing tests** in `tests/content/platform-manifest.test.ts`:
  - for every manifest entry, the corresponding `src/content/platforms/<entry.file>.ts` module exports `adapter` with `adapter.name === entry.name` (import the TS source directly in vitest);
  - manifest regex `source`+`flags` strictly equal the adapter's exported `hostPatterns` (compare `re.source`/`re.flags`), same count, same order;
  - manifest `file` order equals the adapter import order recorded from `src/content/index.ts` (read the file, extract `./platforms/<file>` imports in order), and both `file` and `name` are unique;
  - every `platforms/*.ts` file that exports `adapter` appears in the manifest, and helper modules (`basic-adapter.ts`, `editorial-adapter.ts`, `helpers.ts`, `story-adapter-helpers.ts`) do NOT export `adapter` and do NOT appear;
  - `findMatchingPlatforms("twitter.com")` → `["twitter"]`; `findMatchingPlatforms("meta.stackoverflow.com")` → `["stackoverflow"]`; `findMatchingPlatforms("sub.stackoverflow.com")` → `[]`; `findMatchingPlatforms("unsupported.example")` → `[]`.
- [x] **Step 2: Run tests, verify they fail** (`npx vitest run tests/content/platform-manifest.test.ts`).
- [x] **Step 3: Implement** — add `export const adapter` to each adapter file (rename the existing const if needed; keep `registerAdapterWithRetry(adapter, ...)` calls working against the same object); generate `manifest.json` by mechanical extraction; write `platform-manifest.ts`.
- [x] **Step 4: Run the new tests + full gate** (`npx vitest run`, `npx tsc --noEmit`). Expected: all green.
- [x] **Step 5:** Append ledger line to `.superpowers/sdd/progress.md`. Leave uncommitted.

### Task 2: Webpack ESM compiler config + platform entries + WAR + stats artifacts

**Files:**
- Modify: `webpack.config.cjs`
- Modify: `manifest.json` (repo root `apps/extension/manifest.json` — `web_accessible_resources` template) / the WAR-generation code in `webpack.config.cjs`, whichever emits the WAR list
- Modify: `package.json` `zip` script (exclude `.stats`)
- Test: build-level (asserted in Task 4); this task's gate is a successful dual-compilation build

**Interfaces:**
- Produces: `module.exports = (env, argv) => [classicConfig, esmConfig]`.
  - `classicConfig` = today's config unchanged (keeps `clean: true`, `CopyPlugin`), plus `name: "classic"` and a stats-writing step.
  - `esmConfig`: `name: "esm"`, `dependencies: ["classic"]`, `output: { path: dist, filename: "[name].js", module: true, library: { type: "module" }, clean: false, publicPath: "" }`, `experiments: { outputModule: true }`, `optimization: { splitChunks: false, runtimeChunk: false }`, NO CopyPlugin, same TS loader rules. Entries: every manifest adapter as `"platforms/<entry.name>": "./src/content/platforms/<entry.file>.ts"`, generated by `require("./src/content/platforms/manifest.json")` — never by globbing. (The `content-trading` entry is added in Task 10.)
  - Both configs write webpack stats JSON (via a small inline plugin using `compiler.hooks.done` → `stats.toJson({ modules: true, nestedModules: true, reasons: true, chunks: true, entrypoints: true, assets: true })`) to `dist/.stats/classic.json` and `dist/.stats/esm.json`.
- Produces: WAR list gains `"platforms/*.js"` (and later `"content-trading.js"`), same generated `matches` as today.
- `zip` script excludes `.stats/*`.

- [x] **Step 1:** Implement the config array + stats plugin + WAR addition + zip exclusion as above.
- [x] **Step 2:** Run `pnpm run build:dev`. Expected: `dist/platforms/*.js` exist (50 files), `dist/.stats/{classic,esm}.json` exist, all classic assets still present (content.js, background.js, sidepanel.js, options.js, offscreen.js, page-bridge.js, manifest.json, fonts, wasm).
- [x] **Step 3:** Run `pnpm run build:prod`. Expected: succeeds end-to-end from a clean `dist` (this proves the clean/copy ownership: ESM compiler must not delete classic output).
- [x] **Step 4:** Full gate (`npx vitest run`, `npx tsc --noEmit`).
- [x] **Step 5:** Ledger line; leave uncommitted.

### Task 3: Platform loader dispatcher + core-side registration + index.ts swap

**Files:**
- Create: `src/content/platform-loader.ts`
- Modify: `src/content/index.ts` (delete the ~50 `./platforms/*` imports)
- Modify: `src/content/main.ts` (await the loader before feed scanning starts)
- Modify: all 50 adapter files (remove `registerAdapterWithRetry(...)` calls and the `platform-registry` import — adapters now only `export const adapter`)
- Test: `tests/content/platform-loader.test.ts`

**Interfaces:**
- Consumes: `findMatchingPlatforms` (Task 1), `KNOWW_PLATFORM.registerPlatform` + `detectPlatform` from `platform-registry.ts`.
- Produces:
  ```ts
  // src/content/platform-loader.ts
  import { findMatchingPlatforms } from "./platform-manifest";
  import { KNOWW_PLATFORM } from "./platform-registry";

  type ImportPlatformModule = (name: string) => Promise<{ adapter?: unknown }>;

  const defaultImport: ImportPlatformModule = (name) =>
    import(
      /* webpackIgnore: true */ chrome.runtime.getURL(`platforms/${name}.js`)
    );

  // importModule is injectable for tests only.
  export async function loadPlatformAdapter(
    url: URL,
    importModule: ImportPlatformModule = defaultImport
  ): Promise<boolean> {
    const candidates = findMatchingPlatforms(url.hostname);
    for (const entry of candidates) {
      const mod = await importModule(entry.name).catch(() => null);
      const adapter = mod?.adapter;
      if (!adapter) continue;
      KNOWW_PLATFORM.registerPlatform(adapter as never);
      // Defensive backstop: confirm the registry actually selected an adapter
      // for this hostname; iterate to the next candidate if not.
      if (KNOWW_PLATFORM.detectPlatform()) return true;
    }
    return false;
  }
  ```
- `main.ts`: at its startup entry point, before the first feed scan / injection observer starts, insert `await loadPlatformAdapter(new URL(window.location.href));` (make the enclosing startup function async if needed; preserve everything else in order). If `main.ts` startup is not already async-capable, wrap the existing start call: load the adapter first, then start.
- Adapters: delete `registerAdapterWithRetry` calls + their import. Nothing else changes in adapter files.

- [x] **Step 1: Write failing tests** in `tests/content/platform-loader.test.ts` (inject `importModule` stub; stub `KNOWW_PLATFORM`):
  - picks and registers `twitter` for `https://twitter.com/home`; returns `true`;
  - returns `false` for an unsupported host, importing nothing;
  - candidate iteration: if the first matching module lacks `adapter` or registry detection stays null, continues to the next candidate;
  - a rejected import of one candidate does not abort iteration.
- [x] **Step 2:** Run tests, verify failure.
- [x] **Step 3:** Implement loader; strip adapter self-registration; swap `index.ts` imports; wire `main.ts`.
- [x] **Step 4:** Full gate + `pnpm run build:dev`. Structural check: `grep -c "platforms/" src/content/index.ts` → 0.
- [x] **Step 5:** Ledger line; leave uncommitted.

### Task 4: Build assertions — manifest exactness, fixtures, graph purity

**Files:**
- Modify: `scripts/assert-production-bundle.mjs`
- Modify: `src/content/platforms/manifest.json`, `src/content/platforms/stackexchange.ts`, `tests/content/platform-manifest.test.ts` (remove the deliberately disabled, unreachable Stack Exchange adapter from the lazy-entry convention while retaining its legacy named source export dormant)
- Create: `src/content/platforms/routing-fixtures.json`
- Create: `scripts/lib/stats-graph.mjs` (recursive stats traversal helper)

**Interfaces:**
- Produces `scripts/lib/stats-graph.mjs`:
  ```js
  // Recursively walk stats modules (incl. concatenated `modules[].modules`)
  // and return the flat set of source-module identifiers per entrypoint/chunk.
  export function collectEntryModules(statsJson, entryName) { /* recurse */ }
  ```
- Produces `routing-fixtures.json`: `[{ "host": "twitter.com", "expect": "twitter" }, { "host": "sub.stackoverflow.com", "expect": "none" }, ...]` — ≥1 fixture per supported-host pattern in `SUPPORTED_MATCH_PATTERNS` (a subdomain fixture wherever the pattern is wildcarded), ≥1 per manifest entry. Derive expectations from the CURRENT adapter regexes (behavior baseline, e.g. stackoverflow subdomains → `"none"`, `meta.stackoverflow.com` → `"stackoverflow"`).
- Reachability correction: all Stack Exchange/SuperUser/ServerFault/AskUbuntu/MathOverflow/Stack Apps routes are intentionally commented out in `SUPPORTED_MATCH_PATTERNS`, so the `stackexchange` adapter cannot satisfy the mandatory injectable-fixture gate. Remove only its canonical `adapter` export and manifest record; retain `StackExchangeAdapter` as a dormant legacy named export. The enabled standalone `stackoverflow` adapter is unchanged. The active lazy set is therefore 49 entries until Stack Exchange support is deliberately re-enabled.
- New assertions in `assert-production-bundle.mjs` (all fail the build loudly):
  1. emitted `dist/platforms/*.js` === manifest names exactly (both directions);
  2. WAR in built `dist/manifest.json` covers `platforms/*.js`;
  3. every fixture host evaluated against manifest regexes yields `expect`;
  4. every manifest entry has ≥1 fixture host that is injectable (matches a supported-host pattern; simple hostname-vs-pattern check against the built manifest's content-script/WAR matches);
  5. platform-entry graph purity: via `collectEntryModules(esmStats, "platforms/<name>")`, no entry graph contains `platform-registry.ts`, `registerAdapterWithRetry`, or `platform-loader.ts`;
  6. content-graph forbidden set: via `collectEntryModules(classicStats, "content")`, no module path under `src/content/platforms/` except `platforms/manifest.json`;
  7. clean-build coexistence: all expected classic assets + all lazy assets exist together;
  8. ESM one-asset-per-entry: the esm stats' asset list contains exactly the declared entries (no extra `.js`).

- [x] **Step 1:** Implement helper + fixtures + assertions.
- [x] **Step 2:** `pnpm run build:prod`. Expected: passes. Then sanity-check enforcement: temporarily add a bogus manifest entry, expect the build to FAIL, revert.
- [x] **Step 3:** Full gate; ledger line; leave uncommitted.

### Task 5: Per-platform built-ESM smoke harness (isolated contexts)

**Files:**
- Create: `scripts/smoke-esm-modules.mjs`
- Modify: `package.json` (`build:prod` chain: `... && node scripts/assert-production-bundle.mjs && node scripts/smoke-esm-modules.mjs`)

**Interfaces:**
- For each manifest entry: in a **fresh child process (or `node:vm` SourceTextModule context)** with jsdom globals and a recursively-proxied `chrome` stub that records every access/call, `await import(pathToFileURL("dist/platforms/<name>.js"))`, drain microtasks (`await new Promise(setImmediate)` twice), then assert: namespace exposes `adapter`; `adapter.name === entry.name`; instrument log is empty (no chrome calls, listeners, storage, timers, observers, DOM mutations — instrument `setTimeout`/`setInterval`/`MutationObserver`/`addEventListener` on window+document before import).

- [x] **Step 1:** Implement harness (per-module isolation is mandatory — no shared module cache between adapters).
- [x] **Step 2:** `pnpm run build:prod`. Expected: all 49 enabled/reachable manifest adapters pass (the disabled dormant Stack Exchange source emits no entry). If any emitted adapter has import-time side effects, fix that adapter (move the work behind functions) — invariant, no exceptions.
- [x] **Step 3:** Full gate; ledger line; **Phase 1 gate:** `pnpm run build:prod` green end-to-end. Leave uncommitted.

---

## Phase 2 — Trading stack lazy loading

### Task 6: Move pure stream-bet calculations to core

**Files:**
- Create: `src/content/ui/stream-bet-calc.ts`
- Modify: `src/content/trading/stream-bet-logic.ts` (remove moved functions; re-point its internal users)
- Modify: `src/content/ui.ts` imports; any other importers (`grep -rn "stream-bet-logic" src tests`)
- Test: existing `tests/content/stream-bet-structure.test.ts` (re-point paths); move/keep unit tests green

**Interfaces:**
- Produces: `ui/stream-bet-calc.ts` exporting the dependency-free calculations currently in `stream-bet-logic.ts`: `pickHolding`, `clampStake`, `stepStake`, `resolvePrimarySportsMoneyline`, `formatHoldingLine`, `parseStreamStakeInput`, `canSellHolding`, `sellButtonLabel`, `type StreamHolding`, and any other function in the file with no imports from trading modules (rule: a function moves iff its transitive in-file dependencies are also pure). Functions that touch `TradingService`/bridge/session stay in `trading/stream-bet-logic.ts`.

- [x] **Step 1:** Enumerate the file's exports and classify pure vs trading-dependent; move pure set verbatim; update all importers.
- [x] **Step 2:** Full gate. Structural check: `grep -n "stream-bet-logic" src/content/ui.ts` → no matches.
- [x] **Step 3:** Ledger line; leave uncommitted.

### Task 7: Decompose ui.ts into src/content/ui/ (static split, no laziness yet)

**Files:**
- Create: `src/content/ui/cards.ts`, `src/content/ui/notifications.ts`, `src/content/ui/stream-bet-ui.ts`, `src/content/ui/trading-glue.ts`, `src/content/ui/index.ts`
- Modify: `src/content/ui.ts` → becomes `export * from "./ui"` shim OR importers re-pointed and file deleted (prefer delete + re-point; `index.ts` side-effect import `./ui` → `./ui/index`)
- Test: existing suite; structural test updates where they `readSource("src/content/ui.ts")`

**Interfaces:**
- Placement rule (verbatim moves): market-card creation/render → `cards.ts`; notification stack + its message handlers (`KNOWW_OPEN_EXTENSION`, visibility, snapshot, search, focus) + draggable stack → `notifications.ts`; stream companion-card UI → `stream-bet-ui.ts`; **everything that value-imports trading modules** (the portfolio message listener block `ui.ts:5145-5433`, `WalletBridge.init()` call, `connectAndAuthorizePortfolioWallet`, order placement/balance polling, setup-gate rendering, WalletConnect QR usage, `TradingService.onStateChange` wiring) → `trading-glue.ts`; `index.ts` re-exports the public surface and preserves today's module-initialization side effects in the same order.
- After this task `trading-glue.ts` still imports trading statically — bundle composition unchanged, all 440+ tests green. Laziness lands in Tasks 8-10.

- [x] **Step 1:** Split; keep every function verbatim; update importers (`injection.ts`, `main.ts`, `streaming/*`, tests).
- [x] **Step 2:** Full gate + `pnpm run build:prod`.
- [x] **Step 3:** Structural assertions: only `trading-glue.ts` under `src/content/ui/` imports from `../trading/`; add this as a unit test (grep-based) in `tests/content/ui-structure.test.ts`.
- [x] **Step 4:** Ledger line; leave uncommitted.

### Task 8: TradingRuntime facade + trading-entry + factory-installed side effects

**Files:**
- Create: `src/content/trading-runtime-types.ts` (core-safe: types only, NO value imports from trading)
- Create: `src/content/trading/trading-entry.ts`
- Modify: `src/content/trading/trading-service.ts` (extract module-scope listener block at lines ~1291-1308 into an exported `installTradingServiceListeners(): () => void` returning an uninstaller; module scope registers NOTHING)
- Modify: `src/content/trading/bridge.ts` (extract the signing `onMessage` listener from `WalletBridge.init()` into an exported handler `handleSigningRequest(message, sendResponse): boolean` + `installSigningListener(): () => void`; `init()` keeps its other work and its `initialized` guard but no longer adds the onMessage listener itself)
- Modify: `src/content/ui/trading-glue.ts` (its handlers become methods/functions collected into the runtime object; still statically imported this task)
- Test: `tests/content/trading-entry.test.ts`

**Interfaces:**
- `trading-runtime-types.ts`:
  ```ts
  export interface TradingRuntime {
    // panel + widgets
    openTradingPanel(...args: PanelOpenArgs): void;
    hydrateStreamBet(host: HTMLElement, ctxArgs: StreamBetHydrateArgs): StreamBetHandle;
    // dispatcher delegation — one handler per spec-table row semantics
    handlePortfolioMessage(message: unknown, sendResponse: (r: unknown) => void): boolean;
    getWalletConnectStateSync(): { status: string; error: string | null; qrSvg: string | null };
    cancelWalletConnect(): Promise<void>;
    cancelWalletConnectSync(): void; // temporary legacy-handler compatibility
    handleSigningRequest(message: unknown): boolean;
    dispose(): void;
  }
  export interface StreamBetHandle { dispose(): void; }
  // PanelOpenArgs / StreamBetHydrateArgs: typed from current call sites in ui/
  ```
  (Exact arg types transcribed from current call sites — implementer derives them from `trading-glue.ts` usage; they are type-only in core.)
- `trading-entry.ts`: **imports only inside the factory's reach; module scope defines and exports `createTradingRuntime(): TradingRuntime` and `export type { TradingRuntime }` — nothing else executes on import.** The factory calls `WalletBridge.init()`, `installTradingServiceListeners()`, and the non-listener `installSigningLifecycle()` (exactly-once guards), builds the runtime object from `trading-glue` handlers, and `dispose()` uninstalls everything installed. The core dispatcher remains the only `chrome.runtime.onMessage` owner for signing requests; the standalone `installSigningListener()` stays only as a compatibility/test helper and is not installed by the runtime factory.

- [x] **Step 1: Failing tests:** module-scope purity of `trading-service.ts` (import it in vitest with instrumented chrome stub → zero `onMessage.addListener` calls); `createTradingRuntime()` installs listeners exactly once even if called twice→ second call returns same runtime or throws (choose: returns cached singleton); `dispose()` removes them.
- [x] **Step 2:** Verify failure; implement.
- [x] **Step 3:** IMPORTANT behavior guard: content boot must still install listeners eagerly THIS task (laziness not yet wired) — `ui/index.ts` calls `createTradingRuntime()` at the exact former `initializeTradingGlue()` point, and the entry imports the glue handlers. This preserves today's eager behavior while avoiding a `trading-entry.ts` ↔ `trading-glue.ts` factory cycle.
- [x] **Step 4:** Full gate; ledger line; leave uncommitted.

### Task 9: trading-loader + warm flag + portfolio-message dispatcher + WC transition record

**Files:**
- Create: `src/content/trading-loader.ts`
- Create: `src/content/ui/portfolio-message-dispatcher.ts`
- Modify: `src/background.ts` (warm-flag writers)
- Modify: `src/content/ui/trading-glue.ts` / `index.ts` (dispatcher registered synchronously at boot INSTEAD of the direct listener; runtime still eagerly created this task so semantics stay identical while the dispatcher contract is proven)
- Test: `tests/content/trading-loader.test.ts`, `tests/content/portfolio-message-dispatcher.test.ts`, `tests/background/warm-flag.test.ts`

**Interfaces:**
- `trading-loader.ts`:
  ```ts
  import type { TradingRuntime } from "./trading-runtime-types";

  type ImportEntry = () => Promise<{ createTradingRuntime(): TradingRuntime }>;
  const defaultImport: ImportEntry = () =>
    import(/* webpackIgnore: true */ chrome.runtime.getURL("content-trading.js"));

  let inflight: Promise<TradingRuntime> | null = null;
  let loaded: TradingRuntime | null = null;

  export function loadTradingRuntime(importEntry: ImportEntry = defaultImport): Promise<TradingRuntime> {
    if (loaded) return Promise.resolve(loaded);
    if (!inflight) {
      inflight = importEntry()
        .then((mod) => { loaded = mod.createTradingRuntime(); return loaded; })
        .catch((err) => { inflight = null; throw err; });
    }
    return inflight;
  }
  export function getLoadedRuntime(): TradingRuntime | null { return loaded; }

  // Task 9 only: synchronously adopt the already-created eager runtime so the
  // dispatcher exercises the loader contract without importing the future chunk.
  export function adoptLoadedTradingRuntime(runtime: TradingRuntime): TradingRuntime;

  const WARM_FLAG_KEY = "knowwTradingWarmEligible";
  export function prefetchTradingRuntime(): void {
    void chrome.storage.local.get(WARM_FLAG_KEY).then((r) => {
      if (r?.[WARM_FLAG_KEY] === true) void loadTradingRuntime().catch(() => {});
    });
  }
  ```
- Background warm flag: in `background.ts`, set `{ knowwTradingWarmEligible: true }` where trading credentials are stored / setup completes, and clear it in the session-disconnect handling (every logout origin flows through the background). Locate: credential-store handler and the `TRADING_SESSION_DISCONNECTED_MESSAGE` broadcast/disconnect path.
- `ui/index.ts` creates the Task-8 eager runtime, immediately calls `adoptLoadedTradingRuntime(runtime)`, then registers the single combined notification-first runtime listener. Task 9 does not dynamically import `content-trading.js`; the eager call is removed only in Task 10.
- `portfolio-message-dispatcher.ts` — implements **exactly the spec's exhaustive table** (copy the table into the file header comment). Registered synchronously at content boot. It is the only listener owner for all portfolio and `trading:signing-request` rows and owns the WC transition record:
  ```ts
  interface WcTransitionRecord {
    generation: number;
    status: "loading" | "error" | "cancelled";
    error: string | null;
  }
  ```
  Behavior per class (see spec table for the full row list):
  - respond-on-completion rows: `return true`, `loadTradingRuntime().then(rt => rt.handlePortfolioMessage(...))`, load failure → `sendResponse({ success:false, data:{ error } })`;
  - started-ack rows (`KNOWW_ENABLE_PORTFOLIO_TRADING`, WC branch of `KNOWW_CONNECT_PORTFOLIO_WALLET`): `sendResponse({ success:true, data:{ status:"started" } })` synchronously, `return false`, then fire-and-forget: WC branch writes `{generation:g, status:"loading"}` first; after load, handler proceeds ONLY if the record's generation is still `g` and not cancelled; import failure writes `{status:"error", error}` if generation still current;
  - synchronous state rows: `return false` always and never load. `GET_STATE` checks the core record **before** a warm runtime: `loading` ⇒ `{status:"initializing",error:null,qrSvg:null}`, `error` ⇒ `{status:"error",error,qrSvg:null}`, `cancelled` ⇒ `{status:"idle",error:null,qrSvg:null}`; only with no record does it delegate to `getLoadedRuntime()?.getWalletConnectStateSync()`, otherwise returning exact idle. Every `CANCEL` first bumps the generation and writes `cancelled`, then acks `{success:true,data:{status:"cancelled"}}` synchronously. If a runtime is already warm, it calls observable `cancelWalletConnect(): Promise<void>` without loading: a successful current-generation cleanup may clear the record only after the composed barrier for all earlier outstanding cleanups has settled; any current cleanup rejection keeps cancelled-as-idle authoritative. The pinned UniversalProvider 2.23.10 `abortPairingAttempt()` is a no-op and `cleanupPendingPairings()` does not prove the approval stopped, so the bridge must quarantine reconnects: capture the old connect promise, bump its generation, perform best-effort pairing cleanup, then await that captured attempt—including any topic-scoped stale-session cleanup—before clearing only the captured promise and resolving cancel/reconnect. Multiple abort callers await the same captured attempt. A failed stale-topic disconnect leaves a shared retry descriptor containing the exact provider/session/topic; the next abort retries that descriptor, and may ignore the old `StaleSessionCleanupError`/clear the captured promise only after the descriptor clears successfully. A missing topic remains quarantined. If approval never settles, cancelled/loading core state remains authoritative rather than permitting a corrupt concurrent pairing. Cold cancel never loads or disconnects an established/persisted session, and its cancelled record may remain until reconnect;
  - reconnect after warm cancellation replaces the cancelled record with a newer `loading` generation and acks immediately, but retains a composed barrier covering **every outstanding cancellation cleanup** and awaits all of them (success or rejection) before invoking the runtime connect handler, then rechecks generation/status. This barrier prevents any stale provider cleanup from aborting the new pairing; stale cleanup can never clear or overwrite the newer record. Every async connect success exit is generation-guarded; a provider session produced by a superseded connect is identity/topic-checked and closed only through `provider.client.disconnect({ topic: staleTopic, reason })`—never provider-wide `provider.disconnect()`—then rejected without publishing connected/error state. Topic-scoped cleanup must not clear generic provider state, so a newer session that becomes current while stale cleanup is pending survives;
  - signing row: sync `sendResponse({ ok:true }); return false;` then load; failure → `chrome.runtime.sendMessage({ type:"trading:signing-response", id, error })`;
  - **every cancel (cold or warm) bumps the core generation before any runtime delegation**.

- [x] **Step 1: Failing tests** — loader: single in-flight promise across concurrent callers (stub importEntry, count calls =1); failure clears cache and retry succeeds; `getLoadedRuntime()` null→instance; same-runtime adoption is idempotent and conflicting/in-flight adoption rejects. Warm flag: gate fires only on exact `true` (stub storage); background sets/clears at each origin (structural/unit against the handlers). Dispatcher: one test per spec-table row + the transition-record lifecycle assertions (loading→handoff-cleared, loading→error, loading→cancelled-as-idle, cancelled→reconnect(new generation), stale failure ignored) + races (cancel-during-import: queued connect never invokes runtime connect; warm cancellation retains core precedence until successful cleanup; cleanup rejection stays idle; reconnect waits for prior cleanup; stale cleanup cannot clear reconnect; import-rejection-then-poll reports error; cold established-session cancel performs no load/disconnect). Signing tests assert immediate ack, correlated load failure, runtime delegation, and no second listener.
- [x] **Step 2:** Verify failure; implement.
- [x] **Step 3:** Full gate; ledger line; leave uncommitted.

### Task 10: Flip the switch — content-trading entry, dynamic intents, prefetch, hydration

**Files:**
- Modify: `webpack.config.cjs` (ESM config gains `"content-trading": "./src/content/trading/trading-entry.ts"`), WAR gains `content-trading.js`
- Modify: `src/content/ui/index.ts`, `stream-bet-ui.ts`, `cards.ts` (replace static `trading-glue`/trading imports with loader intents; `import type` stays)
- Modify: `src/content/ui/trading-glue.ts` moves under the trading graph (imported only by `trading-entry.ts`)
- Modify: `src/content/main.ts` (after first cards inject: `requestIdleCallback(() => prefetchTradingRuntime())`)
- Test: update `tests/content/ui-structure.test.ts` boundary assertions

**Interfaces:**
- Intent wrappers own UI lifecycle (spec "Async-intent lifecycle"): each trading trigger disables itself, `await loadTradingRuntime()`, re-checks its card/panel is still mounted, then calls the runtime; on failure restores the trigger + shows that surface's existing error treatment; loader owns only the cache.
- Stream-bet: on **companion-card mount** (streaming surfaces), call `loadTradingRuntime().then(rt => rt.hydrateStreamBet(host, args))`, keep the handle, `handle.dispose()` on card teardown; pre-hydration the card renders the core placeholder using `stream-bet-calc` pure helpers only.
- The eager `createTradingRuntime()` call from Tasks 8-9 is REMOVED — from this task, the runtime exists only via the loader (dispatcher messages, intents, hydration, prefetch).

- [x] **Step 1:** Wire everything; delete remaining static trading value imports from core `ui/` modules.
- [x] **Step 2:** Full gate + `pnpm run build:prod`. Expected: `dist/content-trading.js` emitted; boundary tests green.
- [x] **Step 3:** Tests for hydration transition + teardown (placeholder → hydrated on mount, `onStateChange` unsubscribed on dispose — structural + unit with stubbed runtime).
- [x] **Step 4:** Ledger line; leave uncommitted.

### Task 11: Import-purity smoke + boundary/byte assertions for the trading bundle

**Files:**
- Modify: `scripts/smoke-esm-modules.mjs` (add content-trading two-phase run)
- Modify: `scripts/assert-production-bundle.mjs`
- Modify: `tests/content/ui-structure.test.ts` (source-level import ban)

**Interfaces:**
- Smoke two-phase for `dist/content-trading.js` (isolated context, full instrument set from the spec: recursive chrome proxy, storage r/w, window/document/EventTarget listeners, DOM mutation, timers, observers, subscription hooks; drain microtasks): phase 1 import → zero observations + namespace exposes exactly `createTradingRuntime` (+ types erased); phase 2 `createTradingRuntime()` → exactly one install per handler, prove the sole Chrome callback is the service listener rather than the signing listener, and observe exactly one bridge-to-service account subscription; idempotent `dispose()` → exact callbacks/listener subscription removed once.
- Bundle assertions: static export-name parse of `content-trading.js`; recursive stats check — `content` entry graph contains no module from `src/content/trading/`, no `react`/`react-dom`/`react-qr-code`/`viem` package modules; ESM compilation still one-asset-per-entry (now content-trading + 49 enabled platform entries); exactly one canonical WAR entry owns both `content-trading.js` and `platforms/*.js` and its matches exactly equal normalized supported origins; `content.js` byte budget — measure the built size now, set budget = measured + 10% headroom, assert.
- Source test: TypeScript-AST scan permits no value imports, value re-exports, CommonJS requires, or dynamic imports from `src/content/trading/` or react/viem anywhere in core-graph sources (`src/content/**` minus `trading/` and `platforms/`). Type-only dependencies are allowed; unresolved require/import fails closed. The only dynamic-import exceptions are AST/token-validated contracts for the exact `trading-loader.ts` and `platform-loader.ts` paths: literal resource contents must match and the magic comment text must be exactly `/* webpackIgnore: true */`; formatter trivia outside tokens/comments is ignored.
- QR import-purity correction: keep React/React DOM/react-qr-code in the same trading asset but use literal webpack `require(...)` calls only inside the two explicit synchronous QR render functions. React DOM's import-time feature probes otherwise violate phase-1 zero-observation purity; dynamic `import()` would break the one-asset and synchronous-state contracts.

- [x] **Step 1:** Implement; run `pnpm run build:prod` — record the measured `content.js` size in the assertion file comment and the ledger (expect well under half of the 1.44 MB baseline).
- [x] **Step 2:** Full gate; ledger line; **Phase 2 gate:** build:prod green. Leave uncommitted.

---

## Phase 3 — Trading panel decomposition (inside the trading bundle)

### Task 12: Extract panel-state + format + setup-view

**Files:**
- Create: `src/content/trading/panel/panel-state.ts`, `src/content/trading/panel/format.ts`, `src/content/trading/panel/setup-view.ts`
- Modify: `src/content/trading/trading-panel.ts`
- Test: existing suite + `trading-panel-ux.test.ts` path updates

Verbatim moves: module-level mutable state at the top of `trading-panel.ts` → `panel-state.ts` (exported lets or a state object — keep reference semantics: prefer an exported object holding the fields to avoid live-binding pitfalls); pure display helpers → `format.ts`; guided-setup/approval rendering → `setup-view.ts`.

- [x] Steps: move → full gate → structural test updates → ledger line; leave uncommitted.

### Task 13: Extract order-view + positions-view + deposit-view

**Files:**
- Create: `src/content/trading/panel/order-view.ts`, `positions-view.ts`, `deposit-view.ts`
- Modify: `src/content/trading/trading-panel.ts`

Verbatim moves: order form render/submit → `order-view.ts`; holdings/positions rendering → `positions-view.ts`; deposit flow rendering incl. funding-controller wiring (exactly as sub-project 1 left it — `depositController`, `syncDepositControllerAccount`, inline deposit host) → `deposit-view.ts`.

- [x] Steps: move → full gate (`trading-panel-ux.test.ts`, `stream-bet-structure.test.ts`, funding tests all green) → ledger line; leave uncommitted.

### Task 14: trading-panel.ts becomes the shell

**Files:**
- Modify: `src/content/trading/trading-panel.ts` → `TradingPanel` class/lifecycle/mount/routing only, delegating to the view modules; target well under 1,500 lines.

- [x] Steps: finish delegation → full gate + `pnpm run build:prod` (Phase 3 gate; bundle assertions still green — panel modules must all remain inside the trading graph) → ledger line; leave uncommitted.

---

## Phase 4 — Sidepanel decomposition (extension page; no laziness)

### Task 15: Extract messaging + shared + markets

**Files:**
- Create: `src/sidepanel/messaging.ts`, `src/sidepanel/shared.ts`, `src/sidepanel/markets.ts`
- Modify: `src/sidepanel.ts`

Verbatim moves: runtime-message listeners + background RPC helpers → `messaging.ts`; cross-section DOM helpers/formatters → `shared.ts`; watchlist/markets sections → `markets.ts`.

- [x] Steps: move → full gate → ledger line; leave uncommitted.

### Task 16: Extract portfolio + funding-ui + setup

**Files:**
- Create: `src/sidepanel/portfolio.ts`, `src/sidepanel/funding-ui.ts`, `src/sidepanel/setup.ts`
- Modify: `src/sidepanel.ts` → thin entry that wires the modules (target well under 1,000 lines)

Verbatim moves: balances/positions/P&L → `portfolio.ts`; deposit/withdraw UI incl. `requestWithdrawRequote`, funding-controller wiring, `readPortfolioWithdrawParams` → `funding-ui.ts`; setup wizard/banner orchestration → `setup.ts`. Funding behavior is protected by the sub-project-1 test suite — it must stay green untouched (only import paths in tests may change).

- [x] Steps: move → full gate + `pnpm run build:prod` (Phase 4 gate) → ledger line; leave uncommitted.

---

## Final: whole-branch review + handoff

- [x] Dispatch the final whole-branch code review (superpowers:requesting-code-review) over the full working-tree diff; fix Critical/Important findings; re-verify.
- [x] Record final measurements in `.superpowers/sdd/progress.md`: content.js before (1.44 MB) → after; list of emitted lazy assets; line counts of the three former giants.
- [ ] Owner manual-QA checklist (from spec "Manual QA"): Twitter cards + trade before idle + deposit; never-traded profile on a non-streaming page → no `content-trading.js` fetch; sidepanel deposit/withdraw against a fresh tab (cold dispatcher); streaming host stream-bet incl. mount-time holdings/setup state; extension-context smoke (import built module + create runtime from a page console); record before/after transfer size + parse/execute timings.
- [x] Everything stays uncommitted for owner review.
