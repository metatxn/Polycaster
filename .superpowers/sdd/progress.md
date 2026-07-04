# SDD Progress — Guided Trading Setup (Extension)

Plan: docs/superpowers/plans/2026-06-23-extension-guided-trading-setup.md
Mode: subagent-driven, NO COMMITS (user commits manually). Working tree only.
Baselines: /tmp/sdd/baseline-sidepanel.ts, /tmp/sdd/baseline-trading-panel.ts

## Tasks
- Task 1: setup-flow.ts — COMPLETE (8/8 tests, typecheck clean; review fixed: simplified credentials predicate, typo, test gaps)
- Task 2: setup-flow-storage.ts — COMPLETE (3/3 tests, typecheck clean; controller-reviewed, faithful to brief)
- Task 3: sidepanel hasApproval load — COMPLETE (typecheck clean, 250 tests pass; controller-reviewed vs baseline; verified response.data.allowance shape is correct)
- Task 4: portfolio-setup-view.ts — COMPLETE (4/4 tests, typecheck clean; controller-reviewed, all data-attributes match Task 5 contract)
- Task 5: sidepanel wiring — COMPLETE (typecheck clean, 254 tests pass). Reviewer caught missing Step 6 (signed-out wizard) — controller implemented + verified. Also fixed 2 pre-existing structural tests that asserted the deleted renderPortfolioTradingGate.
- Task 6: trading-panel card flow — COMPLETE (typecheck clean, 258 tests). Agent truncated early; controller finished render-switch reorder + addSetupFlow + deletions + test. Reviewer: SPEC OK, Quality Approved (3 minors).
- Task 7: styles + verification — COMPLETE (typecheck + 258 tests + production build all pass). Deviation: side panel knoww-pf-setup-* styles placed in sidepanel.ts inline <style> (correct — side panel styles its own doc inline); card knoww-tp-setup-* in knoww-inline.css. No italics. Manual browser QA still pending (user must do).

## Minor findings (for final review triage)
- Task 6: `Number(SETUP_APPROVAL_DEFAULT)` fallback is redundant (already "100"); cardSetupFlow called twice in render switch (pure/cheap); connect-case absent from addSetupFlow switch (correct, a comment would help).
- Task 5: data-setup-approve empty-input fallback hardcodes "100" instead of String(SETUP_APPROVAL_DEFAULT); harmless today (default IS 100).
- Task 5: `isDeployed: data.hasTradingWallet ? true : false` could be just `data.hasTradingWallet` (cosmetic).
- Task 4: renderSetupWizard interpolates `error` UNescaped (line ~110), whereas the old renderPortfolioTradingGate used escapeHtml(portfolioTradingError). Low risk (own error channel) but consider escaping for parity.
- Plan brief's literal `deriveSetupFlow` had a latent bug (post-current steps with a satisfied signal would render `done`, violating 'steps after now are pending'). Implementation correctly uses linear gating (`foundIncomplete`). If a later reviewer compares to the brief, this divergence is INTENTIONAL and correct.


## Final whole-feature review (opus) — RESOLVED
Verdict was Not-ready: C1 (Critical) + I1/I2 (Important). All fixed by controller + re-verified (typecheck clean, 258 tests, prod build passes):
- C1: side-panel "Add funds" called setDepositStep("method") directly, leaving portfolioFundView unset -> deposit flow half-broken. FIXED: openPortfolioFunds("deposit").
- I1: renderSetupWizard interpolated error unescaped. FIXED: self-contained escapeHtml on error.
- I2: dead "Skip for now" on signed-out connect step. FIXED: suppress skip when currentStepId==="connect"; also null portfolioOwnerAddressValue in clearPortfolioSessionState.
- Minors: approve fallback -> SETUP_APPROVAL_DEFAULT; isDeployed -> Boolean.
Reviewer confirmed architecture sound: single source of truth, order-as-gate, no resurrection, deploy-before-credentials, order-time top-up untouched.

## STATUS: ALL TASKS COMPLETE. Uncommitted (user commits manually). Manual browser QA still pending (user).
