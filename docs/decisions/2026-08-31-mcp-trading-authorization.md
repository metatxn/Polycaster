# Add delegated Polymarket trading authorization to Knoww MCP

Status: Proposed

Date: 2026-08-31

## Summary

Knoww should keep Google OpenID Connect as the identity layer for MCP, then add a separate Polymarket authorization layer for wallet operations.

The recommended model is:

1. Google authenticates the Knoww user and records consent for a specific MCP client.
2. The user links or creates a wallet on a trusted Knoww webpage.
3. The wallet owner authorizes a Polymarket Session Key limited to CLOB trading.
4. Knoww uses that Session Key for routine order placement and cancellation, subject to Knoww policy limits.
5. The wallet owner signs redemption, withdrawals, transfers, approvals, split, and merge operations.
6. Knoww never stores the owner wallet's private key.

Google OAuth alone must never authorize a trade. It identifies the Knoww user, but it does not prove control of a Polymarket wallet or authorize the use of its funds.

## Scope

This report covers these MCP capabilities:

- create or link a Polymarket account;
- place limit and market orders;
- cancel open orders;
- redeem resolved positions;
- split and merge positions;
- set token approvals;
- deposit, withdraw, or transfer funds; and
- read private order and trade state.

It does not approve implementation. It records the available models, recommended design, requirements, and rollout order.

## Current Knoww design

Knoww currently has two separate authorization paths:

- The MCP Worker uses Google OpenID Connect to create a Knoww principal and grants the `markets:read` scope.
- The web trading application uses an EVM wallet to derive CLOB credentials, sign order payloads, and sign relayer or onchain transactions.

This separation is correct. The MCP OAuth token authorizes access to Knoww. The wallet signature authorizes a Polymarket operation.

The current MCP scope is defined in `apps/mcp/src/auth/scopes.ts`. The browser trading paths are implemented in `apps/web/src/hooks/use-clob-credentials.ts`, `apps/web/src/hooks/use-clob-client.ts`, `apps/web/src/hooks/use-ctf-operations.ts`, and `apps/web/src/lib/relayer-client.ts`.

## The two authorization layers

| Layer | What it proves | What it should allow |
| --- | --- | --- |
| Knoww Google OAuth | The Knoww user's identity and consent for a specific MCP client | Access to approved Knoww MCP tools |
| Wallet and Polymarket authorization | Authority over a specific wallet and its funds | Orders, cancellations, redemptions, and other wallet actions |

An MCP scope only authorizes a caller to invoke a tool. The server must still check the linked wallet, resource ownership, geographic eligibility, policy limits, and required wallet approval.

## Polymarket account and wallet model

Polymarket currently uses three account wallet types:

| Wallet type | Current use | Session Key support |
| --- | --- | --- |
| Deposit Wallet | Default for accounts deployed on or after May 4, 2026 | Supported |
| Proxy Wallet | Legacy account created through Magic Link or Google on polymarket.com | Not currently supported |
| Safe Wallet | Legacy account created with an external signer | Not currently supported |

A builder can create Deposit Wallets for users with a Builder API key. The builder does not become the owner. Each Deposit Wallet remains controlled by its signer.

Creating a Knoww user and creating a Polymarket account are therefore different operations:

- Google OAuth can create or identify the Knoww user.
- A user-controlled EOA or embedded wallet must own the Polymarket Deposit Wallet.
- The Builder API key identifies Knoww to Polymarket and allows account setup. It does not grant Knoww authority over user funds.

