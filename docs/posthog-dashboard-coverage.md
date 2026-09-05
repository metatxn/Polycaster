# PostHog dashboard coverage

Updated September 5, 2026 in project 585396.

- [Web dashboard](https://us.posthog.com/project/585396/dashboard/2047913)
- [Extension dashboard](https://us.posthog.com/project/585396/dashboard/2047915)

The saved queries are live. The new application instrumentation still requires
deployment. No deployment or live wallet transaction was performed during validation.

## Major actions

| Action | Events used | Web | Full extension | Store extension |
| --- | --- | --- | --- | --- |
| Connect wallet | `wallet_connected`; web restoration uses `wallet_session_ready` | Yes | Yes | Yes |
| Create trading wallet | `trading_account_creation_attempted`, `trading_account_created`, `trading_account_creation_failed` | Yes | Yes | Not offered |
| Existing setup readiness | `trading_setup_state` | Yes | Yes | Discovery setup only |
| Create or derive API keys | `trading_api_key_requested`, `trading_api_key_created`, `trading_api_key_derived`, `trading_api_key_failed` | Yes | Yes | Not offered |
| Token approval | `trading_token_approval_requested`, `trading_token_approval_succeeded`, `trading_token_approval_failed` | Yes | Yes | Not offered |
| Market and limit buy/sell | `trade_button_clicked`, `order_attempted`, `order_accepted`, `order_failed`, `order_submission_unknown`; split by `side` and `order_type` | Yes | Yes | Web handoff |
| Confirmed order/sell | `trade_fill_confirmed`, `order_partially_filled`, `order_succeeded`, `sell_succeeded`, `trade_fill_failed` | Yes | Yes | Web handoff |
| Split/merge | `position_split_submitted`, `position_split_succeeded`, `position_split_failed`; corresponding `position_merge_*` events | Yes | Yes | Not offered |
| Cancel order | `order_cancel_attempted`, `order_cancelled`, `order_cancel_failed` | Yes | Yes | Not offered |
| Redeem | `position_redeem_submitted`, `position_redeemed`, `position_redeem_failed` | Yes | Not offered | Not offered |
| Open Polymarket | `polymarket_opened_via_knoww` | Yes | Yes | Where offered |
| Extension-to-web journey | `extension_web_handoff_opened`, `extension_web_handoff_received`, `wallet_session_ready`, attributed order events | Receiver | Sender | Sender |
| Extension onboarding | `extension_installed`, `extension_onboarding_started`, `wallet_install_clicked`, `extension_install_onboarding_completed`, demo events | Not applicable | Yes | Yes |
| Injected market engagement | `market_card_impression`, `market_card_clicked`, matched by page-view and market IDs | Separate web discovery charts | Yes | Yes |
| Extension search | `extension_search_query_submitted`, `extension_search_results_loaded`, `extension_search_result_clicked`, `extension_search_failed` | Separate web search events | Yes | Yes |

"Yes" means a source emitter and dashboard definition are in place. It does
not mean production ingestion has been verified. Knoww login is the connected
EOA wallet, not a second signup system. Creating a trading wallet is not proof
that a human is new to Polymarket. Wallet identity is not unique-human identity.

## Added views

| View | Web insight | Extension insight |
| --- | --- | --- |
| Latest observed onboarding stage | [AjWcvTmZ](https://us.posthog.com/project/585396/insights/AjWcvTmZ) | [PWAAmnP5](https://us.posthog.com/project/585396/insights/PWAAmnP5) |
| Accepted-order outcomes by side/type | [jChgIRl8](https://us.posthog.com/project/585396/insights/jChgIRl8) | [vXCaaXu9](https://us.posthog.com/project/585396/insights/vXCaaXu9) |
| Trade attempts by side/type | [QLFPCycp](https://us.posthog.com/project/585396/insights/QLFPCycp) | [N2ysZbem](https://us.posthog.com/project/585396/insights/N2ysZbem) |
| Setup and trading failure counts | [bdTy10pB](https://us.posthog.com/project/585396/insights/bdTy10pB) | [X4WX0rBX](https://us.posthog.com/project/585396/insights/X4WX0rBX) |

Both dashboards also contain [matched handoff delivery](https://us.posthog.com/project/585396/insights/vZ0Qfgn4)
and [web orders attributed to extension handoffs](https://us.posthog.com/project/585396/insights/v726fCGL).
The extension dashboard adds [store discovery retention](https://us.posthog.com/project/585396/insights/92THKp66).
Existing discovery and search funnels now match page/market or search IDs
within 30 minutes instead of matching unrelated actions across 14 days.

## Verification and rollout

All 61 dashboard tiles executed without query errors. Final onboarding and
injection refinements also executed. A one-day SQL filter override changed
the quality results to 100 injected cards and one click, confirming the date
selector reaches the query. These are legacy events, not version-2 conversions.
At verification time, the quality tile still showed missing product and
environment tags and no version-2 events in its returned rows.

The governed metric catalog was consulted and had no match. These are saved
operational definitions, not approved canonical metrics in that catalog.

Before treating the dashboards as a reliable production journey:

1. Deploy web instrumentation and the wallet-compatible batch-ingestion API.
2. Release or reload the corresponding extension build.
3. With analytics enabled, verify new and restored wallet sessions, existing
   setup readiness, each supported action, and failures in PostHog.
4. Confirm the same checksummed `wallet_address` identifies the wallet on web
   and extension. Test switching and disconnecting without identity mixing.
5. Verify one extension handoff has the same ID on sender and receiver, and
   that a delayed fill keeps its original handoff and order IDs.
6. Confirm extension opt-out removes handoff URL decoration and capture, and
   web opt-out clears attribution. Confirm localhost/preview traffic does not
   enter production charts.

Use safe test environments for money-moving checks. Do not place a real trade
solely to populate analytics. Confirmed-fill reporting depends on client-side
observation and can miss outcomes while clients are unavailable. See the
[version-2 contract](product-analytics-v2.md) for those limits.
