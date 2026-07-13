import { Decimal } from "decimal.js";
import type { TradingSetupAllowanceReadStatus } from "../content/trading/setup-flow";
import { hasDeployedTradingWallet } from "../content/trading/setup-gates";
import {
  consumeRequestedSidePanelView,
  fetchKnowwJson,
  sendRuntimeMessage,
} from "./messaging";
import {
  setSidepanelView as applySidepanelView,
  escapeHtml,
  formatAddress,
  formatCompactNumber,
  formatDecimalMoney,
  formatMoney,
  formatOrderExpiration,
  formatPercent,
  formatSignedMoney,
  formatTradeTime,
  type SidePanelView,
  type TradingWalletMode,
} from "./shared";

export const PORTFOLIO_STYLES = `
      * {
        box-sizing: border-box;
      }

      html,
      body,
      #root {
        width: 100%;
        min-width: 0;
        min-height: 100vh;
        margin: 0;
        background: var(--kse-panel, #18181b);
        overflow: hidden;
      }

      #knoww-notification-stack.knoww-sidepanel-stack {
        /* Side-panel-only neutral near-black palette (anchored on #18181b).
           Overrides the shared warm dark tokens for this surface only. */
        --kse-bg: #121214;
        --kse-panel: #18181b;
        --kse-panel-2: #1f1f23;
        --kse-bg-3: #1d1d21;
        position: static !important;
        top: auto !important;
        right: auto !important;
        bottom: auto !important;
        left: auto !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        height: 100vh !important;
        max-height: none !important;
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        transform: none !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack .knoww-stack-items {
        max-height: calc(100vh - 116px) !important;
      }

      #knoww-notification-stack.knoww-sidepanel-stack .knoww-stack-content {
        min-height: 0 !important;
      }

      .knoww-sidepanel-tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        padding: 10px 10px 6px;
      }

      .knoww-sidepanel-tab {
        height: 32px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        font: 600 10px/1 var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        transition: color 0.16s ease, background 0.16s ease, border-color 0.16s ease;
      }

      .knoww-sidepanel-tab:hover {
        color: rgba(255, 255, 255, 0.8);
        background: rgba(255, 255, 255, 0.04);
      }

      .knoww-sidepanel-tab.is-active {
        border-color: rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.09);
        color: rgba(255, 255, 255, 0.95);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }

      .knoww-sidepanel-panel[hidden],
      .knoww-sidepanel-portfolio-active .knoww-search-container {
        display: none !important;
      }

      .knoww-sidepanel-portfolio {
        --pf-mono: var(--kse-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        --pf-sans: var(--kse-font-sans, system-ui, sans-serif);
        --pf-display: var(--kse-font-display, Georgia, "Times New Roman", serif);
        --pf-pos: #34d399;
        --pf-neg: #fb7185;
        --pf-hi: rgba(255, 255, 255, 0.96);
        /* Tiers tuned for legibility: at 9-12px on these dark surfaces the old
           0.58/0.40 muted tokens fell below ~3:1. Lifted to keep the same
           hierarchy (hi > mid > dim) while clearing AA for small UI text. */
        --pf-mid: rgba(255, 255, 255, 0.74);
        --pf-dim: rgba(255, 255, 255, 0.62);
        --pf-line: rgba(255, 255, 255, 0.07);
        --pf-line-2: rgba(255, 255, 255, 0.13);
        --pf-surface: rgba(255, 255, 255, 0.022);
        --pf-surface-2: rgba(255, 255, 255, 0.05);
        display: flex;
        flex-direction: column;
        gap: 12px;
        height: calc(100vh - 96px);
        overflow: auto;
        padding: 12px 12px 24px;
      }

      /* ---- Hero ---- */
      .knoww-pf-hero {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--pf-line-2);
        border-radius: 16px;
        padding: 15px 16px 0;
        background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.045),
          rgba(255, 255, 255, 0.012)
        );
      }

      .knoww-pf-hero::before {
        content: "";
        position: absolute;
        inset: -50% -10% auto -12%;
        height: 240px;
        background: radial-gradient(
          56% 100% at 26% 0%,
          var(--pf-glow, transparent),
          transparent 70%
        );
        pointer-events: none;
      }

      .knoww-pf-hero.is-up {
        --pf-glow: rgba(52, 211, 153, 0.26);
      }

      .knoww-pf-hero.is-down {
        --pf-glow: rgba(251, 113, 133, 0.24);
      }

      .knoww-pf-hero.is-flat {
        --pf-glow: rgba(255, 255, 255, 0.06);
      }

      .knoww-pf-hero-top {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .knoww-pf-id {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .knoww-pf-kicker {
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--pf-dim);
      }

      .knoww-pf-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 16px/1.15 var(--pf-sans);
        letter-spacing: -0.01em;
        color: var(--pf-hi);
      }

      .knoww-pf-hero-value {
        position: relative;
        margin-top: 20px;
      }

      .knoww-pf-hero-label {
        display: block;
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--pf-dim);
      }

      .knoww-pf-hero-num {
        display: block;
        margin-top: 8px;
        font: 500 34px/1 var(--pf-mono);
        letter-spacing: -0.022em;
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-delta {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        margin-top: 11px;
        font: 500 12px/1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-delta.positive {
        color: var(--pf-pos);
      }

      .knoww-pf-delta.negative {
        color: var(--pf-neg);
      }

      .knoww-pf-delta.flat {
        color: var(--pf-mid);
      }

      .knoww-pf-delta-arrow {
        width: 9px;
        height: 9px;
        fill: currentColor;
      }

      .knoww-pf-hero.is-down .knoww-pf-delta-arrow {
        transform: rotate(180deg);
      }

      .knoww-pf-delta-num {
        color: inherit;
      }

      .knoww-pf-delta-label {
        color: var(--pf-dim);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .knoww-pf-strip {
        position: relative;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin: 18px -16px 0;
        border-top: 1px solid var(--pf-line);
      }

      .knoww-pf-strip-cell {
        display: grid;
        gap: 6px;
        min-width: 0;
        padding: 13px 14px;
        border-right: 1px solid var(--pf-line);
      }

      .knoww-pf-strip-cell:first-child {
        padding-left: 16px;
      }

      .knoww-pf-strip-cell:last-child {
        padding-right: 16px;
        border-right: 0;
      }

      .knoww-pf-strip-label {
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--pf-dim);
      }

      .knoww-pf-strip-cell strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 500 14px/1 var(--pf-mono);
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-hero-actions {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex: none;
      }

      /* Icon-only disconnect — mirrors the trading-panel header action. Sits
         beside Open; tints red on hover to signal it's a destructive action. */
      .knoww-pf-hero-disconnect {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid var(--pf-line-2);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.72);
        cursor: pointer;
        transition: color 0.15s ease, background 0.15s ease,
          border-color 0.15s ease, opacity 0.15s ease;
      }

      .knoww-pf-hero-disconnect:hover {
        border-color: rgba(251, 113, 133, 0.5);
        background: rgba(251, 113, 133, 0.14);
        color: var(--pf-neg);
      }

      .knoww-pf-hero-disconnect svg {
        width: 13px;
        height: 13px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-hero-disconnect.is-busy {
        opacity: 0.55;
        pointer-events: none;
      }

      /* ---- Open button (also used in wallet/sign-in actions) ---- */
      .knoww-portfolio-open {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        border: 1px solid var(--pf-line-2);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.82);
        cursor: pointer;
        padding: 0 12px;
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        white-space: nowrap;
        transition: color 0.15s ease, background 0.15s ease,
          border-color 0.15s ease;
      }

      .knoww-portfolio-open:hover {
        border-color: rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.09);
        color: #fff;
      }

      .knoww-portfolio-open svg {
        width: 11px;
        height: 11px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-portfolio-open.primary {
        border-color: rgba(52, 211, 153, 0.5);
        background: rgba(52, 211, 153, 0.16);
        color: #eafff5;
      }

      .knoww-portfolio-open.primary:hover {
        border-color: rgba(52, 211, 153, 0.72);
        background: rgba(52, 211, 153, 0.24);
        color: #fff;
      }

      .knoww-portfolio-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }

      /* ---- Table (tabs + panels) ---- */
      .knoww-portfolio-table {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .knoww-portfolio-table-tabs {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 2px;
        padding: 3px;
        border: 1px solid var(--pf-line);
        border-radius: 11px;
        background: rgba(0, 0, 0, 0.22);
      }

      .knoww-portfolio-table-tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 0;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--pf-mid);
        cursor: pointer;
        padding: 8px 6px;
        transition: color 0.15s ease, background 0.15s ease;
      }

      .knoww-portfolio-table-tab span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }

      .knoww-portfolio-table-tab strong {
        flex: none;
        min-width: 18px;
        padding: 2px 5px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.07);
        color: var(--pf-mid);
        font: 500 10px/1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
        text-align: center;
      }

      .knoww-portfolio-table-tab:hover {
        color: var(--pf-hi);
      }

      .knoww-portfolio-table-tab.is-active {
        background: rgba(255, 255, 255, 0.08);
        color: var(--pf-hi);
      }

      .knoww-portfolio-table-tab.is-active strong {
        background: rgba(52, 211, 153, 0.16);
        color: var(--pf-pos);
      }

      .knoww-portfolio-table-panel {
        overflow: hidden;
        border: 1px solid var(--pf-line);
        border-radius: 14px;
        background: var(--pf-surface);
      }

      .knoww-portfolio-table-panel[hidden] {
        display: none;
      }

      /* ---- History pager ---- */
      .knoww-portfolio-history-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 40px;
        border-top: 1px solid var(--pf-line);
        padding: 8px 12px;
      }

      .knoww-portfolio-history-controls span {
        color: var(--pf-dim);
        font: 500 10px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .knoww-portfolio-history-controls div {
        display: flex;
        gap: 6px;
      }

      .knoww-portfolio-history-button {
        display: grid;
        place-items: center;
        width: 28px;
        height: 26px;
        border: 1px solid var(--pf-line-2);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.82);
        cursor: pointer;
        transition: background 0.13s ease, border-color 0.13s ease;
      }

      .knoww-portfolio-history-button:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.28);
      }

      .knoww-portfolio-history-button:disabled {
        cursor: default;
        opacity: 0.34;
      }

      .knoww-portfolio-history-button svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2;
      }

      /* ---- Rows ---- */
      .knoww-portfolio-row {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr) auto;
        gap: 11px;
        align-items: center;
        border-bottom: 1px solid var(--pf-line);
        padding: 11px 12px;
        color: inherit;
        text-decoration: none;
        transition: background 0.12s ease;
      }

      .knoww-portfolio-row:last-child {
        border-bottom: 0;
      }

      /* Rows that open the market on knoww.app are anchors — only these get the
         pointer + hover affordance so non-linked rows don't look clickable.
         Open-order rows wrap their content in an inner .order-link instead so
         the Cancel button can sit outside the anchor; :has lets the whole row
         still highlight when that inner link is hovered/focused. */
      .knoww-portfolio-row.is-link,
      .knoww-portfolio-order-link.is-link {
        cursor: pointer;
      }

      .knoww-portfolio-row.is-link:hover,
      .knoww-portfolio-row:has(.knoww-portfolio-order-link.is-link:hover) {
        background: rgba(255, 255, 255, 0.03);
      }

      .knoww-portfolio-row.is-link:focus-visible,
      .knoww-portfolio-order-link.is-link:focus-visible {
        outline: none;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px var(--pf-line-2);
      }

      .knoww-portfolio-row.compact {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .knoww-portfolio-position-item {
        border-bottom: 1px solid var(--pf-line);
      }

      .knoww-portfolio-position-item:last-child {
        border-bottom: 0;
      }

      .knoww-portfolio-position-trigger {
        appearance: none;
        width: 100%;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        margin: 0;
        text-align: left;
        cursor: pointer;
      }

      .knoww-portfolio-position-trigger:hover,
      .knoww-portfolio-position-item.is-expanded
        .knoww-portfolio-position-trigger {
        background: rgba(255, 255, 255, 0.03);
      }

      .knoww-portfolio-position-trigger:focus-visible {
        outline: none;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px var(--pf-line-2);
      }

      .knoww-portfolio-position-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr) 34px;
        gap: 8px;
        padding: 0 12px 11px;
      }

      .knoww-portfolio-position-actions[hidden] {
        display: none;
      }

      .knoww-portfolio-position-action {
        appearance: none;
        min-width: 0;
        height: 28px;
        border: 1px solid var(--pf-line-2);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--pf-hi);
        cursor: pointer;
        font: 700 9px/1 var(--pf-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
        transition: background 0.14s ease, border-color 0.14s ease,
          color 0.14s ease, opacity 0.14s ease;
      }

      .knoww-portfolio-position-action:hover:not(:disabled) {
        border-color: rgba(255, 255, 255, 0.32);
        background: rgba(255, 255, 255, 0.08);
      }

      .knoww-portfolio-position-action.danger {
        border-color: rgba(251, 113, 133, 0.45);
        background: rgba(251, 113, 133, 0.12);
        color: #ffd7df;
      }

      .knoww-portfolio-position-action.danger.is-confirming {
        border-color: rgba(251, 113, 133, 0.68);
        background: rgba(251, 113, 133, 0.24);
        color: #fff5f7;
      }

      .knoww-portfolio-position-action.icon {
        padding: 0;
      }

      .knoww-portfolio-position-action:disabled {
        cursor: default;
        opacity: 0.48;
      }

      .knoww-portfolio-position-error {
        padding: 0 12px 11px;
        color: var(--pf-neg);
        font: 600 10px/1.35 var(--pf-sans);
      }

      .knoww-portfolio-position-confirm {
        padding: 0 12px 8px;
        color: rgba(255, 255, 255, 0.82);
        font: 600 11px/1.3 var(--pf-sans);
      }

      /* Open-order row: [market link][cancel]. The link reuses the compact
         two-column layout internally. */
      .knoww-portfolio-order {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .knoww-portfolio-order-link {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 11px;
        align-items: center;
        min-width: 0;
        color: inherit;
        text-decoration: none;
      }

      .knoww-portfolio-cancel {
        flex: none;
        align-self: center;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* Fixed width so swapping the label (Cancel → Confirm → … → Failed)
           never changes the button size or shifts the row. */
        min-width: 70px;
        height: 24px;
        padding: 0 10px;
        border: 1px solid var(--pf-line-2);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--pf-mid);
        cursor: pointer;
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        white-space: nowrap;
        transition: color 0.14s ease, background 0.14s ease,
          border-color 0.14s ease;
      }

      .knoww-portfolio-cancel:hover {
        color: var(--pf-hi);
        border-color: rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.08);
      }

      .knoww-portfolio-cancel.is-armed {
        color: #fff;
        border-color: rgba(251, 113, 133, 0.62);
        background: rgba(251, 113, 133, 0.22);
      }

      .knoww-portfolio-cancel.is-busy {
        opacity: 0.6;
        cursor: default;
      }

      .knoww-portfolio-cancel.is-error {
        color: var(--pf-neg);
        border-color: rgba(251, 113, 133, 0.5);
        background: rgba(251, 113, 133, 0.12);
      }

      .knoww-portfolio-row-icon {
        width: 32px;
        height: 32px;
        overflow: hidden;
        border-radius: 9px;
        border: 1px solid var(--pf-line);
        background: rgba(255, 255, 255, 0.06);
      }

      .knoww-portfolio-row-icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .knoww-portfolio-row-icon span {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        color: var(--pf-mid);
        font: 600 12px/1 var(--pf-mono);
        text-transform: uppercase;
      }

      .knoww-portfolio-row-main {
        min-width: 0;
      }

      .knoww-portfolio-row-title {
        overflow: hidden;
        color: rgba(255, 255, 255, 0.92);
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        font: 600 13px/1.3 var(--pf-sans);
      }

      .knoww-portfolio-row-meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 4px;
        color: var(--pf-dim);
        font: 500 10.5px/1.2 var(--pf-mono);
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .knoww-portfolio-row-value {
        display: grid;
        gap: 3px;
        justify-items: end;
        min-width: 72px;
        text-align: right;
      }

      .knoww-portfolio-row-value strong {
        color: var(--pf-hi);
        font: 500 13px/1.1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      .knoww-portfolio-row-value span {
        color: var(--pf-mid);
        font: 500 10.5px/1.1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      /* ---- Empty / loading ---- */
      .knoww-portfolio-empty,
      .knoww-portfolio-loading,
      .knoww-portfolio-signed-out {
        display: grid;
        gap: 7px;
        place-items: center;
        min-height: 168px;
        padding: 30px 20px;
        text-align: center;
      }

      .knoww-portfolio-loading {
        color: var(--pf-mid);
        font: 500 11px/1.4 var(--pf-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .knoww-portfolio-loading::before {
        content: "";
        width: 22px;
        height: 22px;
        margin-bottom: 4px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.12);
        border-top-color: var(--pf-pos);
        animation: knoww-pf-spin 0.8s linear infinite;
      }

      @keyframes knoww-pf-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .knoww-portfolio-loading::before {
          animation: none;
        }
      }

      .knoww-pf-empty-mark {
        display: grid;
        place-items: center;
        width: 42px;
        height: 42px;
        margin-bottom: 4px;
        border: 1px solid var(--pf-line-2);
        border-radius: 13px;
        background: var(--pf-surface-2);
        color: var(--pf-dim);
      }

      .knoww-pf-empty-mark svg {
        width: 19px;
        height: 19px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.6;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-empty-title {
        margin: 0;
        font: 500 17px/1.2 var(--pf-display);
        font-style: italic;
        letter-spacing: 0.01em;
        color: rgba(255, 255, 255, 0.84);
      }

      .knoww-pf-empty-sub {
        max-width: 230px;
        color: var(--pf-dim);
        font: 500 11px/1.5 var(--pf-mono);
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .knoww-pf-empty-sub.is-error {
        color: var(--pf-neg);
        letter-spacing: 0.01em;
        text-transform: none;
      }

      .knoww-portfolio-signed-out .knoww-portfolio-wallets,
      .knoww-portfolio-signed-out .knoww-portfolio-actions {
        margin-top: 8px;
      }

      .knoww-pf-stale {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        padding: 8px 10px;
        border: 1px solid var(--pf-line-2);
        border-radius: 11px;
        background: var(--pf-surface-2);
        color: var(--pf-mid);
      }

      .knoww-pf-stale svg {
        flex: 0 0 auto;
        width: 14px;
        height: 14px;
        fill: none;
        stroke: var(--pf-neg);
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-stale-text {
        flex: 1 1 auto;
        font: 500 10px/1.4 var(--pf-mono);
        letter-spacing: 0.02em;
      }

      .knoww-pf-stale-retry {
        flex: 0 0 auto;
        padding: 4px 9px;
        border: 1px solid var(--pf-line-2);
        border-radius: 8px;
        background: transparent;
        color: rgba(255, 255, 255, 0.82);
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .knoww-pf-stale-retry:hover {
        background: rgba(255, 255, 255, 0.06);
      }

      .positive {
        color: #36d399 !important;
      }

      .negative {
        color: #fb7185 !important;
      }

`;

