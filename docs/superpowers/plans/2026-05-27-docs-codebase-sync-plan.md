# Documentation Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `docs/API.md`, `docs/ARCHITECTURE.md`, and `README.md` back in sync with the current codebase.

**Architecture:** Audit the live route tree, package scripts, and module directories first, then patch only the stale documentation sections. Keep changes documentation-only and avoid touching unrelated application code.

**Tech Stack:** Markdown, Next.js monorepo, pnpm workspace, Zod-backed API routes

---

### Task 1: Verify API documentation coverage

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Compare documented endpoints to route handlers**

Run: `find apps/web/src/app/api -name 'route.ts' | sort`
Expected: full list of current API route handlers.

- [ ] **Step 2: Compare route list to API headings**

Run: `rg '^### (GET|POST|PUT|PATCH|DELETE|OPTIONS) \`/api' docs/API.md`
Expected: one heading per documented endpoint/method pair.

- [ ] **Step 3: Patch stale API docs if drift is found**

Update `docs/API.md` so endpoint coverage and any request/response schema notes match the current handlers and Zod validation.

### Task 2: Verify architecture documentation against the current repo layout

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Inspect current module and app structure**

Run: `find apps/web/src -maxdepth 2 -type d | sort && find apps/extension/src -maxdepth 2 -type d | sort && find apps/agent/src -maxdepth 2 -type f | sort`
Expected: current top-level runtime and module layout for web, extension, and agent packages.

- [ ] **Step 2: Identify stale or missing module descriptions**

Review `docs/ARCHITECTURE.md` against the current paths and note any described modules that no longer exist plus any major current modules not mentioned.

- [ ] **Step 3: Patch architecture docs**

Update `docs/ARCHITECTURE.md` to remove stale references and add current modules where the document is missing meaningful coverage.

### Task 3: Verify README setup and scripts

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Compare setup instructions to example env files and package scripts**

Run: `rg --files apps/web apps/extension | rg '\\.env(\\.local)?\\.(example|sample)$|\\.dev\\.vars\\.example$' && sed -n '1,220p' package.json && sed -n '1,220p' apps/web/package.json && sed -n '1,220p' apps/extension/package.json && sed -n '1,220p' apps/agent/package.json`
Expected: example env files and actual script names used by the workspace.

- [ ] **Step 2: Patch incorrect setup or script documentation**

Update `README.md` so setup guidance references the right example files and the script list matches actual `package.json` entries, distinguishing root scripts from package-local scripts.

- [ ] **Step 3: Verify documentation-only diff**

Run: `git diff -- docs/API.md docs/ARCHITECTURE.md README.md docs/superpowers/plans/2026-05-27-docs-codebase-sync-plan.md`
Expected: only documentation changes for this task.
