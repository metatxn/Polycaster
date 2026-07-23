import { Easing, interpolate } from "remotion";

/** Smooth editorial settle — no overshoot. Default entrance easing. */
export const SETTLE = Easing.bezier(0.16, 1, 0.3, 1);
/** Gentle out-cubic for secondary motion. */
export const OUT = Easing.out(Easing.cubic);

export const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** 0 → 1 opacity ramp over [start, end] frames. */
export const fade = (
  frame: number,
  start: number,
  end: number,
  easing = SETTLE
) => interpolate(frame, [start, end], [0, 1], { easing, ...CLAMP });

/** Eased interpolate with clamped extrapolation. */
export const ease = (
  frame: number,
  input: [number, number],
  output: [number, number],
  easing = SETTLE
) => interpolate(frame, input, output, { easing, ...CLAMP });

/** Quick tail fade so scene cuts never flash a stray frame. */
export const outro = (frame: number, sceneDuration: number, dur = 8) =>
  interpolate(frame, [sceneDuration - dur, sceneDuration], [1, 0], CLAMP);

/**
 * Entrance transform helper — fades up from `dy` px. Returns a style fragment
 * using the `translate` shorthand (Studio-friendly, per Remotion best
 * practices).
 */
export const enter = (frame: number, start: number, end: number, dy = 24) => ({
  opacity: fade(frame, start, end),
  translate: `0px ${ease(frame, [start, end], [dy, 0])}px`,
});