Source: [Polymarket wallets and authentication](https://docs.polymarket.com/trading/wallets-auth)

## Available authorization models

### Interactive signing for every operation

The user opens a trusted Knoww webpage, connects a wallet, reviews the exact operation, and signs it. Knoww then sends the signed order or relayer transaction to Polymarket.

Advantages:

- works with Deposit, Proxy, and Safe Wallet accounts;
- keeps the owner key outside Knoww;
- gives the user a clear approval step; and
- works for orders and onchain position operations.

Limitations:

- requires a browser and wallet interaction for each operation;
- does not support unattended agents; and
- has more friction than a delegated signer.

This is the safest first implementation and the required fallback for legacy accounts.

### Polymarket Session Key

A Session Key is a separate EOA authorized by a Deposit Wallet owner. It can perform routine trading without using the owner's key. Polymarket currently allows scopes for CLOB, Combo RFQ, or all supported venues.

Knoww should request only `CLOB`.

Current constraints:

- Session Keys are in beta.
- They work only with Deposit Wallets.
- A Session Key cannot withdraw funds.
- The owner must authorize the Session Key.
- Authorization currently expires after exactly 180 days.
- Shorter expiration periods are not supported. Early termination requires revocation.
- The Session Key private key must remain secret.
- Session Key management requires a Builder API key and initial approval from Polymarket.
- A Session Key can read only the orders, trades, notifications, and updates produced by that same Session Key.
- A Deposit Wallet owner cannot use the owner credentials to fetch orders created by an authorized Session Key.

Knoww should create a separate Session Key for each combination of Knoww principal, MCP client, and Polymarket wallet. This reduces the effect of one compromised MCP client and gives each client a separate audit trail. Polymarket should confirm Session Key count and rate limits before this becomes a fixed design.

Source: [Polymarket Session Keys](https://docs.polymarket.com/trading/session-keys)

### Embedded user wallet

An embedded wallet provider can create a user-owned EOA after Google or social sign-in. That EOA can own a Polymarket Deposit Wallet. This removes the requirement for MetaMask or another browser extension.

Advantages:

- familiar onboarding for users who do not already have a wallet;
- no seed phrase or browser extension in the normal flow; and
- can preserve user ownership if the provider offers a user-controlled wallet model.

Limitations:

- adds a wallet vendor and recovery dependency;
- adds another authentication and key-management system;
- may introduce vendor-specific delegation semantics; and
- requires a compatibility test for Polygon, EIP-712 order signatures, Deposit Wallet authorization, and Polymarket relayer batches.

Coinbase CDP is one current example of this product category. Its documentation describes social-login user wallets and time-bound delegated backend signing. It is an example, not a selected dependency. Knoww must compare wallet providers and test Polymarket compatibility before choosing one.

Source: [CDP wallet authentication models](https://docs.cdp.coinbase.com/wallets/authentication/overview)

### Server-owned wallet

Knoww could create and control the owner wallet key. This would allow unattended order placement, redemption, transfers, and withdrawals.

This model is not recommended for standard Knoww users. It turns the Knoww backend, Google account recovery, deployment credentials, and internal access controls into authority over user funds. It also adds custody, compliance, incident-response, and account-recovery obligations.

### User-hosted remote signer

An advanced user could run a local or remote signing service. Knoww would send a canonical typed payload for approval, and the user's signer would return the signature.

This keeps the owner key under the user's control and can support automation. It also requires mutual authentication, strict anti-replay protection, payload verification, reliable availability, and more setup than most users will accept.

This may be useful later for enterprise or professional users. It is not the recommended default.

## Recommended hybrid model

Use interactive owner signing for account setup and sensitive onchain actions. Use a CLOB-only Session Key for routine order operations.

| Operation | Recommended authority | Interaction |
| --- | --- | --- |
| Create Knoww account | Google OAuth | Google sign-in |
| Link an existing Polymarket account | Wallet ownership signature | One-time browser flow |
| Create a new Polymarket account | User-owned EOA or embedded wallet, followed by builder-created Deposit Wallet | One-time browser flow |
| Preview an order | Knoww OAuth | None |
| Place an order | CLOB-only Session Key | Confirmation at first, policy-based automation later |
| Cancel one known order | The Session Key that placed the order | Usually none |
| Cancel all orders | Relevant Session Key | Confirmation recommended |
| Read private orders and trades | Relevant Session Key | None |
| Redeem a resolved position | Deposit Wallet owner signature | Required per transaction |
| Split or merge positions | Deposit Wallet owner signature | Required |
| Set token approvals | Deposit Wallet owner signature | Required |
| Deposit funds | Owner-approved wallet or onramp flow | Required |
| Withdraw or transfer funds | Owner signature | Always required and deferred initially |
| Revoke automated trading | Owner signature | Required |

Redemption applies to positions, not orders. Polymarket redemption burns resolved outcome tokens and returns collateral. The relayer can submit the transaction and pay gas, but the wallet owner still signs the wallet batch.

Source: [Polymarket position management](https://docs.polymarket.com/trading/positions/manage)

## MCP interaction model

### Account setup

1. The user connects Knoww MCP and signs in with Google.
2. Knoww grants only the baseline `markets:read` scope.
3. The user invokes a tool that needs wallet access.
4. Knoww requests the minimum additional OAuth scope.
5. If no wallet connection exists, the MCP server returns a URL-mode elicitation.
6. The user opens a trusted `mcp.knoww.app` page.
7. The page reauthenticates the same Google principal.
8. The user connects or creates a wallet.
9. The user signs a wallet-ownership challenge.
10. If the account uses a Deposit Wallet, the owner authorizes a CLOB-only Session Key.
11. Knoww stores the resulting wallet binding and protected signer credentials.

URL-mode elicitation is intended for sensitive third-party authorization that must not pass through the MCP client or model context. The server must bind the elicitation state and resulting wallet connection to the authenticated user. The URL must contain only an opaque operation identifier, not credentials or a preauthorized action.

Clients that do not support URL-mode elicitation need a fallback tool response with an operation ID and a safe Knoww URL.

Source: [MCP URL-mode elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)

### Order execution

Order placement should use two tools:

```text
preview_order -> place_order
```

`preview_order` should resolve and freeze:

- market, condition ID, and outcome token;
- exact outcome name;
- buy or sell side;
- share quantity;
- limit price or maximum market-order spend;
- current order book;
- tick size and minimum order size;
- expected fees and slippage;
- maximum pUSD or USDC exposure;
- order type and expiration;
- wallet and available balance; and
- a canonical draft hash with a short expiration.

`place_order` should accept a `draftId` and `idempotencyKey`. It should not accept a second free-form copy of the trade parameters.

Before signing, the server must reload the market and reject the draft if any material condition has changed. Checks include market status, order acceptance, outcome token, exchange type, tick size, minimum size, available balance, closed-only status, geographic eligibility, current price, and Knoww policy limits.

Polymarket requires the order payload itself to be signed. CLOB L2 credentials authenticate the request but do not replace the order signature. The order signer must also select the correct standard or negative-risk exchange contract.

Source: [Polymarket order placement](https://docs.polymarket.com/trading/place-orders)

### Cancellation

A Session Key should cancel only orders it created. Cancel one known order by ID whenever possible. Account-wide cancellation should be reserved for emergency access revocation or an explicit user request.

For a partially filled order, cancellation removes only the unfilled remainder. Cancellation remains available when Polymarket is in cancel-only mode.

Knoww should make cancellation idempotent at its own operation layer. A repeated request for an already filled, cancelled, or closed order should return the terminal state instead of retrying indefinitely.

Source: [Polymarket order management](https://docs.polymarket.com/trading/manage-orders)

### Redemption and other onchain actions

Session Keys are for approved trading venues. They do not grant general authority to call Conditional Tokens contracts, transfer funds, or withdraw collateral.

The following operations should always use an interactive owner-signed wallet batch:

- redeem positions;
- split positions;
- merge positions;
- change token approvals;
- deposit or bridge funds;
- withdraw funds; and
- transfer assets.

Knoww should prepare the transaction, display its decoded meaning and expected asset changes, then ask the owner to sign it on the trusted webpage. The relayer may submit the signed batch, but relayer credentials do not authorize user funds.

## MCP scopes

Knoww should use precise, incremental scopes:

- `markets:read`
- `account:read`
- `wallet:link`
- `orders:read`
- `orders:create`
- `orders:cancel`
- `positions:redeem`
- `positions:manage`
- `funds:deposit`
- `funds:withdraw`

Do not use `trading:*`, `wallet:*`, `all`, `full-access`, or a similar wildcard.

Only low-risk read permissions should appear in the initial authorization request. When a tool needs another permission, the MCP server should return `403 Forbidden` with `error="insufficient_scope"` and the minimum required scope in `WWW-Authenticate`. The MCP client can then run a step-up OAuth flow.

The server must not treat a token scope as sufficient authorization. It must still enforce wallet ownership, per-client consent, resource ownership, policy limits, and any required user confirmation.

Sources: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and [MCP scope minimization](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices)

## Data and key storage

Mutating operations require durable, transactional storage. The OAuth KV store alone is not enough for wallet ownership, operation idempotency, and audit records.

Store these records:

- Google principal, keyed by the stable OIDC `sub` claim instead of email;
- MCP client ID and per-client consent;
- owner signer address and Polymarket wallet address;
- wallet type, chain, proof timestamp, and binding status;
- Session Key public address, CLOB scope, expiry, and revocation status;
- protected reference to the Session Key private key;
- protected CLOB credentials;
- order drafts and canonical parameter hashes;
- mutation idempotency keys and operation state;
- upstream order IDs, transaction IDs, and transaction hashes;
- per-user trading policies; and
- append-only audit events.

A relational or transactional database such as Postgres or D1 should hold operation state and uniqueness constraints. A managed KMS, HSM, or dedicated signing service should protect Session Key material. Do not store private keys or CLOB secrets as plaintext in the application database, Workers KV, logs, browser storage, or MCP tool arguments.

## Required security controls

### Identity and consent

- Bind wallet access to the Google principal, MCP client ID, and Polymarket wallet.
- Store consent per MCP client to prevent a confused-deputy attack.
- Reauthenticate Google before wallet setup, Session Key authorization or revocation, redemption, and withdrawals.
- Show the requesting MCP client's name and exact requested permission.
- Protect setup pages with CSRF defenses and `frame-ancestors 'none'` or an equivalent clickjacking control.

### Trade safety

- Use Decimal.js and decimal strings for every monetary calculation.
- Treat every market title, question, description, and resolution source as untrusted text.
- Display the exact market, outcome, side, size, price, maximum spend, fee, order type, and expiration before confirmation.
- Resolve the outcome token on the server. Never trust a model-generated YES or NO label without matching it to the current token ID.
- Revalidate live market constraints immediately before signing.
- Apply maximum order value, maximum daily exposure, allowed order types, slippage, market allowlists or denylists, and confirmation thresholds on the server.
- Require a trusted-page confirmation for all market orders and orders above a configured threshold.
- Start with confirmation for every new order. Offer policy-based automation only after the interactive path has production evidence.

### Geographic and legal controls

- Check geographic eligibility before wallet setup and before every order.
- Evaluate the user's actual location. Do not rely on the Cloudflare Worker's outbound location.
- Respect blocked and close-only results.
- Run legal and compliance review before enabling real-money mutations in any jurisdiction.

Polymarket directs builders to check geographic eligibility before submitting orders and rejects orders from blocked regions.

Source: [Polymarket geographic restrictions](https://docs.polymarket.com/api-reference/geoblock)

### Idempotency and recovery

- Require an idempotency key for every mutation.
- Enforce uniqueness for the principal, MCP client, wallet, operation type, and idempotency key.
- Store the canonical request hash with the idempotency record.
- Reject reuse of an idempotency key with different parameters.
- Reconcile upstream state after timeouts before retrying. An order or relayer transaction may have succeeded even when Knoww did not receive the response.
- Record terminal success and failure states so retries return the existing result.

### Secret handling

- Never place owner private keys, Session Keys, CLOB secrets, signatures, or authorization headers in MCP arguments.
- Never return these values to the MCP client or model.
- Never include them in structured logs, error messages, traces, analytics, or audit payloads.
- Keep Builder and Relayer API credentials on the server.
- Rotate and revoke signing credentials after suspected exposure.
- Separate production and development signers and Builder credentials.

### Rate limits and audit

- Rate-limit by principal, MCP client, wallet, tool, and IP where appropriate.
- Apply stricter limits to order placement and broad cancellation.
- Write an append-only audit record for permission elevation, wallet binding, draft creation, confirmation, policy decision, signing, submission, reconciliation, cancellation, and revocation.
- Audit canonical parameter hashes and identifiers, not raw secrets.

### Emergency controls

- Provide a user-visible command to disable MCP trading access.
- Cancel the affected Session Key's open orders before revocation when possible.
- Revoke the Session Key and treat the account as disabled while the relayer transaction confirms.
- Provide an operator kill switch that blocks new mutations without blocking order cancellation.

Polymarket Session Key revocation may take several minutes. Revocation also cancels that Session Key's open orders, but Knoww should not assume immediate completion.

## Tool contract recommendations

The first mutation-capable MCP catalog should use small tools with explicit state:

| Tool | Purpose |
| --- | --- |
| `get_trading_connection` | Read wallet type, address, Session Key status, scopes, policy, and eligibility |
| `begin_trading_setup` | Create an opaque setup operation and return URL elicitation |
| `get_trading_setup_status` | Poll setup without exposing credentials |
| `preview_order` | Validate an order and create a short-lived immutable draft |
| `place_order` | Execute a confirmed draft with an idempotency key |
| `get_order_status` | Reconcile an order by Knoww operation ID or upstream order ID |
| `list_open_orders` | List only orders visible to the bound signer |
| `cancel_order` | Cancel one owned order by ID |
| `cancel_all_orders` | Cancel all orders owned by the bound signer after confirmation |
| `preview_redeem` | Verify resolution, token balance, payout, and required wallet call |
| `redeem_position` | Start an owner-signed URL flow and return an operation ID |
| `get_operation_status` | Read order or relayer operation state |
| `revoke_trading_access` | Cancel open orders and revoke the Session Key |

Every mutation response should include a Knoww operation ID, current state, idempotency result, upstream identifiers when available, and a request correlation ID.

## Rollout plan

### Phase 1: account binding and read state

- Add durable principal, MCP-client consent, and wallet-binding records.
- Add a URL-based wallet ownership flow.
- Add `get_trading_connection` and setup status tools.
- Keep all existing market tools read-only.

### Phase 2: preview and interactive orders

- Add `preview_order`.
- Add trusted-page confirmation and wallet signing for each order.
- Add operation idempotency, reconciliation, audit, and policy checks.
- Exercise the complete flow with low-value live orders before adding delegation.

### Phase 3: delegated CLOB trading

- Obtain Polymarket approval for Session Key management.
- Add CLOB-only Session Keys for Deposit Wallet accounts.
- Store each signer in a managed key service.
- Apply low default order and daily exposure limits.
- Add cancel-by-ID, cancel-all, order status, and emergency revocation.
- Keep legacy Proxy and Safe Wallet accounts on the interactive signing path.

### Phase 4: owner-signed position management

- Add `preview_redeem` and interactive redemption.
- Add split and merge only if product usage justifies them.
- Keep token approvals explicit and visible to the user.

### Phase 5: funding and advanced automation

- Evaluate an embedded user-wallet provider.
- Add deposit and bridge flows after geographic and compliance review.
- Consider policy-based unattended orders for users who explicitly opt in.
- Continue to require owner approval for withdrawals and transfers.

## Deferred capabilities

Do not include these in the first mutation release:

- server-owned user wallets;
- arbitrary contract calls;
- arbitrary token transfers;
- unattended withdrawals;
- unrestricted Session Key scopes;
- a single Session Key shared across users or MCP clients;
- order execution directly from model-generated free-form arguments; or
- automatic trading without user-configured exposure limits.

## Open decisions

Before implementation starts, the team must decide:

1. Whether the first version supports external wallets only or also evaluates an embedded wallet.
2. Whether every order needs trusted-page confirmation at launch. This report recommends yes.
3. Whether Knoww will ever support unattended orders and, if so, the default limits.
4. Whether Session Keys are created per MCP client or per user. This report recommends per principal, client, and wallet.
5. Which transactional database and managed signing service will store operation state and signer references.
6. Which countries and account types Knoww will support.
7. How users recover or migrate embedded wallets if a wallet provider is selected.
8. How Knoww reconciles public wallet data with the Session Key's isolated private order view.

## Decision criteria

The implementation should proceed only if it satisfies all of these conditions:

- Google OAuth remains an identity layer, not wallet authority.
- Knoww does not store the owner private key.
- Routine delegated authority is limited to CLOB trading.
- Each MCP client receives separate consent and trading authority.
- Sensitive onchain actions require an owner signature.
- Every mutation is idempotent, auditable, rate-limited, and policy-checked.
- Geographic eligibility uses the user's location.
- Users can cancel orders and revoke access without contacting Knoww support.

## Sources

- [Polymarket wallets and authentication](https://docs.polymarket.com/trading/wallets-auth)
- [Polymarket Session Keys](https://docs.polymarket.com/trading/session-keys)
- [Polymarket order placement](https://docs.polymarket.com/trading/place-orders)
- [Polymarket order management](https://docs.polymarket.com/trading/manage-orders)
- [Polymarket position management](https://docs.polymarket.com/trading/positions/manage)
- [Polymarket geographic restrictions](https://docs.polymarket.com/api-reference/geoblock)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP URL-mode elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [MCP security best practices](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices)
- [CDP wallet authentication models](https://docs.cdp.coinbase.com/wallets/authentication/overview)
