# Implementation Plan: Route-Level CSS Delivery

## Overview

The web app's CSS is already organized into 11 source files, but all of those
files are imported by `apps/web/src/app/globals.css`. Because `globals.css` is
imported by the root layout, Next.js treats the complete graph as shared CSS and
ships it to every route.

The production build currently exposes only two root CSS assets:

- Font CSS: 11,521 bytes decoded / 1,345 bytes gzip.
- Application CSS: 275,129 bytes decoded / 41,748 bytes gzip.

The first goal is therefore to change delivery boundaries without rewriting the
existing styles. Deeper Tailwind utility splitting is a gated follow-up only if
the first change does not reduce route CSS enough.

## Architecture Decisions

- Keep only true foundation styles in the root CSS entry: Tailwind base and
  shared utilities, `tw-animate-css`, theme primitives, global element defaults,
  and rules proven to be used by every surface.
- Preserve the existing namespaced global selectors during the first pass.
  Converting the 1,667-line tweet overlay or trading ticket to CSS Modules at the
  same time would add visual-regression risk without being required for route
  splitting.
- Load marketing, product, and feature CSS from route layouts or the component
  that owns the feature. Next.js can then emit route-specific CSS chunks.
- Use static nested layouts in each existing product route tree as the product
  CSS boundary. This preserves every public URL and avoids a broad route move in
  the same change as the delivery split.
- Leave Next.js `experimental.cssChunking` at its default `true`. The current
  problem is the root import graph, not the chunking algorithm. Use `strict`
  only if verified ordering defects appear.
- Keep one global Tailwind entry initially. Only trial multiple Tailwind entries
  using `source(none)` and explicit `@source` paths after measuring phase one.
- Verify production builds, because development CSS ordering and chunking are
  not representative of `next build`.

## Target Import Graph

```text
root layout
  -> globals.css
       -> tailwindcss
       -> tw-animate-css
       -> theme-base.css
       -> themes.css
       -> base.css
       -> truly shared tokens only

landing page / landing shell
  -> landing-route.css
       -> marketing.css
       -> landing.css
       -> tweet-overlay.css

privacy page
  -> marketing.css

product route layouts
  -> product.css
       -> markets.css
       -> ticket.css
       -> onboarding.css
```

`ticket.css` and `onboarding.css` intentionally remain in the static product
bundle. Their owning UI is dynamically imported on several routes; importing
the styles from those components would create the late CSS request this change
is designed to avoid.

## Success Metrics

- The landing route no longer downloads product, ticket, or onboarding rules.
- Product routes no longer download landing or tweet-overlay rules.
- Privacy does not download landing-only or product CSS.
- Median cold-load LCP across three Chrome DevTools runs improves from the
  current constrained baseline of about 2.33-2.37 seconds.
- Landing render-blocking CSS is reduced by at least 25% from the current
  roughly 43.1 KB gzip total; stretch target is 25 KB gzip or less.
- CLS remains at or below 0.02 on desktop and 0.01 on mobile.
- No visual regressions across supported themes or client-side route changes.

## Task List

### Phase 1: Establish Reproducible Baselines

#### Task 1: Add a route CSS inventory check

**Description:** Record the CSS assets assigned to representative routes after
`next build`, including decoded, gzip, and Brotli sizes. The check should read
Next's generated manifests and fail clearly if the root route regains feature
CSS later.

**Acceptance criteria:**

- Reports CSS assets for `/`, `/privacy`, `/markets`, and one event-detail page.
- Records raw, gzip, and Brotli sizes without adding a runtime dependency.
- The current two root CSS assets and their sizes are captured as the baseline.

**Verification:**

- Run `pnpm --filter web build`.
- Run the inventory check against `.next/app-build-manifest.json` and route
  client-reference manifests.

**Dependencies:** None.

**Estimated scope:** Small.

### Phase 2: Split Existing Custom CSS by Ownership

#### Task 2: Reduce `globals.css` to foundation styles

**Description:** Remove all marketing-, product-, ticket-, and onboarding-only
imports from the root entry. Audit `app-tokens.css` rule by rule and move only
genuinely shared tokens into the foundation entry.

**Acceptance criteria:**

- `globals.css` contains only foundation imports.
- No landing, tweet-overlay, markets, ticket, or onboarding selectors remain in
  the root CSS output.
- Root theme and base behavior remains unchanged on every representative page.

**Verification:**

- Build succeeds.
- CSS inventory confirms feature selectors are absent from the root asset.
- Desktop and mobile screenshots match the pre-change baseline.

**Dependencies:** Task 1.

**Estimated scope:** Medium.

#### Task 3: Create the marketing delivery boundary

**Description:** Import `marketing.css` only on marketing/legal surfaces,
`landing.css` only for the homepage, and `tweet-overlay.css` from the tweet
overlay feature entry. Keep import order deterministic in a single entry per
surface.

**Acceptance criteria:**

- `/` receives marketing, landing, and tweet-overlay styles.
- `/privacy` receives marketing styles but not landing or tweet-overlay styles.
- Product routes receive none of these files on a cold direct load.

**Verification:**

- Inspect route CSS assets after a production build.
- Check `/` and `/privacy` across light, dark, and one alternate theme.
- Test client navigation `/` -> `/privacy` -> `/` for persistent-style conflicts.

**Dependencies:** Task 2.

**Estimated scope:** Medium.

