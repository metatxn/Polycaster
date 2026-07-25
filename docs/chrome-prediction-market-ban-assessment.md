# Chrome Web Store Prediction-Market Ban — Impact Assessment (Knoww Extension)

**Date:** 2026-07-24
**Author:** Assessment prepared for the Knoww extension team
**Status:** Action required before 2026-08-01

---

## 1. The policy

On **July 1, 2026**, Google updated its Chrome Web Store *Regulated Goods and Services* policy to explicitly prohibit prediction-market tools. Key language:

> "Extensions that facilitate or enable real money transactions on predictive outcomes are not allowed."

- **Enforcement begins:** **August 1, 2026.** Non-compliant extensions face **removal from the store** (new installs and updates blocked; existing installs may linger but can no longer be updated through CWS).
- **Not banned:** prediction markets themselves, or read-only display of prediction data. Google shows the same Polymarket/Kalshi data on Google Finance (integrated Nov 2025).
- **Safe harbor:** *simulated* products with **no cash prize** are allowed **if** they clearly disclose that users cannot win real money.
- Applies to Chromium/CWS distribution. Edge (Chromium, CWS-derived catalog) mirrors these policies. Firefox/AMO has separate rules.

**Sources:**
- https://coinpaper.com/32877/google-sets-aug-1-ban-on-chrome-extensions-for-prediction-markets
- https://crypto.news/google-bans-chrome-prediction-market-extensions/
- https://coingape.com/google-to-ban-prediction-market-extensions-amid-increased-scrutiny-of-polymarket-kalshi/
- https://gamingamerica.com/news/1086766/google-bans-prediction-market-extensions-while-showing-their-data-on-google-finance
- (Original article, blocked to automated fetch: https://beincrypto.com/google-chrome-bans-prediction-market-extensions/)

---

## 2. Verdict for Knoww: direct, high-severity hit

The current CWS build is **non-compliant as-is**. This is not a borderline call — real-money prediction-market trading is the extension's headline feature.

| Policy trigger | Knoww evidence |
|---|---|
| "predictive outcomes" | Manifest name *"Knoww — Every opinion is a position"*, description *"A prediction market layer for the open internet"* (`apps/extension/manifest.json:3-5`) |
| "facilitate real money transactions" | Live Polymarket CLOB order placement — market (FAK/FOK) + limit (GTC/GTD) via `handlePlaceOrder` → `client.postOrder` (`apps/extension/src/background/trading-handler.ts:360`) |
| "real money" on-chain | USDC.e/pUSD deposits, withdrawals, approvals, CTF split/merge, relayer transactions (`apps/extension/src/background/portfolio-funds.ts:361`, `apps/extension/src/background/relayer-client.ts:312`) |
| No safe-harbor carve-out | **No** play-money/simulated mode exists. Search for `simulat/paper-trade/play-money/demo` returned zero hits. All trades hit live CLOB with real USDC.e/pUSD. |

### Aggravating factors
- **The manifest metadata self-identifies.** "Prediction market layer" in the description is an instant flag — a reviewer does not even need to run the extension.
- **Chrome Web Store is the only distribution channel.** No Firefox/AMO target, no self-hosted CRX, no `update_url`. Chromium-only, manual ZIP upload. There is no fallback channel already in place.

### Evidence of distribution/packaging
- CWS is the primary channel: a dedicated submission doc exists (`apps/extension/CHROME_WEB_STORE_PRIVACY_PRACTICES.md`).
- Packaging is a manual ZIP (`package.json` `zip`/`release` scripts → `knoww-extension.zip`), uploaded by hand. No automated store-publishing CI.
- Chromium-only: uses `offscreen`, `sidePanel`, `service_worker` (`manifest.json:21,23,29`); `@types/chrome`; no `browser_specific_settings`/Firefox target.

---

## 3. What is NOT affected

- **The web app at knoww.app (`apps/web`)** — it is a website, not a Chrome extension. This policy does not touch it. Trading can live there.
- **Read-only market discovery** — surfacing relevant Polymarket/Kalshi markets, AI relevance, odds/P&L display. Google explicitly does not ban showing prediction data. This part of Knoww is compliant.

---

## 4. Chosen approach: build-time compliance flag (two ZIPs)

**Decision:** Introduce a build-time env var that produces a **store-safe ZIP** (no trading) alongside the **full-trading ZIP**. Keep the entire trading codebase intact in the repo — do not delete it.

Store-safe build behavior:
- Wallet connect **allowed** — read-only, to display portfolio info and trading history.
- Trading panel: **excluded**.
- Deposit / withdraw buttons: **excluded**.
- Portfolio/history display: **kept** (read-only data display is compliant).

This is the correct trade and preserves the trading work. But the implementation detail below is make-or-break.

### 4.1 CRITICAL: "hide" ≠ compliant — must strip at compile time

If the flag only **hides UI** while `handlePlaceOrder`/`postOrder`, `executePortfolioDeposit`/`executePortfolioWithdraw`, the relayer client, and `eth_sendTransaction` **still ship inside the ZIP**, the store build is **still non-compliant**:

- CWS review and automated scanners inspect the **shipped code**, not the rendered UI. The policy says "facilitate or enable" — if the capability is in the bundle and message routes (`trading:place-order`, `KNOWW_PORTFOLIO_DEPOSIT`) are still wired in the service worker, the extension still *enables* real-money trades.
- A hidden panel is trivially re-enableable (flip a flag in devtools), which reviewers treat as circumvention.

**The flag must physically remove trading/money-movement code from the store bundle at compile time — not hide it at runtime.**

### 4.2 Implementation conditions (all required)

1. **Gate at the import boundary, not the render call.** Use webpack `DefinePlugin` to inject a compile-time constant (e.g. `__STORE_BUILD__ = true`). Structure code so the whole trading module graph becomes unreachable under that constant, letting dead-code elimination drop:
   - `src/content/trading/*`
   - `src/background/trading-handler.ts`, `portfolio-funds.ts`, `relayer-client.ts`
   - the offscreen signer (`src/offscreen/*`)
   - Pitfall: `if (__STORE_BUILD__) hide()` while still `import`-ing the panel keeps the code in the bundle. Gate the imports.

2. **Extend `scripts/assert-production-bundle.mjs` to FAIL the store build** if the emitted bundle contains any of: `postOrder`, `eth_sendTransaction`, `executePortfolioDeposit`, `executePortfolioWithdraw`, `relayer`, `createMarketOrder`. This is the single most important guardrail — it turns "did I actually strip it?" into a build-time guarantee.

3. **Trim `host_permissions` in the store build.** Drop `clob.polymarket.com` and `relayer-v2.polymarket.com` (order-placement + on-chain-write endpoints). Keep read-only: `gamma-api.polymarket.com`, `data-api.polymarket.com`, `api.elections.kalshi.com`, and the Polygon RPC **for `eth_call` balance reads only**. A store build requesting the CLOB *order* endpoint while claiming no trading is a self-contradiction reviewers catch.

4. **Soften manifest metadata for the store build.** The name *"Every opinion is a position"* and description *"A prediction market layer for the open internet"* are instant flags. Swap to discovery-flavored copy (e.g. "Discover prediction markets relevant to what you're reading") via the env var.

5. **Ensure "connect wallet" in the store build can only read.** If wallet-connect still exposes the signing/`eth_sendTransaction` bridge, the capability is present even with no button. Read-only means balance/position reads with no reachable signing path.

### 4.3 Distribution reality for the full-trading ZIP

The full-trading ZIP **cannot live on the Chrome Web Store at all** — not under a second listing, not anywhere. It becomes a **sideload / self-hosted CRX** channel:
- Users install manually; Chrome nags about non-store extensions; zero store discovery.
- Fine as a power-user channel, but be clear-eyed: the full version loses CWS distribution entirely.
- The env-var approach does not change this — it makes the *store* build compliant. Real trading routes to sideload and/or knoww.app.

---

## 5. Options considered

- **Option A — Split build (CHOSEN):** store build = discovery + read-only portfolio; trading stripped at compile time; full build sideload-only / hand off to knoww.app. Preserves code, keeps CWS presence, keeps trading available elsewhere.
- **Option B — Self-host full-trading extension only:** preserves functionality but craters distribution (manual install, no discovery). Power-user channel at best.
- **Option C — Do nothing:** delisting on Aug 1. Not viable (CWS is the sole channel).

---

## 6. Next steps

1. Wire `DefinePlugin` compile-time constant + import-boundary gating so trading graph is tree-shakeable out of the store build.
2. Extend `assert-production-bundle.mjs` with the forbidden-symbol check for the store build.
3. Parameterize `host_permissions` and manifest name/description by build flag.
4. Verify the store ZIP contains none of the trading/money-movement symbols; verify wallet-connect read-only path.
5. Decide the distribution home for the full-trading build (sideload channel and/or knoww.app hand-off).

**Timeline:** enforcement is **2026-08-01** (~1 week from this assessment). Treat as urgent.
