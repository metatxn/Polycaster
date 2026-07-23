import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Drift } from "../components/Drift";
import { Grain } from "../components/Grain";
import { MockHost } from "../components/MockHost";
import { CLAMP, ease, fade, outro } from "../lib/anim";
import { fonts, theme } from "../theme";

export const SCENE_02_DURATION = 240; // 8.0s

const QUOTES = [
  { text: '"This is definitely happening."', x: 210, y: 200, start: 20 },
  { text: '"Markets are underpricing this."', x: 1160, y: 360, start: 55 },
  { text: '"It\'s priced in already."', x: 470, y: 720, start: 90 },
];

const QuoteChip: React.FC<{
  text: string;
  x: number;
  y: number;
  start: number;
}> = ({ text, x, y, start }) => {
  const frame = useCurrentFrame();
  // Drift up + fade in; all chips clear by ~frame 150 so the resolving
  // OST line gets a clean frame to itself.
  const drift = ease(frame, [start, start + 120], [16, -16]);
  const opacity = interpolate(
    frame,
    [start, start + 24, 134, 150],
    [0, 1, 1, 0],
    CLAMP
  );
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        translate: `0px ${drift}px`,
        opacity,
        padding: "16px 22px",
        borderRadius: 12,
        background: theme.bgCard,
        border: `1px solid ${theme.ruleFaint}`,
        fontFamily: fonts.mono,
        fontSize: 24,
        color: theme.fg,
        boxShadow: "0 20px 50px -30px rgba(0,0,0,0.8)",
      }}
    >
      {text}
    </div>
  );
};

const Fragment: React.FC<{
  x: number;
  y: number;
  variant: "feed" | "article" | "forum";
  speed: number;
}> = ({ x, y, variant, speed }) => {
  const frame = useCurrentFrame();
  // Background parallax at ~0.3x speed.
  const dx = interpolate(
    frame,
    [0, SCENE_02_DURATION],
    [0, -40 * speed],
    CLAMP
  );
  const dy = interpolate(
    frame,
    [0, SCENE_02_DURATION],
    [0, -24 * speed],
    CLAMP
  );
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        translate: `${dx}px ${dy}px`,
        filter: "blur(3.5px)",
        opacity: 0.68,
        scale: "0.9",
      }}
    >
      <MockHost variant={variant} />
    </div>
  );
};

/**
 * The problem — muted, blurred UI fragments drift behind three mono quote
 * chips. The market is always somewhere else. Resolves on a centered line.
 */
export const Scene02Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const ostOpacity = fade(frame, 155, 185);
  const ostDy = ease(frame, [155, 185], [18, 0]);

  return (
    <AbsoluteFill style={{ opacity: outro(frame, SCENE_02_DURATION) }}>
      <Grain />
      <Drift>
        <Fragment x={-40} y={-30} variant="feed" speed={1} />
        <Fragment x={1140} y={80} variant="article" speed={0.6} />
        <Fragment x={260} y={640} variant="forum" speed={0.8} />
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(120% 120% at 50% 50%, rgba(12,10,7,0.4) 40%, rgba(12,10,7,0.9) 100%)",
          }}
        />

        {QUOTES.map((q) => (
          <QuoteChip key={q.text} {...q} />
        ))}

        {/* Resolving line */}
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              opacity: ostOpacity,
              translate: `0px ${ostDy}px`,
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 76,
              letterSpacing: "-0.02em",
              color: theme.fg,
              textAlign: "center",
              textShadow: "0 8px 40px rgba(0,0,0,0.6)",
            }}
          >
            People don't start with a market.
          </div>
        </AbsoluteFill>
      </Drift>
    </AbsoluteFill>
  );
};
