import { AbsoluteFill, useCurrentFrame } from "remotion";

/**
 * Cinema push-in: a barely-perceptible scale drift so no scene is ever a
 * static frame. Rate-based (≈3.5% max) so it works for any scene length
 * without knowing the duration. Wrap scene content, not the backdrop —
 * grain and light stay fixed like a camera looking at a lit set.
 */
export const Drift: React.FC<{ children: React.ReactNode; rate?: number }> = ({
  children,
  rate = 0.00011,
}) => {
  const frame = useCurrentFrame();
  const scale = 1 + Math.min(frame * rate, 0.035);
  return (
    <AbsoluteFill style={{ scale: `${scale}`, transformOrigin: "50% 46%" }}>
      {children}
    </AbsoluteFill>
  );
};