#### Task 4: Create the product route boundary

**Description:** Add static nested layouts to the existing product route trees
and import one shared product stylesheet from each layout. Do not move route
folders or change the provider graph in this CSS-only slice.

**Acceptance criteria:**

- Existing public URLs and metadata remain unchanged.
- Product CSS is absent from the homepage module graph on a direct load.
- Product routes retain theme, wallet, toaster, navigation, and data behavior.

**Verification:**

- Run route, type, and build tests.
- Smoke-test `/markets`, an event detail, `/live`, `/leaderboard`, `/portfolio`,
  `/profile`, `/search`, `/sports`, `/whales`, and `/agent`.
- Confirm the landing route loses the product CSS and provider chunks.

**Dependencies:** Tasks 1 and 2.

**Estimated scope:** Medium per route batch; implement in two batches rather
than one large move.

#### Task 5: Keep dynamic-feature CSS statically available

**Description:** Include `ticket.css` and `onboarding.css` in `product.css` so
dynamically imported trading and wallet UI never renders ahead of its styles.

**Acceptance criteria:**

- Landing and privacy routes do not download ticket or onboarding CSS.
- Event-detail trading and onboarding flows remain fully styled.
- Import order is stable across direct load and client navigation.

**Verification:**

- Inspect CSS assets for `/markets` and event detail and confirm they share the
  same static product asset.
- Exercise market/limit, buy/sell, wallet onboarding, error, disabled, and
  responsive states.

**Dependencies:** Task 4.

**Estimated scope:** Small.

### Checkpoint: Custom CSS Split

- Run formatter, linter, typecheck, tests, and production build.
- Compare per-route CSS sizes to Task 1.
- Run three cold Chrome DevTools traces on desktop and mobile and compare median
  LCP, CLS, render-blocking duration, and long tasks.
- Stop here if the landing route meets the 25% reduction target and performance
  has adequate headroom.

### Phase 3: Gated Tailwind Utility Split

**Decision:** No-go for this change. The shared Tailwind output is now the
largest CSS layer, but creating multiple generators would duplicate framework
layers or require explicit source allowlists. That risk is not justified until
real production HTTP/2 or HTTP/3 measurements show the remaining CSS is the
next bottleneck.

#### Task 6: Measure Tailwind's remaining share

**Description:** Determine how much of each route's CSS is Tailwind-generated
after custom CSS has been split. Do not create multiple Tailwind entries unless
the shared utility output is still the dominant render-blocking cost.

**Acceptance criteria:**

- Separates framework-generated bytes from custom stylesheet bytes.
- Documents which utility classes are exclusive to marketing or product code.
- Produces a go/no-go decision for Task 7.

**Verification:** Production CSS analysis plus Chrome coverage on representative
routes.

**Dependencies:** Tasks 3-5.

**Estimated scope:** Small.

#### Task 7: Trial explicit Tailwind source boundaries

**Description:** In an isolated change, trial Tailwind 4 multiple stylesheet
support using `@import "tailwindcss" source(none)` and explicit `@source` paths
for shared, marketing, and product code. Reject the trial if duplicated preflight
or theme output offsets the route savings.

**Acceptance criteria:**

- No missing utilities or dynamically constructed class regressions.
- No duplicate preflight/theme blocks on a route.
- Total route CSS falls by at least another 20% versus the phase-two result.
- CSS ordering remains correct across client navigation.

**Verification:** Full build, CSS inventory, visual regression matrix, and three
cold performance traces per viewport.

**Dependencies:** Task 6 and an explicit go decision.

**Estimated scope:** Medium.

### Phase 4: Guardrails

#### Task 8: Enforce route CSS budgets

**Description:** Add the inventory check to CI with budgets derived from the
accepted post-split measurements.

**Acceptance criteria:**

- CI fails when the root route imports product CSS or exceeds its gzip budget.
- Budgets exist for landing, privacy, browse, and event-detail route classes.
- Failure output names the regressed asset and size delta.

**Verification:** Prove the check fails with a temporary local over-budget asset,
then restore it and confirm CI passes.

**Dependencies:** Final accepted implementation from Phase 2 or Phase 3.

**Estimated scope:** Small.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Global CSS persists after client navigation | Cross-surface style conflicts | Keep namespace prefixes, test both navigation directions, and avoid generic selectors outside foundation CSS. |
| Adding many nested CSS boundaries misses a product route | Unstyled direct load | Cover every product layout in the static ownership test and production manifest report. |
| Tailwind explicit sources omit dynamic utilities | Missing production styles | Run source audit, retain complete static class strings, and gate the experiment behind broad visual checks. |
| Multiple Tailwind entries duplicate preflight/theme CSS | Larger payload | Measure total per-route bytes and reject Task 7 unless it clears the 20% improvement threshold. |
| CSS order changes between development and production | Theme or specificity regressions | Verify `next build`; keep one import entry per surface and leave default CSS chunking enabled. |
| Font variables remain globally preloaded | CSS split improves but critical chain stays long | Route-scope marketing and product fonts in a separate measured follow-up after the CSS boundary is stable. |

## References

- Next.js CSS guidance: https://nextjs.org/docs/app/getting-started/css
- Next.js CSS chunking: https://nextjs.org/docs/app/api-reference/config/next-config-js/cssChunking
- Tailwind source detection: https://tailwindcss.com/docs/detecting-classes-in-source-files
