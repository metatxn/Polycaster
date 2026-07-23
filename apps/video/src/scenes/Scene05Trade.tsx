import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Drift } from "../components/Drift";
import { Grain } from "../components/Grain";
import { InlineCard } from "../components/InlineCard";
import { Kicker } from "../components/Kicker";
import { MockHost } from "../components/MockHost";
import { CLAMP, ease, fade, outro } from "../lib/anim";
import { fonts, theme } from "../theme";

export const SCENE_05_DURATION = 360; // 12.0s

// Layout anchors (px, 1920×1080). Card sits ~146px below the MockHost top.
const HOST_LEFT = 550;
const HOST_TOP = 150;
const CARD_TOP = HOST_TOP + 146;
const YES = { x: 735, y: CARD_TOP + 122 };
const CONFIRM = { x: 958, y: CARD_TOP + 320 };

const CLICK_YES = 46;
const OPEN = 54;
const CLICK_CONFIRM = 200;
const FILL = 205;

const press = (frame: number, f: number) =>
  interpolate(frame, [f - 3, f, f + 6], [1, 0.82, 1], CLAMP);

/**
 * Trade without breaking flow — the cursor clicks YES, the card expands into
 * the inline trading panel, one click confirms, and the fill lands as a quiet
 * green check. The host feed stays visible behind the whole time.
 */
export const Scene05Trade: React.FC = () => {
  const frame = useCurrentFrame();

  const cx = interpolate(
    frame,
    [16, CLICK_YES, 150, CLICK_CONFIRM - 20],
    [1420, YES.x, YES.x, CONFIRM.x],
    CLAMP
  );
  const cy = interpolate(
    frame,
    [16, CLICK_YES, 150, CLICK_CONFIRM - 20],
    [820, YES.y, YES.y, CONFIRM.y],
    CLAMP
  );
  const cursorPress = Math.min(
    press(frame, CLICK_YES),
    press(frame, CLICK_CONFIRM)
  );

  const ripple = (f: number) => interpolate(frame, [f, f + 18], [0, 1], CLAMP);

  return (
    <AbsoluteFill style={{ opacity: outro(frame, SCENE_05_DURATION) }}>
      <Grain />
      <Drift>
        {/* Faint host feed behind, to show context never breaks */}
        <div
          style={{
            position: "absolute",
            left: HOST_LEFT,
            top: HOST_TOP - 250,
            opacity: 0.28,
            filter: "blur(2px)",
          }}
        >
          <MockHost variant="forum" />
        </div>

        {/* Kicker */}
        <div
          style={{
            position: "absolute",
            left: 150,
            top: 90,
            opacity: fade(frame, 6, 22),
          }}
        >
          <Kicker size={24} color={theme.accentText}>
            Trade without breaking flow
          </Kicker>
        </div>

        {/* The live post + inline card */}
        <div style={{ position: "absolute", left: HOST_LEFT, top: HOST_TOP }}>
          <MockHost
            variant="feed"
            account="Marcus Vale"
            handle="@onchain_marcus"
            postText="BTC clears 100K before New Year. Book it."
            contentOpacity={ease(frame, [OPEN, OPEN + 16], [1, 0.5])}
          >
            <InlineCard
              title="Bitcoin above $100,000 on Dec 31?"
              yesPrice={68}
              noPrice={32}
              tickTo={69}
              tickFrame={10}
              openFrame={OPEN}
              fillFrame={FILL}
              width={760}
              bloom={0.6}
            />
          </MockHost>
        </div>

        {/* Cursor + click ripples */}
        {[CLICK_YES, CLICK_CONFIRM].map((f) => {
          const rp = ripple(f);
          if (rp <= 0 || rp >= 1) return null;
          const at = f === CLICK_YES ? YES : CONFIRM;
          return (
            <div
              key={f}
              style={{
                position: "absolute",
                left: at.x,
                top: at.y,
                width: 12 + rp * 70,
                height: 12 + rp * 70,
                marginLeft: -(6 + rp * 35),
                marginTop: -(6 + rp * 35),
                borderRadius: 999,
                border: `2px solid ${theme.accent}`,
                opacity: 1 - rp,
              }}
            />
          );
        })}
        <div
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            zIndex: 40,
            opacity: fade(frame, 8, 18),
          }}
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            style={{ scale: `${cursorPress}`, transformOrigin: "top left" }}
            role="img"
            aria-label="Cursor"
          >
            <title>Cursor</title>
            <path
              d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.5 L12 13.5 L19 13.5 Z"
              fill={theme.fg}
              stroke={theme.bg}
              strokeWidth="1.2"
            />
          </svg>
        </div>

        {/* First-time hint (verbatim intent from VO) */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 90,
            textAlign: "center",
            opacity: fade(frame, 250, 280) * (1 - fade(frame, 340, 358)),
            fontFamily: fonts.sans,
            color: theme.fgMuted,
            fontSize: 22,
            fontWeight: 500,
            translate: `0px ${ease(frame, [250, 280], [12, 0])}px`,
          }}
        >
          First time? A couple of quick signatures and you're trading from the
          card.
        </div>
      </Drift>
    </AbsoluteFill>
  );
};
