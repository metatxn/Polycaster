import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Grain } from "../components/Grain";
import { InlineCard } from "../components/InlineCard";
import { Kicker } from "../components/Kicker";
import { KMark } from "../components/KMark";
import { MockHost } from "../components/MockHost";
import { CLAMP, ease, fade, outro } from "../lib/anim";
import { fonts, theme } from "../theme";

export const SCENE_06_DURATION = 210; // 7.0s

const SHOT = 24; // ~0.8s per montage shot
const MONTAGE_END = SHOT * 4;

type Shot = {
  variant: "article" | "sports" | "feed" | "forum";
  title: string;
  yes: number;
  no: number;
  post?: string;
};

const SHOTS: Shot[] = [
  { variant: "article", title: "Fed cuts rates in December?", yes: 74, no: 26 },
  { variant: "sports", title: "Home team wins tonight?", yes: 61, no: 39 },
  {
    variant: "feed",
    title: "ETH above $5,000 this quarter?",
    yes: 43,
    no: 57,
    post: "ETH is coiling. $5K is closer than people think.",
  },
  { variant: "forum", title: "GPT-5 released before July?", yes: 38, no: 62 },
];

const MontageShot: React.FC<{ shot: Shot; index: number }> = ({
  shot,
  index,
}) => {
  const frame = useCurrentFrame();
  const start = index * SHOT;
  const visible = frame >= start && frame < start + SHOT;
  if (!visible) return null;
  const local = frame - start;
  const pop = ease(local, [0, 8], [0.96, 1]);
  const op = fade(local, 0, 5);
  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ scale: `${pop}`, opacity: op }}>
        <MockHost variant={shot.variant} postText={shot.post}>
          <InlineCard
            title={shot.title}
            yesPrice={shot.yes}
            noPrice={shot.no}
            enterFrame={0}
            width={720}
          />
        </MockHost>
      </div>
    </AbsoluteFill>
  );
};

/** Deterministic dot wall that converges into the K-mark. */
const DotWall: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - MONTAGE_END;
  const converge = ease(t, [10, 70], [0, 1]);
  const markOpacity = fade(t, 60, 90);
  const cx = 960;
  const cy = 470;
  const COUNT = 48;

  return (
    <AbsoluteFill>
      {Array.from({ length: COUNT }).map((_, i) => {
        // Scatter deterministically on a ring-ish field, then pull to center.
        const ang = (i / COUNT) * Math.PI * 2 * 3.3;
        const rad = 260 + (i % 7) * 60;
        const sx = cx + Math.cos(ang) * rad;
        const sy = cy + Math.sin(ang) * rad * 0.62;
        const x = interpolate(converge, [0, 1], [sx, cx], CLAMP);
        const y = interpolate(converge, [0, 1], [sy, cy], CLAMP);
        const dotOp = (1 - converge) * 0.9;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - 5,
              top: y - 5,
              width: 10,
              height: 10,
              borderRadius: 999,
              background: theme.accent,
              opacity: dotOp,
              boxShadow: `0 0 8px ${theme.accentGlow}`,
            }}
          />
        );
      })}
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ opacity: markOpacity, marginTop: -110 }}>
          <KMark size={240} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Everywhere the internet debates — a rhythmic montage of the same inline card
 * across site types, resolving into a wall of dots that form the K-mark.
 */
export const Scene06Everywhere: React.FC = () => {
  const frame = useCurrentFrame();
  const showWall = frame >= MONTAGE_END;
  const ostOpacity = fade(frame, MONTAGE_END + 70, MONTAGE_END + 92);
  // The site count ticks up in mono as the dots converge.
  const siteCount = Math.round(
    interpolate(frame, [MONTAGE_END + 70, MONTAGE_END + 98], [12, 50], CLAMP)
  );

  return (
    <AbsoluteFill style={{ opacity: outro(frame, SCENE_06_DURATION) }}>
      <Grain />

      {/* Kicker */}
      <div
        style={{
          position: "absolute",
          left: 150,
          top: 110,
          opacity: fade(frame, 4, 18),
        }}
      >
        <Kicker size={24} color={theme.accentText}>
          Everywhere the internet debates
        </Kicker>
      </div>

      {!showWall
        ? SHOTS.map((shot, i) => (
            <MontageShot key={shot.title} shot={shot} index={i} />
          ))
        : null}

      {showWall ? <DotWall /> : null}

      {/* OST */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 150,
        }}
      >
        <div
          style={{
            opacity: ostOpacity,
            fontFamily: fonts.mono,
            fontSize: 40,
            fontWeight: 500,
            letterSpacing: "0.16em",
            color: theme.accentText,
          }}
        >
          {siteCount}+ SUPPORTED WEBSITES
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
