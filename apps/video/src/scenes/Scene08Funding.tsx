import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Grain } from "../components/Grain";
import { KMark } from "../components/KMark";
import { CLAMP, ease, fade, outro } from "../lib/anim";
import { fonts, theme } from "../theme";

export const SCENE_08_DURATION = 150; // 5.0s

const TAP = 62;

const Option: React.FC<{
  label: string;
  active?: boolean;
  tapped?: boolean;
  delay: number;
}> = ({ label, active, tapped, delay }) => {
  const frame = useCurrentFrame();
  const op = fade(frame, delay, delay + 12);
  const dy = ease(frame, [delay, delay + 12], [14, 0]);
  const press = tapped
    ? interpolate(frame, [TAP - 3, TAP, TAP + 8], [1, 0.98, 1], CLAMP)
    : 1;
  const lit = active && frame >= TAP;
  return (
    <div
      style={{
        opacity: op,
        translate: `0px ${dy}px`,
        scale: `${press}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "22px 26px",
        borderRadius: 14,
        background: lit
          ? `color-mix(in srgb, ${theme.accent} 16%, ${theme.bgAlt})`
          : theme.bgAlt,
        border: `1px solid ${lit ? `color-mix(in srgb, ${theme.accent} 40%, transparent)` : theme.ruleFaint}`,
      }}
    >
      <span
        style={{
          fontFamily: fonts.sans,
          fontSize: 24,
          fontWeight: 600,
          color: theme.fg,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: 18,
          color: lit ? theme.accentText : theme.fgFaint,
        }}
      >
        {lit ? "✓" : "→"}
      </span>
    </div>
  );
};

/**
 * Funding, in passing — the deposit sheet shown matter-of-factly. One tap on
 * Card updates the balance in mono. One signature approves trading.
 */
export const Scene08Funding: React.FC = () => {
  const frame = useCurrentFrame();
  const sheetOp = fade(frame, 4, 20);
  const sheetDy = ease(frame, [4, 22], [30, 0]);
  const balance = Math.round(
    interpolate(frame, [TAP + 6, TAP + 40], [0, 250], CLAMP)
  );

  return (
    <AbsoluteFill style={{ opacity: outro(frame, SCENE_08_DURATION) }}>
      <Grain />
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 640,
            opacity: sheetOp,
            translate: `0px ${sheetDy}px`,
            padding: 34,
            borderRadius: 22,
            background: theme.bgCard,
            border: `1px solid ${theme.ruleFaint}`,
            boxShadow: "0 40px 110px -50px rgba(0,0,0,0.85)",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <KMark size={34} />
              <span
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 26,
                  fontWeight: 700,
                  color: theme.fg,
                }}
              >
                Add funds
              </span>
            </div>
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 22,
                color: theme.accentText,
              }}
            >
              ${balance.toFixed(2)}
            </span>
          </div>

          <Option label="Deposit with Card" active tapped delay={16} />
          <Option label="Deposit with PayPal" delay={24} />
          <Option label="Deposit from any supported chain" delay={32} />
        </div>
      </AbsoluteFill>

      {/* OST */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 120,
        }}
      >
        <div
          style={{
            opacity: fade(frame, 96, 118),
            fontFamily: fonts.sans,
            fontSize: 30,
            fontWeight: 500,
            color: theme.fgMuted,
            textAlign: "center",
          }}
        >
          Allow Knoww to move USDC for your trades. One signature.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
