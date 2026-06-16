# Browser AI Test Cases

Use this as a page-wise checklist for an AI tester running through Chrome DevTools MCP or Playwright MCP.

## How To Use This File

- Confirm the base URL with the operator before starting (production is `https://knoww.app`; local dev is typically `http://localhost:8000`). Note which environment you are in — some checks are environment-dependent (for example `/agent` is intentionally `404` in production).
- Work page by page. For each page, run the Global Browser Checks and the Typography section first, then the page-specific bullets.
- Never perform real-money actions: do not submit live trades, deposits, withdrawals, or order cancellations against production with a funded wallet. Stop at the final confirmation step and verify the UI state instead, unless the operator explicitly provides a test wallet and approval.
- Report each finding with: page URL, viewport, theme, steps to reproduce, expected vs actual, severity (blocker / major / minor / cosmetic), and console/network evidence. Screenshot visual findings.
- Distinguish hard failures (crashes, data corruption, secret leaks, broken flows) from soft findings (CLS, contrast, copy issues); never mark a page passed while a hard failure is open.

The actual market route is `/markets`, not `/market`. If `/market` exists in a deployment, test it as a legacy/unknown route separately.

## Global Browser Checks

- Run each major page at `390x844`, `768x1024`, `1440x900`, and `1920x1080`.
- Capture browser console output; fail on active `console.log`, uncaught errors, hydration mismatches, blocked critical assets, and repeated warnings.
- Capture network responses; fail on unexpected `4xx` or `5xx` responses for page-critical requests.
- For API failures shown in the UI, verify the response and visible error do not expose stack traces, raw SQL, tokens, private keys, provider secrets, or internal paths.
- Measure Core Web Vitals: CLS should stay `<= 0.1`; record LCP element and timing; watch for long tasks over `50ms`.
- Measure CLS after first load, after scrolling, after opening dropdowns/modals, after tab switches, and after infinite-scroll appends.
- Verify no unintended horizontal page scroll. Tables and ledgers may scroll only inside their own container.
- Verify text does not overlap, truncate incoherently, or escape buttons/cards on mobile and desktop.
- Verify keyboard behavior: Tab order, visible focus, Escape closes popovers/modals, Enter/Space activates row buttons.
- Verify back/forward navigation preserves reasonable state and does not leave stale dropdowns/modals open.
- Verify light and dark themes at minimum for contrast, icons, hover states, and disabled states.
- Verify mobile bottom navigation does not cover page CTAs, final rows, loading sentinels, or modal content.
- Fetch the raw HTML of each major page with curl or JavaScript disabled; verify the body contains real SSR content, not an empty client-only shell. Never validate SSR from the live DOM.
- Verify responses include the security headers (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Strict-Transport-Security`) and the console shows no CSP violation messages for fonts, images, scripts, or websocket connections.
- Block analytics requests (`/ingest/*` PostHog rewrites, Cloudflare Insights) to simulate ad blockers; verify pages still function with no uncaught errors.
- Clear and corrupt localStorage values (theme, recent searches, recently viewed) before load; verify no page crashes and sane defaults apply.
- Verify pages that read query params handle malformed or malicious values (for example `?fund=foo`, `?shares=-5`, `?shares=abc`, `?outcome=<script>`) without crashing, mis-rendering, or executing injected content.
- Go offline mid-session and back online; verify data surfaces recover (refetch or reconnect) without requiring a full reload and without console error floods.
- Verify `prefers-reduced-motion` disables or reduces ticker, marquee, and animated-section motion.
- Verify layout at `200%` browser zoom: no clipped controls, unreachable CTAs, or overlapping text on key pages.
- Verify trailing-slash URL variants (for example `/markets/`, `/leaderboard/`) render or redirect cleanly; trailing-slash normalization is disabled (`skipTrailingSlashRedirect`), so these must be tested explicitly.

## Typography, Readability, And Visual Hierarchy

These rules apply on app screens (every page except the landing page, which carries a `.kw-landing` marker and is exempt from the micro-label floor).

- Sweep computed styles on visible text: no rendered text below `12px` computed font-size on app screens. Uppercase micro-labels authored at `8px-11px` must compute to `12px` (the global readability layer must be active); flag any element where it is not.
- Verify uppercase labels use letter-spacing of approximately `0.08em` and do not render cramped or overlapping at mobile widths.
- Verify muted micro-labels (timestamps, table headers, badge text) render with the boosted muted color and effective opacity of at least `0.9`; tiny gray-on-gray text is a failure.
- Verify WCAG AA contrast in both themes: at least `4.5:1` for body text and at least `3:1` for large text and essential icons. Check muted text, disabled states, placeholder text, and text over images/gradients.
- Verify heading hierarchy per page: exactly one `h1`, no skipped heading levels, and visual size order matches semantic order (page title > section heading > card title > label).
- Verify fonts are self-hosted via `next/font` (no external font CDN requests), no flash-of-unstyled-text layout shift on load, and a readable system fallback renders if fonts fail to load.
- Verify italic editorial serif (Fraunces) appears only on hero titles and narrative empty states; functional UI (tables, buttons, labels, stats, forms) must stay upright sans/mono. Italic in a data table, button, or form label is a failure.
- Verify prices, volumes, percentages, and P&L in tables/ledgers use monospace or tabular figures so digit columns align and values do not shift width during live updates.
- Verify numeric columns are consistently aligned (right or decimal-aligned) within each table; mixed alignment in one column is a failure.
- Verify P&L sign convention: positive values render green without a `+` prefix; negative values keep `-` and render in the loss color. Flag any `+` prefix on gains.
- Verify long market titles truncate with ellipsis or line clamp and stay identifiable; mid-word overflow, clipped descenders, or titles escaping their card are failures.
- Verify long-form prose (privacy/legal) keeps a comfortable reading measure (around `68ch` max width, around `15px` size, relaxed line-height); full-viewport-width paragraphs are a failure.
- Verify links inside prose are distinguishable by underline or weight, not color alone.
- Verify primary actions are visually dominant over secondary ones (for example Buy/Sell or submit vs cancel), and selected tab/filter states are distinguishable by more than color alone.
- Verify interactive controls on mobile (row buttons, steppers, copy icons, close buttons) have a hit area of at least `40px`; icon-only buttons must have an accessible name.
- Verify line-height on multi-line body text is at least `1.4`; single-spaced dense paragraphs on mobile are a failure.
- Verify empty states, loading labels, and error text use sentence-readable copy, not raw enum/key strings such as `ERR_FETCH_FAILED` or `undefined`.
- Verify no text renders as `NaN`, `null`, `undefined`, `Invalid Date`, or unformatted epoch/wei values anywhere in the UI.

## /markets

- Load desktop, tablet, and mobile. Verify no blank state, hydration errors, console errors, or failed critical requests.
- Verify mobile cards render image, title, outcomes, volume, liquidity, live/final/hot badges, and market count without overlap.
- Verify desktop terminal/table view renders utility row, top-of-book cards, table headers, and market rows.
- Verify desktop table columns stay aligned with long titles, missing images, missing volume, missing liquidity, and sparse outcome data.
- Click a market card/row and verify navigation to `/events/detail/{slug}`.
- Scroll to the bottom; infinite scroll should append cards/rows without duplicate items, large CLS, or scroll jump.
- While loading more, verify skeleton geometry matches final card/table geometry.
- Switch tabs: All, Trending, Breaking, New. Verify selected state, content changes, and no stale results.
- Reload after tab switching; verify expected persisted view behavior via URL/session state.
- Use filters: Created/End, Liquidity, Status, Tags, Volume. Verify dropdown open/close, selected labels, applied data, and Clear reset.
- Switch tabs and filters rapidly under network throttling; verify out-of-order responses never overwrite the latest selection's results.
- Search with one character; verify no premature result dropdown. Search with two or more characters; verify debounce/loading/results.
- Search no-results term; verify empty state.
- Click a search result; verify local storage recent market is updated and navigation works.
- Press Escape and click outside search/filter popovers; verify they close.
- Verify API error state displays sanitized text and never stack traces.

## /events/detail/[slug]

- Open a valid detail page from `/markets`; verify SSR content appears before dynamic widgets finish loading.
- Open an invalid slug; verify clean 404/not-found state and no stack trace.
- Test Back behavior from direct load and from prior navigation.
- Verify title, image/fallback, volume, liquidity, days left, open/settled counts, share menu, copy behavior, live/final badges, and negative-risk badge where applicable.
- Verify chart lazy load, skeleton, time-range buttons, Both toggle where applicable, and no CLS when chart loads.
- Expand/collapse `All Outcomes`; mobile should start collapsed and desktop expanded.
- Sort outcomes by probability/change where available; verify direction toggles and row order changes.
- Expand an outcome row; verify position, order book, graph, history, top holders, and resolution tabs where available.
- Scroll order book and top-holders table; live updates should not yank the scroll position.
- Verify order book states: loading, empty, invalid token, disconnected/reconnecting, retry, asks/bids/spread display.
- Verify comments sorting: latest, oldest, most liked. Toggle holders-only and clear filters.
- Test trading form states: disconnected wallet, setup trading account, no liquidity, insufficient balance, minimum order, invalid token, market order, limit order, buy, sell, Yes, No, shares stepper, Max, partial fill, and expiration.
- Open with query params such as `?side=SELL&shares=10&outcome=yes&conditionId=...`; verify correct market/outcome preselect and sell state.
- Open with invalid query param values (`?shares=abc`, `?outcome=banana`, unknown `conditionId`); verify graceful fallback to defaults without crashes.
- Open an extremely long slug and a URL-encoded slug; verify clean handling without layout breakage or server errors.
- Verify extreme price/probability formatting: outcomes below `1%` and above `99%`, `$0` volume, and very large volume values render without rounding to misleading values or overflowing layout.
- Verify a market ending within `24` hours and an already-ended market show correct time-left/ended labels.
- Disconnect the wallet while the trading form has a pending state; verify the form resets to disconnected state without console errors.
- Verify mobile trading flow does not get hidden behind bottom navigation.

## /events/[tag]

- Open representative tags such as `/events/politics`, `/events/crypto`, `/events/finance`, and `/events/pop-culture`.
- Open mixed-case or non-canonical tag slugs; verify redirect to canonical slug.
- Open sport legacy tags such as `/events/cricket`; verify redirect to `/events/sports/cricket`.
- Verify tag hero, count, scoped market search, filters, grid cards, skeletons, empty state, and footer.
- Verify Tags filter is hidden on tag pages while other filters still work.
- Scroll infinite grid; verify appended cards, no duplicates, no CLS spikes, and correct end message.
- Click Explore All Markets in empty state; verify navigation to `/markets`.

## /events/sports/live

- Verify `/live`, `/sports/live`, and `/events/sports` permanently redirect to `/events/sports/live`.
- Verify live feed status shows Live, Reconnecting, or Offline correctly.
- Click Reconnect; verify loading state and no duplicate websocket subscriptions.
- If no live events exist, verify `No Live Events` empty state and scheduled fallback section.
- If live events exist, verify scores, game status, league grouping, live badges, and market prices.
- Use desktop league rail; verify sticky behavior, active state, and no content overlap.
- Use mobile league picker; verify open/close and route navigation.
- Search scoped sports markets.
- Select a price/market; desktop trade panel opens with selected outcome.
- Select a price/market on mobile; bottom trade bar appears, can be dismissed, and Trade link opens the detail page.
- Scroll long sportsbook lists; verify no horizontal page scroll and no card overlap.
- Verify live score/price updates do not trigger large CLS or scroll jumps.

## /events/sports/[sport]

- Open valid sport/league slugs such as cricket, tennis, nba, nfl, or another known route.
- Open uppercase/mixed-case sport slug; verify lowercase canonical redirect.
- Open invalid sport slug; verify clean 404.
- Verify league rail active state on desktop and mobile.
- Verify scoped search uses the selected sport/league label.
- Verify sportsbook loading, empty, scheduled, and market-selection states.
- Verify comments section appears for sport series pages where applicable.

## /portfolio

- Disconnected state: verify only wallet-connect prompt, product hero, and footer render; no portfolio tables should error.
- Click Connect wallet; verify loading text and wallet modal trigger.
- Connected state: verify utility row, proxy/cash balance, stats card, P&L card, tabs, search, and refresh.
- Open `/portfolio?fund=deposit`; verify deposit modal opens and `fund` query param is stripped.
- Open `/portfolio?fund=withdraw`; verify withdraw modal opens and `fund` query param is stripped.
- Open `/portfolio?fund=unknown`; verify no modal opens and no crash.
- Disconnect the wallet while a deposit/withdraw modal is open or a transaction is pending; verify clean reset to disconnected state without stuck spinners or console errors.
- Positions tab: search, profit/loss filter, sort by market/value/P&L, market link, Sell button, mobile stacked layout, empty state.
- Orders tab: search, cancel action loading state, scoring badge tooltip, filled meter, expiration, market link, empty state.
- History tab: search, external explorer links, lost-position close action, loading and empty states.
- Deposit modal: wallet vs bridge method, token loading, empty wallet state, unsupported token disabled, below-minimum token disabled, bridge search, amount input, percentage/Max controls, minimum validation, back button, copy address, confirmation, failure, pending, on-chain confirmed, bridge waiting, complete, and auto-close.
- Withdraw modal: default recipient, EVM address validation, Solana address validation, amount validation, below minimum, insufficient balance, percentage buttons, Max, token dropdown, chain dropdown, direct route, bridge route, quote loading, large-withdrawal warning, high-impact warning, submit disabled states, success state, and explorer link.
- Sell position modal: position details, shares stepper, Max, over-size prevention, estimate/proceeds, liquidity/slippage warning, Quick Sell, Modify Order route with `side`, `shares`, `outcome`, and `conditionId`.
- Close deposit/withdraw/sell modals during pending refresh timers; verify no console errors after close.

## /leaderboard

- Verify initial SSR-seeded Overall / Today / P&L table.
- Switch categories: Overall, Politics, Sports, Crypto, Finance, Tech, Culture, Economics, Weather, Mentions.
- Switch Period and Rank By dropdowns; verify selected state and URL params.
- Verify URL updates do not scroll the page to top unexpectedly.
- Infinite scroll should append `25`-row pages, dedupe traders, show Loading more, then End of leaderboard.
- Desktop table: rank, trader, avatar, verified badge, volume, P&L, social link.
- Mobile list: rank, avatar, trader, volume, P&L, social link without overlap.
- Click a row; verify navigation to `/profile/{proxyWallet}`.
- Use Enter/Space on focused row; verify keyboard navigation.
- Click copy address; verify tooltip changes to Copied and row navigation does not fire.
- Click X/social link; verify external tab and row navigation does not fire.
- Refresh button shows fetching state; error state has Try again and sanitized text.

## /profile/[address]

- Navigate from leaderboard row; verify trader profile loads.
- Verify copy address, X link, Polygonscan link, stats, rankings, related links, footer.
- Open invalid or empty `0x...` address; verify clean 404 with Back to Leaderboard.
- Refresh button shows fetching state and updated-age label changes.
- Verify positive and negative P&L colors.
- Verify mobile stat grid, rankings, and related links do not overflow.

## /search

- Open `/search`; verify input autofocus and empty state.
- Open `/search?q=bitcoin`; verify input initializes from query.
- Type one character; verify no search results request/state.
- Type two or more characters; verify `300ms` debounce, loading skeleton, and results.
- Test no-results query; verify clean empty state.
- Verify category results render count and navigate to `/events/{tag}`.
- Verify market results render image/fallback, title, top outcome, volume, liquidity, live/hot badges, and navigate to detail page.
- Click market result; verify recent search and recently viewed market localStorage update.
- Recent searches: add, dedupe case-insensitively, cap at `5`, click to refill query, remove one.
- Recently viewed markets: cap at `4`, survive reload, click navigates.
- Corrupt recent-search or recent-market localStorage values; verify page does not crash.
- Clear button empties query and restores focus.

## /whales

- Whale Activity tab: verify hero, live/offline status, refresh, filters, pull numbers, pressure chart, whale ledger, hot markets, and activity ledger.
- Switch time window and min trade size; verify refetch/loading behavior.
- Switch whale type filter: all, big-bet, directional/available types; verify ledger results.
- Use wallet/name search; verify whale ledger and activity ledger both filter.
- Sort whale ledger columns; verify direction toggles.
- Sort activity ledger by time, price, and amount.
- Activity ledger virtual scroll: scroll to middle and end; verify no blank gaps, row recycling, stable row heights, and links still work.
- Click a hot market; verify activity ledger filters by market and clear chip restores all trades.
- Toggle side filter: All, Buy, Sell.
- Insider Detection tab: verify lazy loading starts only after tab switch.
- Insider sensitivity and sort dropdowns should update results.
- Expand insider rows; verify factor breakdown, risk chips, and no layout overlap.
- Verify loading states: `Fetching whale tape...` and `Scanning for suspicious activity...`.
- Verify empty states show when filters remove all rows.

## /whales/backtest

- Verify controls clamp values: Markets `5-60`, Min Score `0-100`, Min Trade `$0-$10000`.
- Run button disables while running and shows loading text.
- Simulate or observe API success; verify headline stats, per-archetype section, precision metrics, and top traders render.
- Simulate or observe API failure; verify `Backtest failed` without stack trace.
- Verify result tables on mobile do not cause page-level horizontal overflow.
- Verify Back/Whales breadcrumb returns to `/whales`.

## /agent

- In production builds, `/agent` and `/api/agent/*` must return `404` indistinguishable from a non-existent route (middleware gating). Run the remaining checks against non-production builds only.
- Load without admin token; status/error should be clean and should not leak secrets.
- Verify admin token input is `password` type and token never appears in visible DOM text or console logs.
- Refresh, Run, run single item, archive/reactivate item; verify loading states.
- Add watchlist item with URL, question, token ID, condition ID, slug, outcome label, dates, resolution source, news URLs, and social notes.
- Verify form reset after save and sanitized error on failure.
- Runs table row selection loads run detail.
- Expand evidence, related markets, search diagnostics, provider debug, live orders, positions, and calibration.
- Long IDs, idempotency keys, hashes, and error text should wrap without breaking layout.
- Verify live execution badges: dry-run, live, emergency stop, missing wallet/credential states where applicable.

## /

- Verify first viewport shows Knoww branding, primary CTA, Chrome Store CTA, and `/markets` link.
- Verify CTA links and external Chrome Store link behavior.
- Verify anchor nav scrolls to sections and does not hide headings under the header.
- Verify theme dropdown works and persists.
- Verify hero/tweet overlay renders on intended viewport sizes and does not cause CLS.
- Verify ticker and animated sections do not trigger continuous layout shifts.
- Verify all landing sections render: Problem, Solution, Extension, How, Agent, Why Now, Use Cases, Traction, Final CTA.
- Verify footer links and external links use new tab behavior where expected.

## /privacy

- Verify header, Back to home, theme dropdown, hero, last updated date, section count, and reading time.
- Verify desktop sticky table of contents.
- Verify section anchor links scroll to the correct headings.
- Verify mobile layout has no horizontal overflow and no sticky TOC overlap.
- Verify long legal text, lists, and external links render cleanly.
- Verify all privacy sections render from Overview through Contact.

## Legacy And Redirect Routes

- `/markets/anything` redirects to `/markets`.
- `/live` redirects to `/events/sports/live`.
- `/sports/live` redirects to `/events/sports/live`.
- `/events/sports` redirects to `/events/sports/live`.
- Sport legacy tag routes under `/events/{sport}` redirect to `/events/sports/{sport}`.
- `www.knoww.app` requests `301`-redirect to the canonical `knoww.app` host, preserving path and query.
- `/robots.txt` and `/sitemap.xml` return `200` with sane content and reference the canonical host.
- Unknown app routes should show the expected Next/app 404, not a broken shell.

## Suggested Playwright/DevTools Instrumentation

- Attach listeners for `console`, `pageerror`, `requestfailed`, and non-OK `response` events.
- Start tracing or DevTools performance recording for the first load and one long-scroll pass per page.
- Use a `PerformanceObserver` for `layout-shift` and fail if cumulative unexpected CLS exceeds `0.1`.
- Record LCP element and timing with browser performance entries.
- Test with JavaScript enabled normally; optionally run one smoke pass with slow `3G`/CPU throttling for loading and skeleton behavior.
- Mock API errors for important pages to verify sanitized error UI.
- Mock empty datasets for `/markets`, tag pages, `/leaderboard`, `/portfolio`, `/whales`, and `/search`.
- On long lists/tables, verify the page scroll position and inner scroll container position before and after live updates.
- Fetch each major page over plain HTTP (curl or `request` context) and assert non-empty SSR body markup plus expected security headers; do not rely on the hydrated DOM for these assertions.
- Run one pass with localStorage cleared and one with corrupted values for known keys (theme, recent searches, recently viewed markets).
- Run one pass with `/ingest/*` and third-party analytics requests blocked to simulate ad blockers.
- Emulate `prefers-reduced-motion` and `prefers-color-scheme` to cover motion and theme media-query branches.
- Abort in-flight API requests by navigating away mid-load; verify no unhandled promise rejections or setState-after-unmount warnings in the console.
- Run a computed-style sweep per page: walk visible text nodes with `getComputedStyle`, and report any element with font-size below `12px` (app screens only, skip `.kw-landing` pages), line-height below `1.2` on multi-line text, or effective opacity below `0.9` on informational text.
- Run an automated accessibility/contrast pass (axe or equivalent) per page in both themes; report contrast violations, missing accessible names on icon-only buttons, and heading-order violations.
- Grep rendered page text for `NaN`, `null`, `undefined`, `Invalid Date`, `[object Object]`, and raw template placeholders such as `{{` before and after live data updates.