export interface PortfolioSidepanelHandle {
  start(): void;
  handleClick(event: Event): boolean;
  handleChange(event: Event): boolean;
  handleInput(event: Event): boolean;
  getData(): PortfolioSnapshot | null;
  load(force?: boolean): Promise<void>;
  renderPortfolio(): void;
  invalidate(): void;
  clearSession(): void;
  onWalletConnected(): void;
  showView(view: SidePanelView): void;
  onCredentialsUpdated(): void;
  dispose(): void;
}

export interface PortfolioSnapshot {
  address: string;
  ownerAddress: string;
  walletMode: TradingWalletMode;
  hasTradingWallet: boolean;
  hasTradingCredentials: boolean;
  hasApproval: boolean;
  approvalReadStatus: TradingSetupAllowanceReadStatus;
  cashBalance: number;
}

export interface PortfolioSidepanelDependencies {
  funding: PortfolioFundingPort;
  setup: PortfolioSetupPort;
}

interface ResolvedPortfolioWallet {
  address: string;
  walletMode: TradingWalletMode;
  isDeployed: boolean;
}

interface PortfolioFundingPort {
  resetAccount(): void;
  isOpen(): boolean;
  renderActions(): string;
  handleChange(event: Event): boolean;
  handleInput(event: Event): boolean;
  handleClick(event: Event): boolean;
}

