import { useCurrentFrame } from "remotion";
import { ease } from "../lib/anim";
import { theme } from "../theme";

/** Build a smooth SVG path (quadratic midpoint smoothing) from 0..1 y-values. */
const buildPath = (values: number[], w: number, h: number, pad: number) => {
  const n = values.length;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const pts = values.map((v, i) => ({
    x: pad + (innerW * i) / (n - 1),
    y: pad + innerH * (1 - v),
  }));
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < n; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const mx = (prev.x + cur.x) / 2;
    d += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${mx.toFixed(2)} ${((prev.y + cur.y) / 2).toFixed(2)}`;
    d += ` T ${cur.x.toFixed(2)} ${cur.y.toFixed(2)}`;
  }
  return { d, pts };
};

/**
 * A live-updating price sparkline that draws on via a normalized pathLength
 * dash (no @remotion/paths dependency). Optional soft area fill + a leading dot.
 */
export const Sparkline: React.FC<{
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  from?: number;
  duration?: number;
  fill?: boolean;
  dot?: boolean;
  pad?: number;
}> = ({
  values,
  width = 260,
  height = 64,
  color = theme.accent,
  strokeWidth = 2.5,
  from = 0,
  duration = 40,
  fill = false,
  dot = true,
  pad = 6,
}) => {
  const frame = useCurrentFrame();
  const progress = ease(frame, [from, from + duration], [0, 1]);
  const { d, pts } = buildPath(values, width, height, pad);
  const last = pts[pts.length - 1];
  // Leading dot rides along the horizontal extent as the line draws.
  const dotIndex = Math.min(
    pts.length - 1,
    Math.floor(progress * (pts.length - 1))
  );
  const dotPt = pts[dotIndex];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible", display: "block" }}
      role="img"
      aria-label="Live price sparkline"
    >
      <title>Live price sparkline</title>
      {fill ? (
        <path
          d={`${d} L ${last.x.toFixed(2)} ${height - pad} L ${pts[0].x.toFixed(2)} ${height - pad} Z`}
          fill={color}
          opacity={0.1 * progress}
        />
      ) : null}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - progress}
        style={{ filter: `drop-shadow(0 0 ${strokeWidth * 2.4}px ${color})` }}
      />
      {dot ? (
        <circle
          cx={dotPt.x}
          cy={dotPt.y}
          r={strokeWidth + 1.5}
          fill={color}
          opacity={progress > 0.02 ? 1 : 0}
        />
      ) : null}
    </svg>
  );
};
