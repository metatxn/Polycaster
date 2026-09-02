# Domain docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT-MAP.md` at the repo root. It lists one `CONTEXT.md` per context. Read each one relevant to the topic.
- `docs/decisions/` for system-wide ADRs. Read the ones that touch the area you are about to work in.
- `<context>/docs/decisions/` for context-scoped ADRs, where `<context>` is a directory named in `CONTEXT-MAP.md`.

If any of these files don't exist, proceed silently. Don't flag their absence and don't suggest creating them upfront. The `/domain-modeling` skill, reached via `/grill-with-docs` and `/improve-codebase-architecture`, creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo. This is a pnpm workspace, and each app and package is its own context.

```
/
├── CONTEXT-MAP.md                    lists the contexts below
├── docs/decisions/                   system-wide ADRs, dated slugs
├── apps/
│   ├── mcp/CONTEXT.md                MCP tools, OAuth, scopes, principals
│   ├── web/CONTEXT.md
│   ├── extension/CONTEXT.md          card matching and ranking
│   ├── agent/CONTEXT.md
│   └── video/CONTEXT.md
└── packages/
    ├── knoww-services/CONTEXT.md     platform adapters, unified market contract
    ├── logger/CONTEXT.md
    └── shared-types/CONTEXT.md
```

ADRs use the existing name form `YYYY-MM-DD-<slug>.md`, not a numbered `0001-` prefix. Context-scoped ADRs go in `<context>/docs/decisions/`, for example `apps/mcp/docs/decisions/`. The two ADRs already in `docs/decisions/` stay where they are.

## Use the glossary's vocabulary

When your output names a domain concept, in an issue title, a refactor proposal, a hypothesis, or a test name, use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal. Either you're inventing language the project doesn't use, so reconsider, or there's a real gap to note for `/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> Contradicts docs/decisions/2026-08-31-mcp-google-oidc.md (Google OIDC for MCP auth), but worth reopening because...
