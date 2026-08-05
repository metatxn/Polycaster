import { interpolate, useCurrentFrame } from "remotion";
import { CLAMP } from "../lib/anim";
import { fonts, theme } from "../theme";

/**
 * A mono price/odds figure with a one-time tick animation. When the frame
 * crosses `tickFrame` the value swaps from `from` to `to` and flashes the
 * accent colour (green up, red down) to prove the market is live. No scale
 * bounce — numbers never overshoot in this brand.
 */
export const OddsTicker: React.FC<{
  from: number;
  to?: number;
  tickFrame?: number;
  suffix?: string;
  size?: number;
  direction?: "up" | "down";
  weight?: number;
  baseColor?: string;
}> = ({
  from,
  to,
  tickFrame,
  suffix = "¢",
  size = 40,
  direction = "up",
  weight = 500,
  baseColor = theme.fg,
}) => {
  const frame = useCurrentFrame();
  const hasTick = to !== undefined && tickFrame !== undefined;
  const ticked = hasTick && frame >= (tickFrame as number);
  const value = ticked ? (to as number) : from;

  const flashColor = direction === "up" ? theme.accent : theme.danger;
  // 0 at tick, ramps back to base over 14 frames.
  const flash = hasTick
    ? interpolate(
        frame,
        [
          (tickFrame as number) - 1,
          tickFrame as number,
          (tickFrame as number) + 14,
        ],
        [0, 1, 0],
        CLAMP
      )
    : 0;

  return (
    <span
      style={{
        fontFamily: fonts.mono,
        fontWeight: weight,
        fontSize: size,
        fontVariantNumeric: "tabular-nums",
        color: `color-mix(in srgb, ${flashColor} ${flash * 100}%, ${baseColor})`,
        letterSpacing: "-0.01em",
      }}
    >
      {value}
      {suffix}
    </span>
  );
};
