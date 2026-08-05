import { useCurrentFrame } from "remotion";
import { ease } from "../lib/anim";
import { fonts, theme } from "../theme";
import { Hairline } from "./Hairline";
import { Kicker } from "./Kicker";
import { KMark } from "./KMark";

export type Word = { text: string; italic?: boolean };

/** A single word that tracks in — fades up, letter-spacing settles, no bounce. */
const AnimWord: React.FC<{ word: Word; start: number }> = ({ word, start }) => {
  const frame = useCurrentFrame();
  const opacity = ease(frame, [start, start + 14], [0, 1]);
  const dy = ease(frame, [start, start + 16], [18, 0]);
  const track = ease(frame, [start, start + 20], [0.14, 0]);
  // Italic accent word gets a faint scale-settle.
  const scale = word.italic ? ease(frame, [start, start + 20], [1.06, 1]) : 1;

  return (
    <span
      style={{
        display: "inline-block",
        opacity,
        translate: `0px ${dy}px`,
        scale: `${scale}`,
        transformOrigin: "left bottom",
        fontFamily: word.italic ? fonts.serif : fonts.sans,
        fontStyle: word.italic ? "italic" : "normal",
        fontWeight: word.italic ? 500 : 600,
        color: theme.fg,
        letterSpacing: word.italic ? "0em" : `${track}em`,
      }}
    >
      {word.text}
    </span>
  );
};

/**
 * The Oxford rule — the classic broadsheet double rule, thick over thin.
 * Real newspaper furniture, not a generic divider.
 */
const OxfordRule: React.FC<{
  from: number;
  align: "left" | "center";
}> = ({ from, align }) => (
  <div
    style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5 }}
  >
    <Hairline
      from={from}
      duration={20}
      width="100%"
      align={align}
      thickness={3}
      color={theme.rule}
    />
    <Hairline
      from={from + 4}
      duration={22}
      width="100%"
      align={align}
      thickness={1}
      color={theme.ruleFaint}
    />
  </div>
);

/**
 * Masthead — Oxford rules, dateline strip, kicker and headline stack, in the
 * newspaper-issue motif (scenes 01 and 10). Fraunces italic is reserved for
 * words flagged `italic` (the brand's scarce editorial accent).
 */
export const Masthead: React.FC<{
  kicker?: string;
  lines: Word[][];
  enterFrame?: number;
  wordStagger?: number;
  size?: number;
  align?: "left" | "center";
  showMark?: boolean;
  maxWidth?: number;
}> = ({
  kicker,
  lines,
  enterFrame = 0,
  wordStagger = 7,
  size = 120,
  align = "center",
  showMark = false,
  maxWidth = 1400,
}) => {
  const frame = useCurrentFrame();
  const kickerOpacity = ease(frame, [enterFrame + 6, enterFrame + 22], [0, 1]);
  const datelineOpacity = ease(
    frame,
    [enterFrame + 12, enterFrame + 30],
    [0, 1]
  );

  let wordCounter = 0;
  const firstWordStart = enterFrame + 16;

  const datelineStyle: React.CSSProperties = {
    fontFamily: fonts.mono,
    fontSize: 16,
    letterSpacing: "0.22em",
    color: theme.fgFaint,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: 26,
        maxWidth,
        width: "100%",
      }}
    >
      {showMark ? (
        <div
          style={{
            opacity: ease(frame, [enterFrame, enterFrame + 16], [0, 1]),
          }}
        >
          <KMark size={92} />
        </div>
      ) : null}

      <OxfordRule from={enterFrame} align={align} />

      {/* Dateline strip — issue furniture */}
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: datelineOpacity,
          marginTop: -6,
        }}
      >
        <span style={datelineStyle}>EST. 2026 · BETA</span>
        {kicker ? (
          <div style={{ opacity: kickerOpacity }}>
            <Kicker size={24} color={theme.accentText}>
              {kicker}
            </Kicker>
          </div>
        ) : null}
        <span style={datelineStyle}>KNOWW.APP</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: align === "center" ? "center" : "flex-start",
          gap: 6,
          textAlign: align,
          padding: "18px 0 8px",
        }}
      >
        {lines.map((line, li) => (
          <div
            key={li}
            style={{
              fontSize: size,
              lineHeight: 1.04,
              letterSpacing: "-0.02em",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: align === "center" ? "center" : "flex-start",
              gap: `0 ${size * 0.26}px`,
            }}
          >
            {line.map((word, wi) => {
              const start = firstWordStart + wordCounter * wordStagger;
              wordCounter += 1;
              return <AnimWord key={wi} word={word} start={start} />;
            })}
          </div>
        ))}
      </div>

      <Hairline
        from={enterFrame + 10}
        duration={26}
        width="100%"
        align={align === "center" ? "center" : "left"}
        color={theme.ruleFaint}
      />
    </div>
  );
};
