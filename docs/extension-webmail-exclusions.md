# Webmail exclusions

[Issue #114](https://github.com/metatxn/Knoww/issues/114) lists 50 webmail URLs
where Knoww must not display its injected UI. The shared rules live in
`apps/extension/src/webmail.ts`.

Matching uses exact hostnames and path segment boundaries. A rule for `/mail`
covers `/mail`, `/mail/`, and `/mail/inbox`, but not `/mailbox`. Queries and
fragments do not affect matching. Hostname case and a trailing DNS dot are
normalized. HTTP and HTTPS use the same exclusions. Other subdomains and
lookalike domains are not excluded.

Whole-host rules also exclude automatic content-script registration. For
path-scoped hosts, the lightweight support script stays registered so it can
restore the prompt when client-side navigation leaves mail. It renders nothing
on the excluded route. It listens for Navigation API `currententrychange`,
back/forward, and hash changes, with a DOM-mutation fallback when the Navigation
API is unavailable. The URL is checked again after asynchronous storage reads.
Toolbar routing and full-content startup use the same exclusion function.

This is a URL list, not mail-client detection. Self-hosted Roundcube, SnappyMail,
SOGo, Horde, and Cypht deployments on other domains are outside this change.

Tests cover all listed URLs, child paths, hostname boundaries, allowed routes,
toolbar reveal, and navigation during pending renders. Isolated Chromium checks
also exercised the built script across page-world History API navigation and
extension isolated-world listeners. Those checks used mocked pages, not inboxes.
