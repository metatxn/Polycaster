# Product analytics, version 2

Connected web and extension events use the EOA wallet address as the PostHog
distinct ID and `wallet_address` property. Both use viem's `getAddress` checksum
format. The trading wallet or funder address is not the user identity.
Anonymous extension activity uses a random ID. `$identify` links that activity
when the wallet connects. Switching wallets or disconnecting rotates the
anonymous identity so two wallet owners are not merged. A wallet is not proof
of a unique human. Historical anonymous events are not backfilled by this change.

## Order lifecycle

| Event | Evidence required |
| --- | --- |
| `trade_button_clicked` | User clicked the trading form or quick-sell button. |
| `order_attempted` | The order service began the operation. |
| `order_accepted` | The exchange returned an accepted order ID. |
| `order_failed` | A pre-submission failure or an explicit exchange rejection. |
| `order_submission_unknown` | Submission returned no authoritative outcome. |
| `trade_fill_confirmed` | An associated trade is `CONFIRMED`, has a transaction hash, and belongs to the exact order. |
| `order_partially_filled` | Confirmed shares increased but remain below the original order size. |
| `order_filled`, `order_succeeded` | Confirmed shares cover the full original order size. These are two names for one milestone; do not add their counts. |
| `sell_succeeded` | The fully confirmed order was a SELL. |
| `trade_fill_failed` | The exchange marked an associated trade `FAILED`. |

Acceptance, a changed balance, elapsed time, and `MATCHED` trade status do not
prove settlement. Volume charts sum `trade_fill_confirmed.filled_value`, computed
with Decimal.js. Partial-fill totals are cumulative and must not be summed.
The browser and ingestion API map `$insert_id` to a stable PostHog event UUID.
Retries reuse that UUID by wallet, order, trade, and event as appropriate.

Pending orders are stored locally for up to 90 days. Web reconciles every 30
seconds while an authenticated trading hook is mounted. The full extension
reconciles on a one-minute browser alarm. Both use credentials-only exchange
reads and must not request a wallet signature. Missing credentials or unavailable
order history leave outcomes unconfirmed. This is client-observed reporting,
not an always-on server settlement feed. Clearing local storage can lose pending
observations. Browser opt-out prevents collection and clears pending tracking
on the next reconciliation.

## Other major actions

- Wallet connection and switching use the same identity on web and extension.
- API-key requests, creation or derivation, and failures are separate events.
- Trading-wallet creation excludes `alreadyDeployed` results. Finding an existing
  wallet is readiness, not acquisition. The acquisition tiles count wallet owners
  who created a trading wallet through Knoww. They do not claim those people are
  new to Polymarket.
- Approval, split, merge, cancellation, and web redemption have lifecycle events.
  Cancellation success requires the requested ID in the exchange's cancelled list.
- `polymarket_opened_via_knoww` records requested navigation, not a loaded page.
- `extension_web_handoff_opened` marks extension-to-web navigation with
  `utm_source=knoww_extension` and a random `handoff_id`. Web emits
  `extension_web_handoff_received` when that page loads. The extension adds
  these parameters only when usage analytics is enabled. Wallet addresses
  and credentials are never added to URLs.

## Journey correlation

Web keeps handoff attribution in session storage for 30 minutes. Reloading the
same handoff URL does not renew that window, including after it expires.
An expired ID remains in that tab to prevent renewal until the tab closes or
another handoff replaces it. Opt-out clears attribution. Accepted orders copy
the attribution into their local observation record, so a delayed fill cannot
be credited to a newer handoff. This measures attributed activity, not causation.

`wallet_session_ready` includes restored web wallet sessions. It does not
replace `wallet_connected`, which remains a new connection. The
`trading_setup_state` snapshot records observed account, approval, credential,
and setup readiness on both products. Existing accounts can be ready without
emitting `trading_account_created`. Pending checks are not confirmed failures.
`wallet_provider_check_completed` currently checks the Knoww wallet session;
it does not establish which wallet extensions are installed.

Extension discovery uses `page_view_id` plus `marketId` to match an injection
to a click within 30 minutes. The page-view ID rotates on URL changes; this
context does not send the URL. `market_card_impression` currently means a card
was injected, not that it entered the viewport. Search submission, response,
and result click share a `search_id`. Failed requests are recorded even when
their UI result is stale. Search text is not sent to analytics.

Browser web events and API-key success events carry `environment=production`
only for `knoww.app` or `www.knoww.app`. Other hosts carry `development`.
Extension events use the existing build-time development flag. The batch
ingestion endpoint preserves that tag. Production dashboards require both
`environment=production` and `analytics_version=2`.

The store extension is a discovery product. It supports wallet connection and
web handoff, but does not include trading, API-key derivation, token approval,
split, merge, cancellation, or redemption. The full extension has no redemption
action at present. Its absence must not be displayed as a failed conversion.

## Web ingestion proxy

The browser SDK uses `https://a.knoww.app`, Knoww's managed PostHog proxy.
An unset `NEXT_PUBLIC_POSTHOG_HOST` or the previous `https://us.i.posthog.com`
value selects this proxy. Other valid absolute host overrides are preserved.
The SDK's `ui_host` stays `https://us.posthog.com`, and its existing defaults,
project token, event properties, and identity behavior are unchanged.
The content security policy permits SDK assets from `https://a.knoww.app`.

Rebuild and deploy the web app to apply this change. Then check that browser
event requests use the proxy and events arrive in PostHog. The extension still
sends through Knoww's `/api/analytics/batch`; server ingestion is unchanged.
The proxy processes analytics traffic, including wallet addresses, through
Cloudflare. It does not replace consent or analytics opt-out controls.

## Dashboards and rollout

- [Web dashboard](https://us.posthog.com/project/585396/dashboard/2047913)
- [Extension dashboard](https://us.posthog.com/project/585396/dashboard/2047915)

Product classification now uses explicit tags instead of inferring the product
from missing `platform` properties. The store activation funnel is install,
market impression, then web handoff. Trading funnels accept returning wallets
and do not require another deployment. Corrected outcome charts require
`analytics_version = 2` so legacy submission-based success events cannot inflate
the new totals. Acquisition tiles and lifecycle definitions are saved in PostHog.

The September 5 dashboard review updated 47 existing insights and added 11.
They occupy 26 web tiles and 35 extension tiles because three insights are
shared. SQL charts use `{filters}` so the dashboard date selector applies.
Configured PostHog test-account exclusions are enabled. This does not create
an internal-wallet exclusion list; project owners must maintain those rules.
The quality tile intentionally includes legacy and development events to
show rollout gaps.

Full-fill percentage and order-outcome tables count distinct accepted orders.
Acceptance and outcome must both be observed in the selected date range.
Recent or unobserved outcomes can lower these rates; they are not settled
lifetime cohorts. Person-level setup funnels do not prove that every step
belongs to the same order. Time-to-order tiles measure time after a wallet
connection, not time to a person's first-ever trade.

See [dashboard coverage](posthog-dashboard-coverage.md) for the event map and
new insight links.

Deploy the web ingestion change before releasing the new extension. The old
ingestion schema only accepts UUIDs and would reject wallet-address identities.
After deployment, verify one consented journey in PostHog for each product:
anonymous discovery, wallet connection, returning-wallet setup, order acceptance,
confirmed partial or full fill, wallet switch, and disconnect. Verify the same
checksummed wallet has one PostHog identity across both products. Use the
instrumentation-quality tile to check missing product tags and identity mismatches.
Do not mark the version-2 events verified until production ingestion is observed.

No historical events were rewritten and no transactions were submitted during
local validation. Production rollout remains a separate step from pushing code.
