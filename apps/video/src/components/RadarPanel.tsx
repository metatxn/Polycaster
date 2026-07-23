import { useCurrentFrame } from "remotion";
import { ease, fade } from "../lib/anim";
import { fonts, theme } from "../theme";

export type RadarRow = { label: string; count: number };

/**
 * The agent-layer radar: category rows with mono "new" counts and a slow,
 * continuous sweep — a scanner never decelerates. Restrained, no strobing.
 */
export const RadarPanel: React.FC<{
  rows: RadarRow[];
  startFrame?: number;
  size?: number;
}> = ({ rows, startFrame = 0, size = 300 }) => {
  const frame = useCurrentFrame();
  // 1.5°/frame = one full rotation every 8s, constant velocity.
  const sweep = Math.max(0, frame - startFrame) * 1.5;
  const r = size / 2;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
      {/* Radar dial */}
      <div
        style={{
          width: size,
          height: size,
          position: "relative",
          flexShrink: 0,
          opacity: fade(frame, startFrame, startFrame + 16),
        }}
      >
        {[0.4, 0.7, 1].map((ring) => (
          <div
            key={ring}
            style={{
              position: "absolute",
              inset: `${(1 - ring) * r}px`,
              borderRadius: 999,
              border: `1px solid ${theme.ruleFaint}`,
            }}
          />
        ))}
        {/* Cross hairs */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "50%",
            width: 1,
            background: theme.ruleFaint,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            height: 1,
            background: theme.ruleFaint,
          }}
        />
        {/* Sweep wedge */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 999,
            rotate: `${sweep}deg`,
            background: `conic-gradient(from 0deg, ${theme.accentGlow} 0deg, transparent 60deg)`,
            maskImage: "radial-gradient(circle, black 60%, transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(circle, black 60%, transparent 100%)",
            opacity: 0.75,
          }}
        />
        {/* Blips */}
        {rows.slice(0, 4).map((row, i) => {
          const angle = (i / 4) * Math.PI * 2 + 0.6;
          const dist = r * (0.35 + (i % 3) * 0.2);
          const x = r + Math.cos(angle) * dist;
          const y = r + Math.sin(angle) * dist;
          const blip = fade(
            frame,
            startFrame + 20 + i * 6,
            startFrame + 30 + i * 6
          );
          return (
            <div
              key={row.label}
              style={{
                position: "absolute",
                left: x - 5,
                top: y - 5,
                width: 10,
                height: 10,
                borderRadius: 999,
                background: theme.accent,
                boxShadow: `0 0 12px ${theme.accentGlow}`,
                opacity: blip,
              }}
            />
          );
        })}
      </div>

      {/* Category rows */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          minWidth: 360,
        }}
      >
        {rows.map((row, i) => {
          const appear = fade(
            frame,
            startFrame + 10 + i * 6,
            startFrame + 24 + i * 6
          );
          const dx = ease(
            frame,
            [startFrame + 10 + i * 6, startFrame + 24 + i * 6],
            [18, 0]
          );
          return (
            <div
              key={row.label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 24,
                opacity: appear,
                translate: `${dx}px 0px`,
                padding: "14px 20px",
                borderRadius: 12,
                background: theme.bgCard,
                border: `1px solid ${theme.ruleFaint}`,
              }}
            >
              <span
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 22,
                  fontWeight: 600,
                  color: theme.fg,
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 20,
                  color: theme.accentText,
                }}
              >
                {row.count} new
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
