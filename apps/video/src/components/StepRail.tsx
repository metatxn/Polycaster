import { useCurrentFrame } from "remotion";
import { ease, fade } from "../lib/anim";
import { fonts, theme } from "../theme";

export type Step = { n: string; text: string };

/**
 * Numbered step cards (01 → 04) that light up in sequence, joined by a progress
 * hairline. Each card gets a brief accent-green underline as it activates.
 */
export const StepRail: React.FC<{
  steps: Step[];
  startFrame?: number;
  stagger?: number;
}> = ({ steps, startFrame = 0, stagger = 22 }) => {
  const frame = useCurrentFrame();
  const total = steps.length;
  const lastActivate = startFrame + (total - 1) * stagger;

  return (
    <div style={{ width: "100%", position: "relative" }}>
      {/* Progress hairline behind the cards */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: 2,
          background: theme.ruleFaint,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          height: 2,
          width: `${ease(frame, [startFrame, lastActivate + stagger], [0, 100])}%`,
          background: `linear-gradient(90deg, ${theme.accent}, ${theme.accentText})`,
          boxShadow: `0 0 12px ${theme.accentGlow}`,
        }}
      />

      <div
        style={{
          display: "flex",
          gap: 24,
          position: "relative",
        }}
      >
        {steps.map((step, i) => {
          const activate = startFrame + i * stagger;
          const appear = fade(frame, activate - 8, activate + 6);
          const on = frame >= activate;
          const underline = ease(frame, [activate, activate + 14], [0, 1]);
          const dy = ease(frame, [activate - 8, activate + 6], [16, 0]);

          return (
            <div
              key={i}
              style={{
                flex: 1,
                opacity: appear,
                translate: `0px ${dy}px`,
                padding: "26px 24px 28px",
                borderRadius: 16,
                background: on ? theme.bgCardHi : theme.bgCard,
                border: `1px solid ${on ? `color-mix(in srgb, ${theme.accent} 26%, transparent)` : theme.ruleFaint}`,
                position: "relative",
                overflow: "hidden",
                minHeight: 200,
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 40,
                  fontWeight: 700,
                  color: on ? theme.accentText : theme.fgFaint,
                }}
              >
                {step.n}
              </div>
              <div
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 21,
                  lineHeight: 1.4,
                  color: on ? theme.fg : theme.fgMuted,
                  fontWeight: 500,
                }}
              >
                {step.text}
              </div>
              {/* Accent underline */}
              <div
                style={{
                  position: "absolute",
                  left: 24,
                  bottom: 0,
                  height: 3,
                  width: `${underline * 46}px`,
                  background: theme.accent,
                  boxShadow: `0 0 10px ${theme.accentGlow}`,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
