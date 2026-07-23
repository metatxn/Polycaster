import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Kicker } from "../components/Kicker";
import { RadarPanel } from "../components/RadarPanel";
import { Stage } from "../components/Stage";
import { ease, fade, outro } from "../lib/anim";
import { fonts, theme } from "../theme";

export const SCENE_09_DURATION = 240; // 8.0s

const RADAR_ROWS = [
  { label: "Elections", count: 14 },
  { label: "Crypto", count: 38 },
  { label: "Sports", count: 22 },
  { label: "Macro", count: 11 },
  { label: "Policy", count: 7 },
];

const EVIDENCE = [
  "CPI printed 2.4% — cooling faster than consensus.",
  "Three FOMC members signaled openness to easing.",
  "Market odds lagged the print by ~40 minutes.",
];

const EvidenceLine: React.FC<{ text: string; index: number }> = ({
  text,
  index,
}) => {
  const frame = useCurrentFrame();
  const start = 78 + index * 14;
  const op = fade(frame, start, start + 12);
  const dx = ease(frame, [start, start + 12], [16, 0]);
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        opacity: op,
        translate: `${dx}px 0px`,
        fontFamily: fonts.sans,
        fontSize: 20,
        color: theme.fgMuted,
        lineHeight: 1.4,
      }}
    >
      <span style={{ color: theme.accentText, fontFamily: fonts.mono }}>›</span>
      <span>{text}</span>
    </div>
  );
};

const AgentCard: React.FC = () => {
  const frame = useCurrentFrame();
  const op = fade(frame, 56, 74);
  const dy = ease(frame, [56, 74], [24, 0]);
  return (
    <div
      style={{
        width: 720,
        opacity: op,
        translate: `0px ${dy}px`,
        padding: 30,
        borderRadius: 18,
        background: theme.bgCard,
        border: `1px solid ${theme.ruleFaint}`,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: fonts.sans,
            fontSize: 24,
            fontWeight: 700,
            color: theme.fg,
          }}
        >
          Suggestion · Buy YES
        </span>
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 16,
            color: theme.accentText,
            padding: "6px 12px",
            borderRadius: 999,
            background: theme.accentSoft,
          }}
        >
          conf 0.82
        </span>
      </div>
      <div style={{ fontFamily: fonts.sans, fontSize: 22, color: theme.fg }}>
        Fed cuts rates in December
      </div>

      <div style={{ height: 1, background: theme.ruleFaint, width: "100%" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {EVIDENCE.map((e, i) => (
          <EvidenceLine key={e} text={e} index={i} />
        ))}
      </div>

      {/* Vote + risk gate */}
      <div
        style={{
          display: "flex",
          gap: 14,
          opacity: fade(frame, 132, 150),
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "14px 18px",
            borderRadius: 10,
            background: theme.bgAlt,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: fonts.sans,
              fontSize: 17,
              color: theme.fgMuted,
            }}
          >
            Agent vote
          </span>
          <span
            style={{
              fontFamily: fonts.mono,
              fontSize: 18,
              fontWeight: 700,
              color: theme.accentText,
            }}
          >
            4 / 5 buy
          </span>
        </div>
        <div
          style={{
            flex: 1.3,
            padding: "14px 18px",
            borderRadius: 10,
            background: theme.bgAlt,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: fonts.sans,
              fontSize: 17,
              color: theme.fgMuted,
            }}
          >
            Risk gate · ≤ 2% of book
          </span>
          <span
            style={{
              fontFamily: fonts.mono,
              fontSize: 16,
              fontWeight: 700,
              color: theme.accentText,
            }}
          >
            passed
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * The agent layer — a restrained radar sweep over category counts beside an
 * agent suggestion whose reasoning is expanded, cascading in line by line.
 * Transparent reasoning. No black box.
 */
export const Scene09Agent: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: outro(frame, SCENE_09_DURATION) }}>
      <Stage justify="center" align="stretch">
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <div style={{ opacity: fade(frame, 4, 18) }}>
            <Kicker size={24} color={theme.accentText}>
              The agent layer
            </Kicker>
          </div>
          <div
            style={{
              display: "flex",
              gap: 48,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <RadarPanel rows={RADAR_ROWS} startFrame={6} size={280} />
            <AgentCard />
          </div>
          <div
            style={{
              opacity: fade(frame, 182, 204),
              fontFamily: fonts.sans,
              fontSize: 34,
              fontWeight: 600,
              color: theme.fg,
              translate: `0px ${ease(frame, [182, 204], [12, 0])}px`,
            }}
          >
            Transparent reasoning. No black box.
          </div>
        </div>
      </Stage>
    </AbsoluteFill>
  );
};
