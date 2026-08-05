/**
 * Brand tokens for the Knoww onboarding video.
 * Values copied from apps/web/src/app/styles/marketing.css (dark grade) and
 * apps/web/src/app/styles/landing.css (--kw-accent spark green). The video is
 * mastered in dark mode — it reads better for product UI.
 */

export const theme = {
  // Surfaces (dark, near-black editorial)
  bg: "#0c0a07",
  bgAlt: "#15120d",
  bgCard: "#19150f",
  bgCardHi: "#211b12",

  // Text
  fg: "#f0ebe0",
  fgMuted: "rgba(240, 235, 224, 0.62)",
  fgFaint: "rgba(240, 235, 224, 0.40)",

  // YES / up / brand green — the only accent in this video
  accent: "#4ade80",
  accentText: "#6ee7a0",
  accentInv: "#1f9d57",
  accentSoft: "rgba(74, 222, 128, 0.14)",
  accentGlow: "rgba(74, 222, 128, 0.55)",

  // NO / down — used sparingly (order book, NO chip, one honest red P&L)
  danger: "#f87171",
  dangerText: "#fca5a5",
  dangerSoft: "rgba(248, 113, 113, 0.14)",

  // Hairline rules (masthead motif)
  rule: "rgba(240, 235, 224, 0.18)",
  ruleFaint: "rgba(240, 235, 224, 0.08)",
} as const;

export const fonts = {
  /** Plus Jakarta Sans — headings, kickers, button labels. Upright. */
  sans: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
  /** Fraunces italic — scarce editorial accent. Hero final word + close only. */
  serif: '"Fraunces", Georgia, "Times New Roman", serif',
  /** JetBrains Mono — every price, percentage, odds figure, count, timestamp. */
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", monospace',
} as const;

/** Small-caps kicker style shared by mastheads and scene kickers. */
export const kicker = {
  fontFamily: fonts.sans,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.28em",
};
