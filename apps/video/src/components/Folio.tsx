import { useCurrentFrame } from "remotion";
import { fade } from "../lib/anim";
import { fonts, theme } from "../theme";

/**
 * Running issue furniture on interior scenes: a thin top rule with the issue
 * title, and a mono folio (page number) bottom-left — the video reads as
 * pages of one printed issue.
 */
export const Folio: React.FC<{ page: number; total?: number }> = ({
  page,
  total = 10,
}) => {
  const frame = useCurrentFrame();
  const opacity = fade(frame, 6, 20);

  return (
    <>
      {/* Running head */}
      <div
        style={{
          position: "absolute",
          top: 52,
          left: 150,
          right: 150,
          opacity,
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 13,
            letterSpacing: "0.24em",
            color: theme.fgFaint,
            whiteSpace: "nowrap",
          }}
        >
          KNOWW — THE PREDICTION LAYER
        </span>
        <div style={{ flex: 1, height: 1, background: theme.ruleFaint }} />
      </div>

      {/* Folio */}
      <div
        style={{
          position: "absolute",
          bottom: 48,
          left: 150,
          opacity,
          fontFamily: fonts.mono,
          fontSize: 15,
          letterSpacing: "0.18em",
          color: theme.fgFaint,
        }}
      >
        {String(page).padStart(2, "0")} / {total}
      </div>
    </>
  );
};
