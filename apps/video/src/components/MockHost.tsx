import { fonts, theme } from "../theme";

type Variant = "feed" | "article" | "forum" | "sports";

/** A neutral grey bar — stands in for body copy without cloning any real site. */
const Bar: React.FC<{ w: number | string; h?: number; o?: number }> = ({
  w,
  h = 12,
  o = 1,
}) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: 999,
      background: `rgba(240,235,224,${0.1 * o})`,
    }}
  />
);

const Avatar: React.FC<{ size?: number; hue?: string }> = ({
  size = 52,
  hue = theme.accent,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 999,
      flexShrink: 0,
      background: `linear-gradient(135deg, ${hue}, ${theme.bgCardHi})`,
      opacity: 0.9,
    }}
  />
);

/**
 * Stylized, generic host-page frames — evocative mockups of the surfaces where
 * the internet debates, never pixel-clones of real third-party sites and never
 * real users' content (production guardrail §8).
 */
export const MockHost: React.FC<{
  variant?: Variant;
  account?: string;
  handle?: string;
  postText?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  /** Dims the host post body (not the injected card) — the spotlight moves to the market. */
  contentOpacity?: number;
}> = ({
  variant = "feed",
  account = "Marcus Vale",
  handle = "@onchain_marcus",
  postText = "BTC clears 100K before New Year. Book it.",
  children,
  style,
  contentOpacity = 1,
}) => {
  return (
    <div
      style={{
        width: 820,
        background: theme.bgAlt,
        border: `1px solid ${theme.ruleFaint}`,
        borderRadius: 20,
        padding: 28,
        fontFamily: fonts.sans,
        ...style,
      }}
    >
      {variant === "feed" ? (
        <>
          <div style={{ display: "flex", gap: 16, opacity: contentOpacity }}>
            <Avatar />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{ fontWeight: 700, fontSize: 20, color: theme.fg }}
                >
                  {account}
                </span>
                <span
                  style={{
                    fontSize: 17,
                    color: theme.fgFaint,
                    fontFamily: fonts.sans,
                  }}
                >
                  {handle} · 2h
                </span>
              </div>
              <div
                style={{
                  fontSize: 24,
                  lineHeight: 1.4,
                  color: theme.fg,
                  marginTop: 10,
                }}
              >
                {postText}
              </div>
              <div style={{ display: "flex", gap: 40, marginTop: 18 }}>
                <Bar w={44} h={10} o={0.7} />
                <Bar w={44} h={10} o={0.7} />
                <Bar w={44} h={10} o={0.7} />
                <Bar w={44} h={10} o={0.7} />
              </div>
            </div>
          </div>
          {children ? <div style={{ marginTop: 20 }}>{children}</div> : null}
        </>
      ) : null}

      {variant === "article" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: 15,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: theme.fgFaint,
            }}
          >
            Markets
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: theme.fg,
              lineHeight: 1.25,
            }}
          >
            Rate-cut odds swing as inflation cools further
          </div>
          <Bar w="30%" h={12} o={0.7} />
          <div style={{ height: 8 }} />
          <Bar w="100%" />
          <Bar w="96%" />
          <Bar w="98%" />
          {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
        </div>
      ) : null}

      {variant === "forum" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ display: "flex", gap: 14 }}>
              <Avatar size={40} hue={i ? theme.bgCardHi : theme.accent} />
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <Bar w="42%" h={12} o={0.8} />
                <Bar w="90%" />
                <Bar w="70%" />
              </div>
            </div>
          ))}
          {children ? <div style={{ marginTop: 4 }}>{children}</div> : null}
        </div>
      ) : null}

      {variant === "sports" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderRadius: 12,
              background: theme.bgCard,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar size={40} hue="#5b8def" />
              <span style={{ fontWeight: 700, fontSize: 20, color: theme.fg }}>
                Home
              </span>
            </div>
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 30,
                fontWeight: 700,
                color: theme.fg,
              }}
            >
              2 – 1
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 20, color: theme.fg }}>
                Away
              </span>
              <Avatar size={40} hue="#e0673a" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 14,
                color: theme.accentText,
              }}
            >
              ● LIVE · 68'
            </span>
          </div>
          {children ? <div style={{ marginTop: 4 }}>{children}</div> : null}
        </div>
      ) : null}
    </div>
  );
};
