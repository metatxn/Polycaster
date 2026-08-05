import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Hairline } from "../components/Hairline";
import { KMark } from "../components/KMark";
import { Stage } from "../components/Stage";
import { ease, fade } from "../lib/anim";
import { fonts, theme } from "../theme";

export const SCENE_10_DURATION = 420; // 14.0s

/**
 * Close & CTA — return to the masthead. The tagline lands in Fraunces italic
 * (permitted use 2 of 2) and the accent-green underline under the CTA is the
 * last thing to move. Holds for a full four seconds.
 */
export const Scene10Close: React.FC = () => {
  const frame = useCurrentFrame();

  const line1 = {
    opacity: fade(frame, 30, 50),
    dy: ease(frame, [30, 50], [18, 0]),
  };
  const line2Scale = ease(frame, [52, 78], [1.05, 1]);
  const line2Op = fade(frame, 52, 76);
  const ctaOp = fade(frame, 92, 112);
  const ctaDy = ease(frame, [92, 112], [16, 0]);
  const secondaryOp = fade(frame, 118, 138);
  const footerOp = fade(frame, 150, 172);
  const underline = ease(frame, [176, 200], [0, 1]);

  return (
    <AbsoluteFill>
      <Stage>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 30,
            width: "100%",
            maxWidth: 1400,
          }}
        >
          <div style={{ opacity: fade(frame, 0, 16) }}>
            <KMark
              size={100}
              style={{
                filter: `drop-shadow(0 0 ${18 + 6 * Math.sin(frame * 0.045)}px rgba(74, 222, 128, 0.35))`,
              }}
            />
          </div>

          <Hairline from={6} duration={24} width="100%" align="center" />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              textAlign: "center",
            }}
          >
            <div
              style={{
                opacity: line1.opacity,
                translate: `0px ${line1.dy}px`,
                fontFamily: fonts.sans,
                fontWeight: 600,
                fontSize: 78,
                letterSpacing: "-0.02em",
                color: theme.fg,
              }}
            >
              The future won't just be discussed.
            </div>
            <div
              style={{
                opacity: line2Op,
                scale: `${line2Scale}`,
                fontFamily: fonts.serif,
                fontStyle: "italic",
                fontWeight: 500,
                fontSize: 96,
                letterSpacing: "-0.01em",
                color: theme.accentText,
              }}
            >
              Know your Odds.
            </div>
          </div>

          <Hairline
            from={20}
            duration={28}
            width="100%"
            align="center"
            color={theme.ruleFaint}
          />

          {/* CTA */}
          <div
            style={{
              opacity: ctaOp,
              translate: `0px ${ctaDy}px`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              marginTop: 8,
            }}
          >
            <div style={{ position: "relative" }}>
              <div
                style={{
                  padding: "20px 40px",
                  borderRadius: 14,
                  background: theme.accent,
                  color: theme.bg,
                  fontFamily: fonts.sans,
                  fontWeight: 700,
                  fontSize: 30,
                  boxShadow: `0 20px ${58 + 14 * Math.sin(frame * 0.055)}px -24px ${theme.accentGlow}, 0 0 ${26 + 12 * Math.sin(frame * 0.055)}px -8px ${theme.accentGlow}`,
                }}
              >
                Install Knoww — Free
              </div>
              {/* Accent underline — the last thing to move */}
              <div
                style={{
                  position: "absolute",
                  left: "10%",
                  bottom: -12,
                  height: 4,
                  width: `${underline * 80}%`,
                  background: theme.accent,
                  boxShadow: `0 0 12px ${theme.accentGlow}`,
                  borderRadius: 999,
                }}
              />
            </div>
            <div
              style={{
                opacity: secondaryOp,
                fontFamily: fonts.sans,
                fontSize: 22,
                color: theme.fgMuted,
              }}
            >
              Or explore markets without installing · knoww.app
            </div>
          </div>
        </div>
      </Stage>

      {/* Footer strip */}
      <AbsoluteFill
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          flexDirection: "column",
          paddingBottom: 64,
          gap: 8,
          opacity: footerOp,
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 18,
            color: theme.fgMuted,
            letterSpacing: "0.04em",
          }}
        >
          Chrome extension · Free · one-click install
        </div>
        <div
          style={{ fontFamily: fonts.mono, fontSize: 15, color: theme.fgFaint }}
        >
          © 2026 Knoww — Made for the prediction-literate
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