interface PortfolioSetupPort {
  resolvePreferredWalletMode(address: string): Promise<TradingWalletMode>;
  getTradingStatus(address: string): Promise<{ hasCredentials: boolean }>;
  hasApproval(address: string): Promise<boolean | null>;
  renderSurface(data: PortfolioSnapshot): {
    html: string;
    mode: "complete" | "banner" | "wizard";
  };
  reset(): void;
  renderSignedOut(): string;
  prepareSignedOut(): Promise<void>;
  getSessionAddress(): Promise<string | null>;
  resolveWallet(address: string): Promise<ResolvedPortfolioWallet>;
  shouldPreserveDegradedApproval(): boolean;
  reconcileLoadedData(
    data: PortfolioSnapshot,
    isCurrent: () => boolean
  ): Promise<boolean>;
  handleClick(event: Event): boolean;
  clearConnectionErrors(): void;
  clearTradingError(): void;
}

export function createPortfolioSidepanel(
  root: HTMLElement,
  dependencies: PortfolioSidepanelDependencies
): PortfolioSidepanelHandle {
  type PortfolioPosition = {
    id: string;
    asset?: string;
    conditionId?: string;
    outcomeIndex?: number;
    outcome: string;
    size: number;
    currentValue: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
    negRisk?: boolean;
    market: {
      title: string;
      eventSlug?: string;
      slug?: string;
      icon?: string;
    };
  };

  type PortfolioTrade = {
    id: string;
    timestamp: string;
    type: "TRADE" | "REDEEM" | "MERGE" | "SPLIT";
    side: "BUY" | "SELL" | null;
    size: number;
    price: number;
    usdcAmount: number;
    outcome: string;
    market: {
      title: string;
      eventSlug?: string;
      slug?: string;
      icon?: string;
    };
  };

  type PortfolioOpenOrder = {
    id: string;
    tokenId: string;
    side: "BUY" | "SELL";
    price: number;
    size: number;
    filledSize: number;
    remainingSize: number;
    status: string;
    expiration: string;
    market?: {
      title: string;
      outcome: string;
      eventSlug?: string;
      slug?: string;
      icon?: string;
    };
  };

  type PortfolioPositionsResponse = {
    positions?: PortfolioPosition[];
    summary?: {
      totalValue?: number;
      totalPnl?: number;
      totalUnrealizedPnl?: number;
      positionCount?: number;
    };
  };

  type PortfolioTradesResponse = {
    trades?: PortfolioTrade[];
    summary?: {
      totalVolume?: number;
      tradeCount?: number;
    };
  };

  type PortfolioDetailsResponse = {
    details?: {
      pnl?: number;
      volume?: number;
      rank?: number;
      userName?: string;
    } | null;
  };

  type PortfolioBalanceResponse = {
    balance?: number;
  };

  type PortfolioOpenOrdersResponse = {
    orders?: PortfolioOpenOrder[];
    count?: number;
  };

  type PortfolioData = {
    address: string;
    ownerAddress: string;
    walletMode: TradingWalletMode;
    hasTradingWallet: boolean;
    hasTradingCredentials: boolean;
    hasApproval: boolean; // full setup approval, with scalar allowance fallback
    approvalReadStatus: TradingSetupAllowanceReadStatus;
    cashBalance: number;
    openOrders: PortfolioOpenOrdersResponse;
    positions: PortfolioPositionsResponse;
    trades: PortfolioTradesResponse;
    details: PortfolioDetailsResponse;
  };

  type PortfolioTableView = "positions" | "orders" | "history";

  const PORTFOLIO_REFRESH_INTERVAL_MS = 30_000;
  const PORTFOLIO_POSITIONS_FETCH_LIMIT = 50;
  const PORTFOLIO_POSITIONS_DISPLAY_LIMIT = 5;
  const PORTFOLIO_HISTORY_PAGE_SIZE = 5;
  const PORTFOLIO_HISTORY_FETCH_LIMIT = 25;
  const KNOWW_APP_URL = __DEV_MODE__
    ? "http://localhost:8000"
    : "https://knoww.app";

  const fundingUi = dependencies.funding;
  const setupUi = dependencies.setup;
  let portfolioLoaded = false;
  let portfolioLoadGeneration = 0;
  let portfolioTableView: PortfolioTableView = "positions";
  let portfolioHistoryPage = 0;
  let latestPortfolioData: PortfolioData | null = null;
  let portfolioExpandedPositionId: string | null = null;
  let portfolioConfirmingSellPositionId: string | null = null;
  let portfolioSellingPositionId: string | null = null;
  let portfolioSellErrorPositionId: string | null = null;
  let portfolioSellError: string | null = null;
  let portfolioRefreshTimer: ReturnType<typeof setInterval> | null = null;
  const onPortfolioVisibilityChange = (): void => {
    if (document.visibilityState === "visible") refreshVisiblePortfolio();
  };
  // Inline two-step confirm for cancelling an open order: the first tap "arms"
  // the button (turns it into a red Confirm), a second tap commits, and a timer
  // auto-reverts it so a stray tap never reaches the live order book.
  let armedCancelButton: HTMLButtonElement | null = null;
  let cancelConfirmTimer: ReturnType<typeof setTimeout> | null = null;

  function openPortfolioPage(): void {
    window.open(`${KNOWW_APP_URL}/portfolio`, "_blank", "noopener,noreferrer");
  }

  // Disconnect the connected wallet from the portfolio view — mirrors the
  // trading-panel header action. The worker's `auth:logout` clears the knoww.app
  // session + cached trading credentials and broadcasts
  // TRADING_SESSION_DISCONNECTED_MESSAGE, which the listener below turns into a
  // reset to the signed-out screen via clearPortfolioSessionState(). We never
  // throw here: the worker clears local state in its own `finally`, so even a
  // failed network logout still tears the session down.

  function renderPortfolioContent_inPlace(): void {
    const container = root.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    if (container && latestPortfolioData) {
      container.innerHTML = renderPortfolioContent(latestPortfolioData);
    }
  }

  function findPortfolioPosition(positionId: string): PortfolioPosition | null {
    return (
      latestPortfolioData?.positions.positions?.find(
        (position) => position.id === positionId
      ) ?? null
    );
  }

  function togglePortfolioPositionActions(positionId: string): void {
    portfolioExpandedPositionId =
      portfolioExpandedPositionId === positionId ? null : positionId;
    portfolioConfirmingSellPositionId = null;
    portfolioSellErrorPositionId = null;
    portfolioSellError = null;
    renderPortfolioContent_inPlace();
  }

  function closePortfolioPositionActions(): void {
    portfolioExpandedPositionId = null;
    portfolioConfirmingSellPositionId = null;
    portfolioSellErrorPositionId = null;
    portfolioSellError = null;
    renderPortfolioContent_inPlace();
  }

  function requestPortfolioPositionSell(positionId: string): void {
    portfolioExpandedPositionId = positionId;
    portfolioConfirmingSellPositionId = positionId;
    portfolioSellErrorPositionId = null;
    portfolioSellError = null;
    renderPortfolioContent_inPlace();
  }

  function cancelPortfolioPositionSell(): void {
    portfolioConfirmingSellPositionId = null;
    portfolioSellErrorPositionId = null;
    portfolioSellError = null;
    renderPortfolioContent_inPlace();
  }

  function viewPortfolioPosition(position: PortfolioPosition): void {
    const url = portfolioMarketUrl(position.market);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  function getPortfolioSellErrorMessage(error: unknown): string {
    const message =
      error instanceof Error ? error.message : String(error || "");
    if (message === "NO_CONTENT_TAB") {
      return "Open knoww.app in a tab to sign this sale.";
    }
    if (message && !/\n\s*at\s/.test(message)) return message;
    return "Could not sell this position.";
  }

  function setPortfolioSellError(positionId: string, error: unknown): void {
    portfolioSellingPositionId = null;
    portfolioSellErrorPositionId = positionId;
    portfolioSellError = getPortfolioSellErrorMessage(error);
    renderPortfolioContent_inPlace();
  }

  async function sellPortfolioPosition(
    position: PortfolioPosition
  ): Promise<void> {
    const data = latestPortfolioData;
    if (!data) return;

    if (
      !position.asset ||
      !position.conditionId ||
      typeof position.outcomeIndex !== "number" ||
      !Number.isFinite(position.size) ||
      position.size <= 0
    ) {
      setPortfolioSellError(
        position.id,
        "This position cannot be sold from the side panel."
      );
      return;
    }

    portfolioExpandedPositionId = position.id;
    portfolioConfirmingSellPositionId = position.id;
    portfolioSellingPositionId = position.id;
    portfolioSellErrorPositionId = null;
    portfolioSellError = null;
    renderPortfolioContent_inPlace();

    try {
      const walletMode = await setupUi.resolvePreferredWalletMode(
        data.ownerAddress
      );
      if (!walletMode) throw new Error("Portfolio setup is unavailable.");
      const response = await sendRuntimeMessage({
        type: "KNOWW_SELL_PORTFOLIO_POSITION",
        address: data.ownerAddress,
        proxyAddress: data.address,
        walletMode,
        tokenId: position.asset,
        conditionId: position.conditionId,
        outcomeIndex: position.outcomeIndex,
        size: position.size,
        negRisk: position.negRisk === true,
      });

      if (response.ok === false) {
        throw new Error(response.error || "Could not sell this position.");
      }

      portfolioExpandedPositionId = null;
      portfolioConfirmingSellPositionId = null;
      portfolioSellingPositionId = null;
      portfolioSellErrorPositionId = null;
      portfolioSellError = null;
      await loadPortfolio(true);
    } catch (error) {
      setPortfolioSellError(position.id, error);
    }
  }

  async function getPortfolioCashBalance(
    portfolioAddress: string
  ): Promise<number> {
    const response = await sendRuntimeMessage({
      type: "trading:get-balance",
      proxyAddress: portfolioAddress,
    });
    if (response.ok === false) return 0;

    const payload = response.data as PortfolioBalanceResponse | undefined;
    return typeof payload?.balance === "number" ? payload.balance : 0;
  }

  type RawPortfolioOpenOrder = {
    id?: string;
    order_id?: string;
    maker?: string;
    asset_id?: string;
    token_id?: string;
    side?: string;
    price?: string | number;
    original_size?: string | number;
    size_matched?: string | number;
    status?: string;
    created_at?: string | number;
    expiration?: string | number;
  };

  type MarketByTokenResponse = {
    success?: boolean;
    market?: {
      question?: string;
      outcome?: string;
      eventSlug?: string;
      slug?: string;
      icon?: string;
    };
  };

  function normalizePortfolioOpenOrder(
    order: RawPortfolioOpenOrder
  ): PortfolioOpenOrder {
    const size = Number(order.original_size || 0);
    const filledSize = Number(order.size_matched || 0);
    const side = String(order.side || "BUY").toUpperCase();
    return {
      id: order.id || order.order_id || "",
      tokenId: order.asset_id || order.token_id || "",
      side: side === "SELL" ? "SELL" : "BUY",
      price: Number(order.price || 0),
      size,
      filledSize,
      remainingSize: Math.max(0, size - filledSize),
      status: String(order.status || "LIVE").toUpperCase(),
      expiration: String(order.expiration || "0"),
    };
  }

  async function getPortfolioOpenOrders(
    ownerAddress: string
  ): Promise<PortfolioOpenOrdersResponse> {
    const response = await sendRuntimeMessage({
      type: "KNOWW_GET_PORTFOLIO_OPEN_ORDERS",
      address: ownerAddress,
    });
    if (response.ok === false) return { orders: [], count: 0 };

    const payload = response.data as { orders?: unknown; count?: unknown };
    const rawOrders = Array.isArray(payload?.orders)
      ? (payload.orders as RawPortfolioOpenOrder[])
      : [];
    const orders = rawOrders.map(normalizePortfolioOpenOrder);
    const tokenIds = Array.from(
      new Set(orders.map((order) => order.tokenId).filter(Boolean))
    );
    const marketEntries = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const market = await fetchKnowwJson<MarketByTokenResponse>(
          `/api/markets/by-token/${encodeURIComponent(tokenId)}`,
          KNOWW_APP_URL
        );
        return [tokenId, market?.market] as const;
      })
    );
    const marketsByToken = new Map(marketEntries.filter((entry) => entry[1]));

    return {
      count: typeof payload?.count === "number" ? payload.count : orders.length,
      orders: orders.map((order) => {
        const market = marketsByToken.get(order.tokenId);
        return market
          ? {
              ...order,
              market: {
                title: market.question || formatAddress(order.tokenId),
                outcome: market.outcome || "",
                ...(market.eventSlug ? { eventSlug: market.eventSlug } : {}),
                ...(market.slug ? { slug: market.slug } : {}),
                ...(market.icon ? { icon: market.icon } : {}),
              },
            }
          : order;
      }),
    };
  }

  async function cancelPortfolioOpenOrder(
    ownerAddress: string,
    orderId: string
  ): Promise<{ ok: boolean; error?: string }> {
    const response = await sendRuntimeMessage({
      type: "KNOWW_CANCEL_PORTFOLIO_OPEN_ORDER",
      address: ownerAddress,
      orderId,
    });
    if (response.ok === false) {
      return { ok: false, error: response.error };
    }
    return { ok: true };
  }

  function disarmCancelOrder(): void {
    if (cancelConfirmTimer !== null) {
      clearTimeout(cancelConfirmTimer);
      cancelConfirmTimer = null;
    }
    const button = armedCancelButton;
    armedCancelButton = null;
    if (button) {
      button.classList.remove("is-armed");
      const label = button.querySelector("[data-cancel-label]");
      if (label) label.textContent = "Cancel";
      button.setAttribute("aria-label", "Cancel order");
    }
  }

  function armCancelOrder(button: HTMLButtonElement): void {
    disarmCancelOrder();
    armedCancelButton = button;
    button.classList.add("is-armed");
    const label = button.querySelector("[data-cancel-label]");
    if (label) label.textContent = "Confirm";
    button.setAttribute("aria-label", "Confirm cancel order");
    cancelConfirmTimer = setTimeout(disarmCancelOrder, 3000);
  }

  function handleCancelOrderClick(button: HTMLButtonElement): void {
    if (button.disabled) return;
    if (button === armedCancelButton) {
      void performOrderCancel(button);
      return;
    }
    armCancelOrder(button);
  }

  async function performOrderCancel(button: HTMLButtonElement): Promise<void> {
    const orderId = button.dataset.orderId;
    const ownerAddress = button.dataset.ownerAddress;
    if (!orderId || !ownerAddress) return;

    if (cancelConfirmTimer !== null) {
      clearTimeout(cancelConfirmTimer);
      cancelConfirmTimer = null;
    }
    armedCancelButton = null;
    button.disabled = true;
    button.classList.remove("is-armed", "is-error");
    button.classList.add("is-busy");
    const label = button.querySelector("[data-cancel-label]");
    // Keep the label short so it fits the fixed button width without overflow.
    if (label) label.textContent = "…";

    const result = await cancelPortfolioOpenOrder(ownerAddress, orderId);
    if (result.ok) {
      // Reload so the cancelled order disappears and any BUY collateral it was
      // reserving is reflected back in the cash/positions figures.
      await loadPortfolio(true);
      return;
    }

    // Surface the failure on the button and keep the row so the user can retry.
    button.classList.remove("is-busy");
    button.classList.add("is-error");
    button.disabled = false;
    if (label) label.textContent = "Failed";
    button.title = result.error || "Could not cancel order.";
    cancelConfirmTimer = setTimeout(() => {
      button.classList.remove("is-error");
      if (label) label.textContent = "Cancel";
      button.removeAttribute("title");
    }, 4000);
  }

  async function fetchPortfolioData(
    ownerAddress: string,
    address: string,
    wallet: ResolvedPortfolioWallet,
    previous: PortfolioData | null,
    options: { preserveDegradedApproval?: boolean } = {}
  ): Promise<PortfolioData> {
    const hasTradingWallet = hasDeployedTradingWallet({
      address: ownerAddress,
      proxyAddress: wallet.address,
      walletMode: wallet.walletMode,
      isDeployed: wallet.isDeployed,
    });

    const user = encodeURIComponent(address);
    // One concurrent batch: the approval fan-out and open-orders fetch used to
    // run as serial stages after this Promise.all, roughly doubling
    // time-to-render. Open orders chain off the (fast, local) credentials
    // check; everything else is independent.
    const tradingStatusPromise = setupUi.getTradingStatus(ownerAddress);
    const [
      positions,
      trades,
      details,
      tradingStatus,
      cashBalance,
      approval,
      openOrders,
    ] = await Promise.all([
      fetchKnowwJson<PortfolioPositionsResponse>(
        `/api/user/positions?user=${user}&limit=${PORTFOLIO_POSITIONS_FETCH_LIMIT}&offset=0&active=true`,
        KNOWW_APP_URL
      ),
      fetchKnowwJson<PortfolioTradesResponse>(
        `/api/user/trades?user=${user}&limit=${PORTFOLIO_HISTORY_FETCH_LIMIT}&offset=0`,
        KNOWW_APP_URL
      ),
      fetchKnowwJson<PortfolioDetailsResponse>(
        `/api/user/details?user=${user}&timePeriod=all`,
        KNOWW_APP_URL
      ),
      tradingStatusPromise,
      getPortfolioCashBalance(address),
      hasTradingWallet
        ? setupUi.hasApproval(wallet.address)
        : Promise.resolve<boolean | null>(false),
      tradingStatusPromise.then((status) =>
        status.hasCredentials && hasTradingWallet
          ? getPortfolioOpenOrders(ownerAddress)
          : { orders: [], count: 0 }
      ),
    ]);

    // A `null` here means the upstream call returned a non-2xx (timeout, 5xx,
    // rate-limit) — a *transient failure*, NOT an empty account. An account with
    // no activity still returns 200 (positions/trades as empty arrays, details as
    // `{ details: null }`). If a hero-critical call failed, throw so loadPortfolio
    // keeps the last good snapshot instead of rendering a misleading $0 portfolio.
    if (positions === null || details === null) {
      throw new Error("portfolio-refresh-failed");
    }

    let hasApproval = false;
    let approvalReadStatus: TradingSetupAllowanceReadStatus = "complete";
    if (hasTradingWallet) {
      if (approval === null) {
        approvalReadStatus = "degraded";
        hasApproval =
          options.preserveDegradedApproval &&
          previous &&
          previous.address === address
            ? previous.hasApproval
            : false;
      } else {
        hasApproval = approval;
      }
    }

    // History is non-critical: if only the trades call blipped, reuse the last
    // good history (for the same address) rather than emptying the list.
    const fallbackTrades =
      previous && previous.address === address ? previous.trades : undefined;

    return {
      address,
      ownerAddress,
      walletMode: wallet.walletMode,
      hasTradingWallet,
      hasTradingCredentials: tradingStatus.hasCredentials,
      hasApproval,
      approvalReadStatus,
      cashBalance,
      openOrders,
      details,
      positions,
      trades: trades ?? fallbackTrades ?? {},
    };
  }

  function renderPortfolioSummary(data: PortfolioData): string {
    const summary = data.positions.summary || {};
    const details = data.details.details;
    const totalPnl =
      details?.pnl ?? summary.totalPnl ?? summary.totalUnrealizedPnl;
    const pnl = Number.isFinite(totalPnl) ? Number(totalPnl) : 0;
    const direction = pnl > 0 ? "is-up" : pnl < 0 ? "is-down" : "is-flat";
    const deltaClass = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "flat";
    const arrow =
      pnl === 0
        ? `<svg class="knoww-pf-delta-arrow" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.1" width="8" height="1.8" rx="0.9"></rect></svg>`
        : `<svg class="knoww-pf-delta-arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 10.5H1z"></path></svg>`;

    return `
    <div class="knoww-pf-hero ${direction}">
      <div class="knoww-pf-hero-top">
        <div class="knoww-pf-id">
          <span class="knoww-pf-kicker">Portfolio</span>
          <span class="knoww-pf-name">${escapeHtml(
            details?.userName || formatAddress(data.address)
          )}</span>
        </div>
        <div class="knoww-pf-hero-actions">
          <button type="button" class="knoww-portfolio-open" data-open-portfolio>
            <span>Open</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"></path></svg>
          </button>
          <button type="button" class="knoww-pf-hero-disconnect" data-portfolio-switch-wallet title="Switch wallet" aria-label="Switch wallet">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3 4 7l4 4"></path><path d="M4 7h16"></path><path d="m16 21 4-4-4-4"></path><path d="M20 17H4"></path></svg>
          </button>
          <button type="button" class="knoww-pf-hero-disconnect" data-portfolio-disconnect title="Disconnect wallet" aria-label="Disconnect wallet">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          </button>
        </div>
      </div>
      <div class="knoww-pf-hero-value">
        <span class="knoww-pf-hero-label">Position value</span>
        <strong class="knoww-pf-hero-num">${escapeHtml(
          formatMoney(summary.totalValue)
        )}</strong>
        <div class="knoww-pf-delta ${deltaClass}">
          ${arrow}
          <span class="knoww-pf-delta-num">${escapeHtml(
            formatSignedMoney(pnl)
          )}</span>
          <span class="knoww-pf-delta-label">All-time P/L</span>
        </div>
      </div>
      <div class="knoww-pf-strip">
        <div class="knoww-pf-strip-cell">
          <span class="knoww-pf-strip-label">Positions</span>
          <strong>${escapeHtml(
            formatCompactNumber(summary.positionCount)
          )}</strong>
        </div>
        <div class="knoww-pf-strip-cell">
          <span class="knoww-pf-strip-label">Volume</span>
          <strong>${escapeHtml(formatMoney(details?.volume))}</strong>
        </div>
        <div class="knoww-pf-strip-cell">
          <span class="knoww-pf-strip-label">Cash</span>
          <strong>${escapeHtml(formatMoney(data.cashBalance))}</strong>
        </div>
      </div>
    </div>
  `;
  }

  function renderPortfolioEmpty(
    title: string,
    sub: string,
    iconPath: string
  ): string {
    return `
    <div class="knoww-portfolio-empty">
      <div class="knoww-pf-empty-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">${iconPath}</svg>
      </div>
      <p class="knoww-pf-empty-title">${escapeHtml(title)}</p>
      <span class="knoww-pf-empty-sub">${escapeHtml(sub)}</span>
    </div>
  `;
  }

  // Build the knoww.app event-detail URL for a market row. Mirrors the web app,
  // which links positions/trades to `/events/detail/{eventSlug || slug}` (the
  // market slug 308-redirects to the same page). Returns null when neither slug
  // is present, in which case the row renders as a non-interactive element.
  function portfolioMarketUrl(market: {
    eventSlug?: string;
    slug?: string;
  }): string | null {
    const slug = market.eventSlug || market.slug;
    return slug
      ? `${KNOWW_APP_URL}/events/detail/${encodeURIComponent(slug)}`
      : null;
  }

  // A market row is an anchor when it links somewhere (native new-tab open,
  // keyboard- and middle-click-friendly) and a plain div otherwise.
  function portfolioRowOpenTag(url: string | null, modifier = ""): string {
    const className = `knoww-portfolio-row${modifier}`;
    return url
      ? `<a class="${className} is-link" href="${escapeHtml(
          url
        )}" target="_blank" rel="noopener noreferrer">`
      : `<div class="${className}">`;
  }

  function portfolioRowCloseTag(url: string | null): string {
    return url ? "</a>" : "</div>";
  }

  function renderCompactPositions(positions: PortfolioPosition[] = []): string {
    if (positions.length === 0) {
      return renderPortfolioEmpty(
        "No active positions",
        "Open trades will surface here as you take them.",
        `<path d="M4 19V5M4 19h16M8 16v-5M13 16V8M18 16v-3"></path>`
      );
    }

    return positions
      .slice(0, PORTFOLIO_POSITIONS_DISPLAY_LIMIT)
      .map((position) => {
        const pnlClass = position.unrealizedPnl >= 0 ? "positive" : "negative";
        const url = portfolioMarketUrl(position.market);
        const expanded = portfolioExpandedPositionId === position.id;
        const confirming = portfolioConfirmingSellPositionId === position.id;
        const selling = portfolioSellingPositionId === position.id;
        const sellError =
          portfolioSellErrorPositionId === position.id
            ? portfolioSellError
            : null;
        return `
        <div class="knoww-portfolio-position-item ${expanded ? "is-expanded" : ""}">
          <button
            type="button"
            class="knoww-portfolio-row knoww-portfolio-position-trigger"
            data-portfolio-position-toggle
            data-position-id="${escapeHtml(position.id)}"
            aria-expanded="${String(expanded)}"
          >
            <div class="knoww-portfolio-row-icon">
              ${
                position.market.icon
                  ? `<img src="${escapeHtml(position.market.icon)}" alt="" />`
                  : `<span>${escapeHtml(position.outcome.slice(0, 1))}</span>`
              }
            </div>
            <div class="knoww-portfolio-row-main">
              <div class="knoww-portfolio-row-title">${escapeHtml(
                position.market.title
              )}</div>
              <div class="knoww-portfolio-row-meta">${escapeHtml(
                position.outcome
              )} · ${escapeHtml(formatCompactNumber(position.size))} shares</div>
            </div>
            <div class="knoww-portfolio-row-value">
              <strong>${escapeHtml(formatMoney(position.currentValue))}</strong>
              <span class="${pnlClass}">${escapeHtml(
                `${formatSignedMoney(position.unrealizedPnl)} (${formatPercent(
                  position.unrealizedPnlPercent
                )})`
              )}</span>
            </div>
          </button>
          ${
            confirming
              ? `<div class="knoww-portfolio-position-confirm">${escapeHtml(
                  `Sell ${formatCompactNumber(position.size)} ${position.outcome} shares?`
                )}</div>`
              : ""
          }
          <div class="knoww-portfolio-position-actions" ${expanded ? "" : "hidden"}>
            ${
              confirming
                ? `<button type="button" class="knoww-portfolio-position-action" data-portfolio-position-sell-cancel data-position-id="${escapeHtml(position.id)}">Cancel</button>`
                : `<button type="button" class="knoww-portfolio-position-action" data-portfolio-position-view data-position-id="${escapeHtml(position.id)}" ${url ? "" : "disabled"}>View</button>`
            }
            <button type="button" class="knoww-portfolio-position-action danger ${confirming ? "is-confirming" : ""}" ${confirming ? "data-portfolio-position-sell-confirm" : "data-portfolio-position-sell"} data-position-id="${escapeHtml(position.id)}" ${selling ? "disabled" : ""}>Sell Position</button>
            <button type="button" class="knoww-portfolio-position-action icon" data-portfolio-position-close data-position-id="${escapeHtml(position.id)}">X</button>
          </div>
          ${
            sellError
              ? `<div class="knoww-portfolio-position-error">${escapeHtml(
                  sellError
                )}</div>`
              : ""
          }
        </div>
      `;
      })
      .join("");
  }

  function getPortfolioHistoryMaxPage(tradeCount: number): number {
    return Math.max(0, Math.ceil(tradeCount / PORTFOLIO_HISTORY_PAGE_SIZE) - 1);
  }

  function getClampedPortfolioHistoryPage(tradeCount: number): number {
    return Math.min(
      Math.max(0, portfolioHistoryPage),
      getPortfolioHistoryMaxPage(tradeCount)
    );
  }

  function renderCompactActivity(
    trades: PortfolioTrade[] = [],
    page = portfolioHistoryPage
  ): string {
    if (trades.length === 0) {
      return renderPortfolioEmpty(
        "No recent activity",
        "Your fills, redeems and merges will appear here.",
        `<circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path>`
      );
    }

    const start = page * PORTFOLIO_HISTORY_PAGE_SIZE;
    return trades
      .slice(start, start + PORTFOLIO_HISTORY_PAGE_SIZE)
      .map((trade) => {
        const side = trade.side || trade.type;
        const sideClass = side === "BUY" ? "positive" : "negative";
        const priceCents = new Decimal(trade.price).mul(100).toDecimalPlaces(0);
        const url = portfolioMarketUrl(trade.market);
        return `
        ${portfolioRowOpenTag(url, " compact")}
          <div class="knoww-portfolio-row-main">
            <div class="knoww-portfolio-row-title">${escapeHtml(
              trade.market.title
            )}</div>
            <div class="knoww-portfolio-row-meta">${escapeHtml(
              side
            )} ${escapeHtml(trade.outcome)} · ${escapeHtml(
              formatTradeTime(trade.timestamp)
            )}</div>
          </div>
          <div class="knoww-portfolio-row-value">
            <strong>${escapeHtml(formatMoney(trade.usdcAmount))}</strong>
            <span class="${sideClass}">${escapeHtml(
              `${formatCompactNumber(trade.size)} @ ${priceCents.toString()}¢`
            )}</span>
          </div>
        ${portfolioRowCloseTag(url)}
      `;
      })
      .join("");
  }

  function renderPortfolioHistoryControls(
    trades: PortfolioTrade[] = []
  ): string {
    if (trades.length <= PORTFOLIO_HISTORY_PAGE_SIZE) return "";

    const page = getClampedPortfolioHistoryPage(trades.length);
    const maxPage = getPortfolioHistoryMaxPage(trades.length);
    const start = page * PORTFOLIO_HISTORY_PAGE_SIZE + 1;
    const end = Math.min(
      (page + 1) * PORTFOLIO_HISTORY_PAGE_SIZE,
      trades.length
    );

    return `
    <div class="knoww-portfolio-history-controls">
      <span>${escapeHtml(`${start}-${end} of ${trades.length}`)}</span>
      <div>
        <button
          type="button"
          class="knoww-portfolio-history-button"
          data-portfolio-history-prev
          aria-label="Previous history page"
          ${page === 0 ? "disabled" : ""}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6"></path>
          </svg>
        </button>
        <button
          type="button"
          class="knoww-portfolio-history-button"
          data-portfolio-history-next
          aria-label="Next history page"
          ${page >= maxPage ? "disabled" : ""}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
  }

  function renderCompactOpenOrders(
    orders: PortfolioOpenOrder[] = [],
    ownerAddress = ""
  ): string {
    if (orders.length === 0) {
      return renderPortfolioEmpty(
        "No open orders",
        "Resting limit orders you place will live here.",
        `<path d="M4 7h16M4 12h10M4 17h7"></path>`
      );
    }

    return orders
      .slice(0, 5)
      .map((order) => {
        const sideClass = order.side === "BUY" ? "positive" : "negative";
        const title = order.market?.title || formatAddress(order.tokenId);
        const outcome = order.market?.outcome || "Outcome";
        const total = new Decimal(order.remainingSize).mul(order.price);
        const priceCents = new Decimal(order.price).mul(100).toDecimalPlaces(0);
        const url = order.market ? portfolioMarketUrl(order.market) : null;
        // The market-open link wraps only the row content so the Cancel button
        // can sit beside it without nesting a button inside an anchor.
        const linkOpen = url
          ? `<a class="knoww-portfolio-order-link is-link" href="${escapeHtml(
              url
            )}" target="_blank" rel="noopener noreferrer">`
          : `<div class="knoww-portfolio-order-link">`;
        const linkClose = url ? "</a>" : "</div>";
        return `
        <div class="knoww-portfolio-row compact knoww-portfolio-order">
          ${linkOpen}
            <div class="knoww-portfolio-row-main">
              <div class="knoww-portfolio-row-title">${escapeHtml(title)}</div>
              <div class="knoww-portfolio-row-meta">${escapeHtml(
                order.side
              )} ${escapeHtml(outcome)} · ${escapeHtml(
                formatCompactNumber(order.remainingSize)
              )} open · ${escapeHtml(
                formatOrderExpiration(order.expiration)
              )}</div>
            </div>
            <div class="knoww-portfolio-row-value">
              <strong>${escapeHtml(formatDecimalMoney(total))}</strong>
              <span class="${sideClass}">${escapeHtml(
                `${priceCents.toString()}¢`
              )}</span>
            </div>
          ${linkClose}
          <button
            type="button"
            class="knoww-portfolio-cancel"
            data-cancel-order
            data-order-id="${escapeHtml(order.id)}"
            data-owner-address="${escapeHtml(ownerAddress)}"
            aria-label="Cancel order"
          >
            <span data-cancel-label>Cancel</span>
          </button>
        </div>
      `;
      })
      .join("");
  }

  function renderPortfolioTable(data: PortfolioData): string {
    const positionsCount = data.positions.positions?.length || 0;
    const ordersCount =
      data.openOrders.count || data.openOrders.orders?.length || 0;
    const historyTrades = data.trades.trades || [];
    const historyCount = historyTrades.length;
    const historyPage = getClampedPortfolioHistoryPage(historyCount);
    portfolioHistoryPage = historyPage;
    const tabs: Array<{
      view: PortfolioTableView;
      label: string;
      count: number;
    }> = [
      { view: "positions", label: "Positions", count: positionsCount },
      { view: "orders", label: "Open orders", count: ordersCount },
      { view: "history", label: "History", count: historyCount },
    ];

    return `
    <div class="knoww-portfolio-table">
      <div class="knoww-portfolio-table-tabs" role="tablist" aria-label="Portfolio table">
        ${tabs
          .map((tab) => {
            const selected = portfolioTableView === tab.view;
            return `
              <button
                type="button"
                class="knoww-portfolio-table-tab ${selected ? "is-active" : ""}"
                data-portfolio-table-tab="${tab.view}"
                role="tab"
                aria-selected="${String(selected)}"
              >
                <span>${escapeHtml(tab.label)}</span>
                <strong>${String(tab.count).padStart(2, "0")}</strong>
              </button>
            `;
          })
          .join("")}
      </div>
      <div
        class="knoww-portfolio-table-panel"
        data-portfolio-table-panel="positions"
        role="tabpanel"
        ${portfolioTableView === "positions" ? "" : "hidden"}
      >
        ${renderCompactPositions(data.positions.positions || [])}
      </div>
      <div
        class="knoww-portfolio-table-panel"
        data-portfolio-table-panel="orders"
        role="tabpanel"
        ${portfolioTableView === "orders" ? "" : "hidden"}
      >
        ${
          data.hasTradingWallet && data.hasTradingCredentials
            ? renderCompactOpenOrders(
                data.openOrders.orders || [],
                data.ownerAddress
              )
            : renderPortfolioEmpty(
                data.hasTradingWallet
                  ? "Trading not enabled"
                  : "Trading wallet not ready",
                data.hasTradingWallet
                  ? "Enable trading above to place and track open orders."
                  : "Create your trading wallet above to continue setup.",
                `<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>`
              )
        }
      </div>
      <div
        class="knoww-portfolio-table-panel"
        data-portfolio-table-panel="history"
        role="tabpanel"
        ${portfolioTableView === "history" ? "" : "hidden"}
      >
        ${renderCompactActivity(historyTrades, historyPage)}
        ${renderPortfolioHistoryControls(historyTrades)}
      </div>
    </div>
  `;
  }

  function renderPortfolioContent(
    data: PortfolioData,
    options: { stale?: boolean } = {}
  ): string {
    const setupSurface = setupUi.renderSurface(data);
    const wizardExpanded = setupSurface.mode === "wizard";
    return `
    ${options.stale ? renderPortfolioStaleNotice() : ""}
    ${renderPortfolioSummary(data)}
    ${wizardExpanded ? "" : fundingUi.renderActions()}
    ${setupSurface.html}
    ${wizardExpanded ? "" : renderPortfolioTable(data)}
  `;
  }

  function renderPortfolioStaleNotice(): string {
    return `
    <div class="knoww-pf-stale" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>
      <span class="knoww-pf-stale-text">Couldn't refresh — showing last update</span>
      <button type="button" class="knoww-pf-stale-retry" data-refresh-portfolio>
        Retry
      </button>
    </div>
  `;
  }

  function clearPortfolioSessionState(): void {
    portfolioLoadGeneration++;
    portfolioLoaded = false;
    fundingUi.resetAccount();
    setupUi.reset();
    portfolioHistoryPage = 0;
    latestPortfolioData = null;

    const container = root.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    if (container && !container.hidden) {
      container.innerHTML = setupUi.renderSignedOut();
      void setupUi.prepareSignedOut().then(() => {
        if (!container.hidden) {
          container.innerHTML = setupUi.renderSignedOut();
        }
      });
    }
  }

  async function loadPortfolio(force = false): Promise<void> {
    if (portfolioLoaded && !force) return;
    const container = root?.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    if (!container) return;
    const loadGeneration = ++portfolioLoadGeneration;

    // Only show the loading wipe on the very first load. On a refresh we keep the
    // current render in place so a transient failure never flashes an empty hero.
    const previous = portfolioLoaded ? latestPortfolioData : null;
    if (!previous) {
      container.innerHTML = `
      <div class="knoww-portfolio-loading">Loading portfolio...</div>
    `;
    }

    const address = await setupUi.getSessionAddress();
    if (loadGeneration !== portfolioLoadGeneration) return;
    if (!address) {
      portfolioLoaded = false;
      latestPortfolioData = null;
      setupUi.reset();
      await setupUi.prepareSignedOut();
      if (loadGeneration !== portfolioLoadGeneration) return;
      container.innerHTML = setupUi.renderSignedOut();
      return;
    }

    try {
      const portfolioWallet = await setupUi.resolveWallet(address);
      const data = await fetchPortfolioData(
        address,
        portfolioWallet.address,
        portfolioWallet,
        previous,
        {
          // +1: if this read turns out degraded it will be the (n+1)-th
          // consecutive one — the same window the post-increment checks use.
          preserveDegradedApproval: setupUi.shouldPreserveDegradedApproval(),
        }
      );
      const reconciled = await setupUi.reconcileLoadedData(
        data,
        () =>
          loadGeneration === portfolioLoadGeneration &&
          address === data.ownerAddress
      );
      if (!reconciled || loadGeneration !== portfolioLoadGeneration) return;
      portfolioLoaded = true;
      latestPortfolioData = data;
      container.innerHTML = renderPortfolioContent(data);
    } catch {
      if (loadGeneration !== portfolioLoadGeneration) return;
      // Transient refresh failure (upstream timeout / 5xx / rate-limit). Keep the
      // last good snapshot visible with a subtle "couldn't refresh" notice rather
      // than wiping the hero to $0 — an empty render is indistinguishable from an
      // empty account and is the source of the "data randomly disappears" bug.
      if (previous) {
        portfolioLoaded = true;
        latestPortfolioData = previous;
        container.innerHTML = renderPortfolioContent(previous, { stale: true });
        return;
      }
      portfolioLoaded = false;
      latestPortfolioData = null;
      container.innerHTML = `
      <div class="knoww-portfolio-signed-out">
        <span class="knoww-stack-empty-title">Portfolio unavailable</span>
        <span class="knoww-stack-empty-sub">Couldn't reach the markets data feed. Retry in a moment.</span>
        <button type="button" class="knoww-portfolio-open" data-refresh-portfolio>
          Retry
        </button>
      </div>
    `;
    }
  }

  function setSidepanelView(view: SidePanelView): void {
    if (!root) return;
    applySidepanelView(root, view, () => void loadPortfolio(true));
  }

  async function restoreRequestedSidePanelView(): Promise<void> {
    const view = await consumeRequestedSidePanelView();
    if (view) setSidepanelView(view);
  }

  function refreshVisiblePortfolio(): void {
    const portfolio = root?.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    if (!portfolio || portfolio.hidden || !latestPortfolioData) return;
    if (fundingUi.isOpen()) return;
    void loadPortfolio(true);
  }

  function setPortfolioTableView(view: PortfolioTableView): void {
    portfolioTableView = view;
    const tabs = root?.querySelectorAll<HTMLButtonElement>(
      "[data-portfolio-table-tab]"
    );
    const panels = root?.querySelectorAll<HTMLElement>(
      "[data-portfolio-table-panel]"
    );

    tabs?.forEach((tab) => {
      const selected = tab.dataset.portfolioTableTab === view;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });

    panels?.forEach((panel) => {
      panel.toggleAttribute(
        "hidden",
        panel.dataset.portfolioTablePanel !== view
      );
    });
  }

  function setPortfolioHistoryPage(page: number): void {
    if (!latestPortfolioData) return;

    const trades = latestPortfolioData.trades.trades || [];
    portfolioHistoryPage = Math.min(
      Math.max(0, page),
      getPortfolioHistoryMaxPage(trades.length)
    );

    const panel = root?.querySelector<HTMLElement>(
      '[data-portfolio-table-panel="history"]'
    );
    if (!panel) return;

    panel.innerHTML = `
    ${renderCompactActivity(trades, portfolioHistoryPage)}
    ${renderPortfolioHistoryControls(trades)}
  `;
  }

  function handleClick(event: Event): boolean {
    const cancelButton = (
      event.target as Element | null
    )?.closest<HTMLButtonElement>("[data-cancel-order]");
    if (cancelButton) {
      handleCancelOrderClick(cancelButton);
      return true;
    }
    // Any other click in the panel dismisses a pending cancel confirmation.
    disarmCancelOrder();

    const portfolioPositionClose = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-close]");
    if (portfolioPositionClose) {
      closePortfolioPositionActions();
      return true;
    }

    const portfolioPositionView = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-view]");
    if (portfolioPositionView) {
      const positionId = portfolioPositionView.dataset.positionId;
      const position = positionId ? findPortfolioPosition(positionId) : null;
      if (position) viewPortfolioPosition(position);
      return true;
    }

    const portfolioPositionSellCancel = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-sell-cancel]");
    if (portfolioPositionSellCancel) {
      cancelPortfolioPositionSell();
      return true;
    }

    const portfolioPositionSellConfirm = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-sell-confirm]");
    if (portfolioPositionSellConfirm) {
      const positionId = portfolioPositionSellConfirm.dataset.positionId;
      const position = positionId ? findPortfolioPosition(positionId) : null;
      if (position) void sellPortfolioPosition(position);
      return true;
    }

    const portfolioPositionSell = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-sell]");
    if (portfolioPositionSell) {
      const positionId = portfolioPositionSell.dataset.positionId;
      const position = positionId ? findPortfolioPosition(positionId) : null;
      if (position) requestPortfolioPositionSell(position.id);
      return true;
    }

    const portfolioPositionToggle = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-position-toggle]");
    if (portfolioPositionToggle) {
      const positionId = portfolioPositionToggle.dataset.positionId;
      if (positionId) togglePortfolioPositionActions(positionId);
      return true;
    }

    const historyPrev = (event.target as Element | null)?.closest(
      "[data-portfolio-history-prev]"
    );
    if (historyPrev) {
      setPortfolioHistoryPage(portfolioHistoryPage - 1);
      return true;
    }

    const historyNext = (event.target as Element | null)?.closest(
      "[data-portfolio-history-next]"
    );
    if (historyNext) {
      setPortfolioHistoryPage(portfolioHistoryPage + 1);
      return true;
    }

    const portfolioTableTab = (
      event.target as Element | null
    )?.closest<HTMLElement>("[data-portfolio-table-tab]");
    if (portfolioTableTab) {
      const view = portfolioTableTab.dataset.portfolioTableTab;
      if (view === "positions" || view === "orders" || view === "history") {
        setPortfolioTableView(view);
      }
      return true;
    }

    const portfolioOpen = (event.target as Element | null)?.closest(
      "[data-open-portfolio]"
    );
    if (portfolioOpen) {
      openPortfolioPage();
      return true;
    }

    const portfolioRefresh = (event.target as Element | null)?.closest(
      "[data-refresh-portfolio]"
    );
    if (portfolioRefresh) {
      void loadPortfolio(true);
      return true;
    }
    return false;
  }

  function handleChange(_event: Event): boolean {
    return false;
  }

  function handleInput(_event: Event): boolean {
    return false;
  }

  function startPortfolioLifecycle(): void {
    portfolioRefreshTimer = setInterval(
      () => refreshVisiblePortfolio(),
      PORTFOLIO_REFRESH_INTERVAL_MS
    );
    document.addEventListener("visibilitychange", onPortfolioVisibilityChange);
    void restoreRequestedSidePanelView();
  }

  return {
    start: startPortfolioLifecycle,
    handleClick,
    handleChange,
    handleInput,
    getData: () => latestPortfolioData,
    load: loadPortfolio,
    renderPortfolio: renderPortfolioContent_inPlace,
    invalidate() {
      portfolioLoaded = false;
    },
    clearSession: clearPortfolioSessionState,
    onWalletConnected() {
      portfolioLoaded = false;
      setupUi.clearConnectionErrors();
      const container = root.querySelector<HTMLElement>(
        "[data-sidepanel-portfolio]"
      );
      if (container && !container.hidden && !fundingUi.isOpen()) {
        void loadPortfolio(true);
      }
    },
    showView: setSidepanelView,
    onCredentialsUpdated() {
      portfolioLoaded = false;
      setupUi.clearTradingError();
      const container = root.querySelector<HTMLElement>(
        "[data-sidepanel-portfolio]"
      );
      if (container && !container.hidden) void loadPortfolio(true);
    },
    dispose() {
      disarmCancelOrder();
      if (portfolioRefreshTimer !== null) {
        clearInterval(portfolioRefreshTimer);
        portfolioRefreshTimer = null;
      }
      document.removeEventListener(
        "visibilitychange",
        onPortfolioVisibilityChange
      );
    },
  };
}
