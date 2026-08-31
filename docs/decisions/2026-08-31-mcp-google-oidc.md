# Use Google OpenID Connect for MCP user authentication

Status: Accepted

Date: 2026-08-31

## Context

Knoww MCP originally asked users to authorize with an injected EVM wallet and an EOA message signature. That tied access to browser-extension behavior and failed in browsers that isolate wallet providers or popup contexts. MCP clients still need standards-based OAuth 2.1 authorization, S256 PKCE, scoped tokens, refresh rotation, and exact callback handling.

## Decision

Knoww will use Google OpenID Connect to authenticate the person approving an MCP connection. The MCP client remains an OAuth public client of Knoww and does not integrate with Google directly.

The Worker will:

- keep the existing MCP-facing OAuth Provider, discovery endpoints, `markets:read` scope, access-token lifetime, and refresh-token rotation;
- create five-minute, one-time authorization transactions in the existing Durable Object binding;
- redirect to Google with state, nonce, authorization-code flow, and S256 PKCE;
- exchange the Google code on the server with Cloudflare secret bindings;
- verify the ID-token signature, issuer, audience, expiry, nonce, subject, and verified-email claim;
- derive the MCP principal from Google's stable subject identifier; and
- discard the Google code, ID token, access token, and email after verification.

The existing `MCP_AUTH_CHALLENGES` binding and `WalletChallengeStore` class names remain unchanged because Cloudflare Durable Object migrations identify the deployed class by name. Their stored records are now authorization transactions, not wallet challenges.

## Consequences

Users can authorize from browsers that do not expose an injected wallet to the popup. The Worker needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` Cloudflare secret bindings, but it does not need a new database. Google availability becomes part of the login path. MCP clients never receive Google credentials or tokens, and the authorization scope remains independent from user authentication.
