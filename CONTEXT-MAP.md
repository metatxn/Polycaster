# Context map

Knoww is a pnpm workspace. Each app and package below is its own bounded context with its own glossary. Read the `CONTEXT.md` for every context a task touches, then the ADRs in `docs/decisions/` and in that context's `docs/decisions/`.

A context's `CONTEXT.md` is created the first time `/domain-modeling` resolves a term for it. A missing file means no terms have been pinned down yet, not that the context is out of scope.

| Context | Path | What it covers |
| --- | --- | --- |
| Services | `packages/knoww-services/CONTEXT.md` | Platform adapters, the unified market and order contract, canonical IDs, search fan-out and pagination |
| MCP | `apps/mcp/CONTEXT.md` | MCP tools and their names, OAuth grants, scopes, principals, Session Keys |
| Web | `apps/web/CONTEXT.md` | The knoww.app site and trading UI |
| Extension | `apps/extension/CONTEXT.md` | Card matching, ranking, side panel |
| Agent | `apps/agent/CONTEXT.md` | Autonomous trading agent |
| Video | `apps/video/CONTEXT.md` | Video generation |
| Logger | `packages/logger/CONTEXT.md` | Structured logging |
| Shared types | `packages/shared-types/CONTEXT.md` | Types shared across contexts |

System-wide decisions live in `docs/decisions/`. Rules for how agents read these files are in `docs/agents/domain.md`.
