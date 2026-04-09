<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Knoww prediction market app (Next.js 15.5 App Router). The integration covers client-side event tracking using `posthog-js` initialized via `instrumentation-client.ts` (the recommended approach for Next.js 15.3+), server-side tracking via `posthog-node`, a reverse proxy for reliable event ingestion, automatic session replay, and unhandled exception capture.

## Changes summary

**New files created:**
- `apps/web/instrumentation-client.ts` — Initializes PostHog client-side with reverse proxy, session replay, and error tracking
- `apps/web/src/lib/posthog-server.ts` — Server-side PostHog singleton using `posthog-node`

**Modified files:**
- `apps/web/next.config.ts` — Added `/ingest` reverse proxy rewrites and `skipTrailingSlashRedirect: true`
- `apps/web/src/components/navbar.tsx` — wallet_connect_clicked, wallet_disconnected (+ posthog.reset()), trading_account_setup_clicked
- `apps/web/src/components/deposit-modal.tsx` — deposit_initiated, deposit_completed
- `apps/web/src/components/trading-form.tsx` — market_order_submitted
- `apps/web/src/components/portfolio/sell-position-modal.tsx` — sell_position_submitted
- `apps/web/src/app/markets/[slug]/market-detail-client.tsx` — market_shared
- `apps/web/src/components/comments/comment-input.tsx` — comment_submitted
- `apps/web/src/app/search/page.tsx` — market_search_result_clicked
- `apps/web/src/app/api/auth/derive-api-key/route.ts` — trading_api_key_created, trading_api_key_derived (server-side, with wallet address as distinct ID)

**Environment:**
- `apps/web/.env.local` — `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST`

## Instrumented events

| Event Name | Description | File |
|---|---|---|
| `wallet_connect_clicked` | User clicks the Connect Wallet button | `apps/web/src/components/navbar.tsx` |
| `wallet_disconnected` | User disconnects their wallet (calls posthog.reset()) | `apps/web/src/components/navbar.tsx` |
| `trading_account_setup_clicked` | User clicks Setup Trading Account to begin onboarding | `apps/web/src/components/navbar.tsx` |
| `deposit_initiated` | On-chain deposit transaction confirmed | `apps/web/src/components/deposit-modal.tsx` |
| `deposit_completed` | Bridge processing complete, funds credited | `apps/web/src/components/deposit-modal.tsx` |
| `market_order_submitted` | User submits a buy or sell order via the trading form | `apps/web/src/components/trading-form.tsx` |
| `sell_position_submitted` | User executes a quick sell of a portfolio position | `apps/web/src/components/portfolio/sell-position-modal.tsx` |
| `market_shared` | User shares a market via the native share API | `apps/web/src/app/markets/[slug]/market-detail-client.tsx` |
| `comment_submitted` | User successfully posts a comment or reply | `apps/web/src/components/comments/comment-input.tsx` |
| `market_search_result_clicked` | User clicks a search result | `apps/web/src/app/search/page.tsx` |
| `trading_api_key_created` | Server: new trading API key created (first-time user) | `apps/web/src/app/api/auth/derive-api-key/route.ts` |
| `trading_api_key_derived` | Server: existing trading API key derived (returning user) | `apps/web/src/app/api/auth/derive-api-key/route.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://us.posthog.com/project/52737/dashboard/1444274
- **Trading Conversion Funnel** (wallet connect → trading account → first order): https://us.posthog.com/project/52737/insights/ohU87GS2
- **Deposit Success Funnel** (initiated → completed, churn signal): https://us.posthog.com/project/52737/insights/hbfs9vq5
- **Daily Trading Activity** (buy/sell orders and position sells): https://us.posthog.com/project/52737/insights/8itXFm2y
- **User Engagement Activity** (comments, searches, shares): https://us.posthog.com/project/52737/insights/4DF8GEEm
- **New Trader Onboarding** (new vs. returning traders): https://us.posthog.com/project/52737/insights/3rOjlDPi

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
