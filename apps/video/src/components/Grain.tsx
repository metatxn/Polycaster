import { AbsoluteFill, useCurrentFrame } from "remotion";
import { theme } from "../theme";

/**
 * Editorial backdrop: per-frame animated film grain, a slow-drifting warm
 * "reading lamp" light, and a vignette. The grain offset changes every frame
 * so the texture reads as film, not a static PNG; the lamp keeps the frame
 * alive even when nothing else moves.
 */
const NOISE =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.035 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

export const Grain: React.FC<{ vignette?: boolean }> = ({
  vignette = true,
}) => {
  const frame = useCurrentFrame();
  // Deterministic pseudo-random jitter — new grain position every frame.
  const gx = ((frame * 7919) % 200) - 100;
  const gy = ((frame * 104729) % 200) - 100;
  // The lamp drifts on two slow incommensurate sine paths.
  const lampX = 50 + 9 * Math.sin(frame * 0.006);
  const lampY = 38 + 7 * Math.cos(frame * 0.0043);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {/* Warm reading-lamp light */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(90% 75% at ${lampX}% ${lampY}%, rgba(240, 222, 185, 0.055) 0%, rgba(240, 222, 185, 0.018) 45%, transparent 70%)`,
        }}
      />
      {/* Faint green undertone rising from the floor — the market's glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 55% at 50% 108%, rgba(74, 222, 128, 0.04) 0%, transparent 60%)`,
        }}
      />
      {/* Animated film grain */}
      <AbsoluteFill
        style={{
          backgroundImage: `url("${NOISE}")`,
          backgroundSize: "200px 200px",
          backgroundPosition: `${gx}px ${gy}px`,
          opacity: 0.9,
        }}
      />
      {vignette ? (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(120% 120% at 50% 42%, transparent 55%, rgba(0,0,0,0.55) 100%)",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
