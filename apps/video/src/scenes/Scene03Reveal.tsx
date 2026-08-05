import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Drift } from "../components/Drift";
import { Grain } from "../components/Grain";
import { InlineCard } from "../components/InlineCard";
import { Kicker } from "../components/Kicker";
import { MockHost } from "../components/MockHost";
import { ease, fade, outro } from "../lib/anim";
import { theme } from "../theme";

export const SCENE_03_DURATION = 240; // 8.0s

/**
 * The reveal — the collage snaps into focus on one X post, then the Knoww
 * inline card materializes directly beneath it. As the card arrives, the host
 * post dims and the card blooms green: the light moves to the market. The
 * odds tick 68¢ → 69¢ with a green flash to prove it's live.
 */
export const Scene03Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  // Snap into focus.
  const blur = ease(frame, [0, 16], [10, 0]);
  const scale = ease(frame, [0, 18], [1.06, 1]);
  const focusOpacity = fade(frame, 0, 12);
  // Spotlight: post dims as the card enters (frame 44).
  const postDim = ease(frame, [48, 66], [1, 0.45]);

  return (
    <AbsoluteFill style={{ opacity: outro(frame, SCENE_03_DURATION) }}>
      <Grain />
      <Drift>
        {/* Kicker, top-left */}
        <div
          style={{
            position: "absolute",
            left: 150,
            top: 110,
            opacity: fade(frame, 10, 26),
          }}
        >
          <Kicker size={24} color={theme.accentText}>
            The market comes to the moment.
          </Kicker>
        </div>

        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              filter: `blur(${blur}px)`,
              scale: `${scale}`,
              opacity: focusOpacity,
            }}
          >
            <MockHost
              variant="feed"
              account="Marcus Vale"
              handle="@onchain_marcus"
              postText="BTC clears 100K before New Year. Book it."
              contentOpacity={postDim}
            >
              <InlineCard
                title="Bitcoin above $100,000 on Dec 31?"
                yesPrice={68}
                noPrice={32}
                enterFrame={44}
                tickTo={69}
                tickFrame={120}
                width={760}
                bloom={0.8}
              />
            </MockHost>
          </div>
        </AbsoluteFill>
      </Drift>
    </AbsoluteFill>
  );
};
