import { interpolate, useCurrentFrame } from "remotion";
import { CLAMP, ease, fade } from "../lib/anim";
import { fonts, theme } from "../theme";
import { KMark } from "./KMark";
import { OddsTicker } from "./OddsTicker";
import { Sparkline } from "./Sparkline";

const SPARK = [0.35, 0.42, 0.38, 0.5, 0.46, 0.58, 0.55, 0.64, 0.6, 0.69];

/**
 * The Knoww inline market card — the single source of truth for the product
 * card that appears on host pages (scenes 03, 05, 06). Scenes drive its states
 * purely through frame props so it looks identical everywhere.
 */
export const InlineCard: React.FC<{
  title: string;
  yesPrice: number;
  noPrice: number;
  /** Entrance start frame (masked wipe + shadow lift). */
  enterFrame?: number;
  /** Odds tick: YES swaps to this value at tickFrame with a green flash. */
  tickTo?: number;
  tickFrame?: number;
  /** When set, the trading panel expands at this frame. */
  openFrame?: number;
  /** When set, the order fills at this frame (green check + position chip). */
  fillFrame?: number;
  width?: number;
  /** 0–1: soft green outer bloom — "the market arrives as light". */
  bloom?: number;
}> = ({
  title,
  yesPrice,
  noPrice,
  enterFrame = 0,
  tickTo,
  tickFrame,
  openFrame,
  fillFrame,
  width = 660,
  bloom = 0,
}) => {
  const frame = useCurrentFrame();

  // Entrance: masked wipe (clip reveal) + soft shadow lift.
  const reveal = ease(frame, [enterFrame, enterFrame + 10], [0, 1]);
  const lift = ease(frame, [enterFrame, enterFrame + 12], [18, 0]);

  // Trading panel expand (height + fade).
  const open = openFrame !== undefined;
  const panelH = open ? ease(frame, [openFrame, openFrame + 12], [0, 266]) : 0;
  const panelOpacity = open ? fade(frame, openFrame + 4, openFrame + 16) : 0;

  // Fill state.
  const filled = fillFrame !== undefined;
  const fillPulse = filled
    ? interpolate(
        frame,
        [fillFrame - 1, fillFrame, fillFrame + 12, fillFrame + 22],
        [0, 1, 0.35, 0],
        CLAMP
      )
    : 0;
  const fillOpacity = filled ? fade(frame, fillFrame, fillFrame + 10) : 0;
  const buttonPressed =
    filled && frame >= fillFrame - 3 && frame < fillFrame + 6;

  return (
    <div
      style={{
        width,
        opacity: reveal,
        translate: `0px ${lift}px`,
        borderRadius: 18,
        background: theme.bgCard,
        border: `1px solid ${theme.ruleFaint}`,
        boxShadow: `0 1px 2px rgba(0,0,0,0.4), 0 30px 70px -30px rgba(0,0,0,0.75), 0 0 0 1px color-mix(in srgb, ${theme.accent} ${reveal * 14}%, transparent), 0 0 ${Math.round(70 * bloom * reveal)}px -12px ${theme.accentGlow}`,
        overflow: "hidden",
        fontFamily: fonts.sans,
      }}
    >
      {/* Masked-wipe overlay covering the reveal. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: theme.bg,
          scale: `1 ${1 - reveal}`,
          transformOrigin: "top",
          zIndex: 5,
          pointerEvents: "none",
        }}
      />

      {/* Header: K-mark + market title + live pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "20px 24px 14px",
        }}
      >
        <KMark size={34} />
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: theme.fg,
            lineHeight: 1.25,
            flex: 1,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: fonts.mono,
            fontSize: 15,
            color: theme.accentText,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: theme.accent,
              boxShadow: `0 0 10px ${theme.accentGlow}`,
            }}
          />
          LIVE
        </div>
      </div>

      {/* Odds chips + sparkline */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 24px 20px",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            flex: 1,
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderRadius: 12,
              background: theme.accentSoft,
              border: `1px solid color-mix(in srgb, ${theme.accent} 32%, transparent)`,
            }}
          >
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: theme.accentText,
              }}
            >
              YES
            </span>
            <OddsTicker
              from={yesPrice}
              to={tickTo}
              tickFrame={tickFrame}
              direction="up"
              size={30}
              weight={700}
              baseColor={theme.accentText}
            />
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderRadius: 12,
              background: theme.dangerSoft,
              border: `1px solid color-mix(in srgb, ${theme.danger} 28%, transparent)`,
            }}
          >
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: theme.dangerText,
              }}
            >
              NO
            </span>
            <span
              style={{
                fontFamily: fonts.mono,
                fontWeight: 700,
                fontSize: 30,
                color: theme.dangerText,
              }}
            >
              {noPrice}¢
            </span>
          </div>
        </div>
        <div style={{ opacity: fade(frame, enterFrame + 6, enterFrame + 24) }}>
          <Sparkline
            values={SPARK}
            width={150}
            height={54}
            from={enterFrame + 6}
            duration={34}
            color={theme.accent}
            fill
          />
        </div>
      </div>

      {/* Expanded trading panel */}
      {open ? (
        <div
          style={{
            height: panelH,
            opacity: panelOpacity,
            overflow: "hidden",
            borderTop: `1px solid ${theme.ruleFaint}`,
          }}
        >
          <div style={{ padding: "18px 24px 22px" }}>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "stretch",
                marginBottom: 14,
              }}
            >
              {/* Amount field */}
              <div
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 10,
                  background: theme.bgAlt,
                  border: `1px solid ${theme.ruleFaint}`,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: theme.fgFaint,
                    marginBottom: 4,
                  }}
                >
                  Amount
                </div>
                <div
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 26,
                    fontWeight: 500,
                    color: theme.fg,
                  }}
                >
                  $50
                </div>
              </div>
              {/* MARKET | LIMIT toggle */}
              <div
                style={{
                  display: "flex",
                  padding: 4,
                  borderRadius: 10,
                  background: theme.bgAlt,
                  border: `1px solid ${theme.ruleFaint}`,
                  alignItems: "center",
                }}
              >
                {(["MARKET", "LIMIT"] as const).map((t) => {
                  const active = t === "MARKET";
                  return (
                    <div
                      key={t}
                      style={{
                        padding: "10px 16px",
                        borderRadius: 8,
                        fontFamily: fonts.mono,
                        fontSize: 14,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        color: active ? theme.bg : theme.fgFaint,
                        background: active ? theme.accent : "transparent",
                      }}
                    >
                      {t}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Payout preview */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontFamily: fonts.mono,
                fontSize: 16,
                color: theme.fgMuted,
                marginBottom: 16,
              }}
            >
              <span>Payout if YES</span>
              <span style={{ color: theme.accentText, fontWeight: 500 }}>
                $72.46
              </span>
            </div>

            {/* Confirm button */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
                borderRadius: 12,
                background: theme.accent,
                color: theme.bg,
                fontWeight: 700,
                fontSize: 20,
                letterSpacing: "0.01em",
                scale: buttonPressed ? "0.985" : "1",
                boxShadow: `0 12px 34px -14px ${theme.accentGlow}`,
              }}
            >
              Confirm Order
            </div>
            <div
              style={{
                textAlign: "center",
                fontSize: 12.5,
                color: theme.fgFaint,
                marginTop: 10,
              }}
            >
              By clicking Confirm Order, you agree to our terms.
            </div>
          </div>
        </div>
      ) : null}

      {/* Fill confirmation (green pulse + position chip) */}
      {filled ? (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: theme.accent,
              opacity: fillPulse * 0.16,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              opacity: fillOpacity,
              borderTop: `1px solid ${theme.ruleFaint}`,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "16px 24px",
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                background: theme.accent,
                color: theme.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                fontWeight: 800,
              }}
            >
              ✓
            </div>
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 17,
                color: theme.fg,
              }}
            >
              <span style={{ color: theme.accentText, fontWeight: 700 }}>
                YES
              </span>{" "}
              · 72 shares · avg 69¢
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
};
