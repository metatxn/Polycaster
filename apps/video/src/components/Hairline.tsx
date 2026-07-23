import { useCurrentFrame } from "remotion";
import { ease } from "../lib/anim";
import { theme } from "../theme";

/**
 * A thin hairline rule that draws in left-to-right via scaleX — the masthead
 * motif's signature gesture (paper-whoosh moment in the audio spec).
 */
export const Hairline: React.FC<{
  /** frame the draw-in starts */
  from?: number;
  /** frames the draw-in takes */
  duration?: number;
  width?: number | string;
  color?: string;
  thickness?: number;
  align?: "left" | "center";
}> = ({
  from = 0,
  duration = 22,
  width = "100%",
  color = theme.rule,
  thickness = 1,
  align = "left",
}) => {
  const frame = useCurrentFrame();
  const scaleX = ease(frame, [from, from + duration], [0, 1]);

  return (
    <div
      style={{
        width,
        height: thickness,
        backgroundColor: color,
        scale: `${scaleX} 1`,
        transformOrigin: align === "center" ? "center" : "left center",
      }}
    />
  );
};
