import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Hairline } from "../components/Hairline";
import { Kicker } from "../components/Kicker";
import { Stage } from "../components/Stage";
import { StepRail } from "../components/StepRail";
import { ease, fade, outro } from "../lib/anim";
import { fonts, theme } from "../theme";

export const SCENE_04_DURATION = 240; // 8.0s

const STEPS = [
  { n: "01", text: "User sees a post, article, headline, or comment." },
  { n: "02", text: "Knoww parses entities, claims, and uncertainty." },
  { n: "03", text: "The most relevant prediction market is selected." },
  { n: "04", text: "Live odds appear. Take a position instantly." },
];

/**
 * How it works — a four-step rail lights up in sequence, joined by a progress
 * hairline, with the traction footnote resolving underneath.
 */
export const Scene04HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();
  const footnoteOpacity = fade(frame, 150, 176);
  const footnoteDy = ease(frame, [150, 176], [14, 0]);

  return (
    <AbsoluteFill style={{ opacity: outro(frame, SCENE_04_DURATION) }}>
      <Stage justify="center">
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 52,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              opacity: fade(frame, 4, 20),
            }}
          >
            <Kicker size={24} color={theme.accentText}>
              How it works
            </Kicker>
            <div
              style={{
                fontFamily: fonts.sans,
                fontWeight: 600,
                fontSize: 60,
                letterSpacing: "-0.02em",
                color: theme.fg,
              }}
            >
              Detect. Parse. Surface. Trade.
            </div>
            <Hairline from={12} width="100%" color={theme.ruleFaint} />
          </div>

          <StepRail steps={STEPS} startFrame={30} stagger={28} />

          <div
            style={{
              opacity: footnoteOpacity,
              translate: `0px ${footnoteDy}px`,
              fontFamily: fonts.mono,
              fontSize: 22,
              color: theme.fgMuted,
              textAlign: "center",
            }}
          >
            {
              "< 500ms detect-to-render · 91% avg. context confidence · 50+ supported sites"
            }
          </div>
        </div>
      </Stage>
    </AbsoluteFill>
  );
};
