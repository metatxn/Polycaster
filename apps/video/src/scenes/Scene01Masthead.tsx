import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Masthead } from "../components/Masthead";
import { Stage } from "../components/Stage";
import { outro } from "../lib/anim";

export const SCENE_01_DURATION = 210; // 7.0s

/**
 * Cold open — the masthead. Hairline rules draw in, the small-caps kicker
 * fades up, then the hero line settles in word by word, the final word landing
 * in Fraunces italic (permitted use 1 of 2).
 */
export const Scene01Masthead: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: outro(frame, SCENE_01_DURATION) }}>
      <Stage>
        <Masthead
          enterFrame={6}
          kicker="Issue № 01 — The Prediction Layer"
          size={142}
          lines={[
            [
              { text: "Every" },
              { text: "opinion," },
              { text: "a" },
              { text: "position.", italic: true },
            ],
          ]}
        />
      </Stage>
    </AbsoluteFill>
  );
};
