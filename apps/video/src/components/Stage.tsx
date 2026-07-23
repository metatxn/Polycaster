import { AbsoluteFill } from "remotion";
import { Drift } from "./Drift";
import { Grain } from "./Grain";

/**
 * Scene shell: editorial grain backdrop + a generous, centered safe area.
 * Keeps every scene inside the same margins so the video reads as one system.
 */
export const Stage: React.FC<{
  children: React.ReactNode;
  justify?: React.CSSProperties["justifyContent"];
  align?: React.CSSProperties["alignItems"];
  padX?: number;
  padY?: number;
  vignette?: boolean;
}> = ({
  children,
  justify = "center",
  align = "center",
  padX = 150,
  padY = 110,
  vignette = true,
}) => {
  return (
    <AbsoluteFill>
      <Grain vignette={vignette} />
      <Drift>
        <AbsoluteFill
          style={{
            padding: `${padY}px ${padX}px`,
            display: "flex",
            flexDirection: "column",
            justifyContent: justify,
            alignItems: align,
          }}
        >
          {children}
        </AbsoluteFill>
      </Drift>
    </AbsoluteFill>
  );
};
