import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { BrowserVignette } from "../components/BrowserVignette";
import { Drift } from "../components/Drift";
import { Grain } from "../components/Grain";
import { Sparkline } from "../components/Sparkline";
import { CLAMP, ease, fade, outro } from "../lib/anim";
import { fonts, theme } from "../theme";

export const SCENE_07_DURATION = 390; // 13.0s

const V1 = 0;
const V2 = 128;
const V3 = 256;

const SPARK_A = [0.3, 0.36, 0.32, 0.44, 0.5, 0.46, 0.58, 0.64, 0.7, 0.66, 0.74];
const SPARK_B = [
  0.5, 0.46, 0.52, 0.48, 0.55, 0.6, 0.58, 0.64, 0.62, 0.68, 0.72,
];

/** Small helper: a value that counts up in mono. */
const countUp = (frame: number, start: number, from: number, to: number) =>
  Math.round(interpolate(frame, [start, start + 60], [from, to], CLAMP));

const Panel: React.FC<{ start: number; children: React.ReactNode }> = ({
  start,
  children,
}) => {
  const frame = useCurrentFrame();
  const dx = ease(frame, [start, start + 8], [46, 0]);
  const op = fade(frame, start, start + 6);
  return (
    <AbsoluteFill
      style={{ translate: `${dx}px 0px`, opacity: op, padding: 32 }}
    >
      {children}
    </AbsoluteFill>
  );
};

const MarketCard: React.FC<{
  title: string;
  yes: number;
  no: number;
  spark: number[];
  from: number;
  highlight?: boolean;
}> = ({ title, yes, no, spark, from, highlight }) => (
  <div
    style={{
      flex: 1,
      minWidth: 0,
      padding: 20,
      borderRadius: 14,
      background: theme.bgAlt,
      border: `1px solid ${highlight ? `color-mix(in srgb, ${theme.accent} 30%, transparent)` : theme.ruleFaint}`,
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}
  >
    <div
      style={{
        fontFamily: fonts.sans,
        fontSize: 19,
        fontWeight: 600,
        color: theme.fg,
      }}
    >
      {title}
    </div>
    <Sparkline
      values={spark}
      width={220}
      height={44}
      from={from}
      duration={30}
      dot={false}
    />
    <div style={{ display: "flex", gap: 10 }}>
      <div
        style={{
          flex: 1,
          textAlign: "center",
          padding: "8px 0",
          borderRadius: 8,
          background: theme.accentSoft,
          fontFamily: fonts.mono,
          fontSize: 18,
          color: theme.accentText,
          fontWeight: 700,
        }}
      >
        YES {yes}¢
      </div>
      <div
        style={{
          flex: 1,
          textAlign: "center",
          padding: "8px 0",
          borderRadius: 8,
          background: theme.dangerSoft,
          fontFamily: fonts.mono,
          fontSize: 18,
          color: theme.dangerText,
          fontWeight: 700,
        }}
      >
        NO {no}¢
      </div>
    </div>
  </div>
);

const MarketsVignette: React.FC = () => {
  const frame = useCurrentFrame();
  const showDetail = frame >= V1 + 48;
  return (
    <Panel start={V1}>
      {!showDetail ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            height: "100%",
          }}
        >
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 26,
              fontWeight: 700,
              color: theme.fg,
            }}
          >
            Markets
          </div>
          <div style={{ display: "flex", gap: 18 }}>
            <MarketCard
              title="Bitcoin above $100k?"
              yes={69}
              no={31}
              spark={SPARK_A}
              from={V1 + 8}
              highlight
            />
            <MarketCard
              title="Fed cuts in December?"
              yes={74}
              no={26}
              spark={SPARK_B}
              from={V1 + 12}
            />
            <MarketCard
              title="ETH above $5,000?"
              yes={43}
              no={57}
              spark={SPARK_A}
              from={V1 + 16}
            />
          </div>
          <div style={{ display: "flex", gap: 18 }}>
            <MarketCard
              title="Nominee confirmed by March?"
              yes={58}
              no={42}
              spark={SPARK_B}
              from={V1 + 20}
            />
            <MarketCard
              title="Team clinches the title?"
              yes={61}
              no={39}
              spark={SPARK_A}
              from={V1 + 24}
            />
            <MarketCard
              title="GDP beats forecast?"
              yes={47}
              no={53}
              spark={SPARK_B}
              from={V1 + 28}
            />
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            height: "100%",
          }}
        >
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 30,
              fontWeight: 700,
              color: theme.fg,
            }}
          >
            Bitcoin above $100,000 on Dec 31?
          </div>
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 22,
                color: theme.accentText,
              }}
            >
              YES 69¢
            </span>
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 22,
                color: theme.dangerText,
              }}
            >
              NO 31¢
            </span>
          </div>
          <div
            style={{
              flex: 1,
              borderRadius: 16,
              background: theme.bgAlt,
              border: `1px solid ${theme.ruleFaint}`,
              padding: 28,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Sparkline
              values={[
                0.28, 0.34, 0.3, 0.42, 0.4, 0.5, 0.56, 0.52, 0.62, 0.68, 0.66,
                0.72,
              ]}
              width={1180}
              height={300}
              from={V1 + 52}
              duration={44}
              strokeWidth={3.5}
              fill
            />
          </div>
        </div>
      )}
    </Panel>
  );
};

const Row: React.FC<{
  label: string;
  side: "YES" | "NO";
  value: string;
  pnl: string;
  loss?: boolean;
}> = ({ label, side, value, pnl, loss }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "23px 22px",
      borderRadius: 12,
      background: theme.bgAlt,
      border: `1px solid ${theme.ruleFaint}`,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: 14,
          fontWeight: 700,
          padding: "4px 10px",
          borderRadius: 6,
          background: side === "YES" ? theme.accentSoft : theme.dangerSoft,
          color: side === "YES" ? theme.accentText : theme.dangerText,
        }}
      >
        {side}
      </span>
      <span style={{ fontFamily: fonts.sans, fontSize: 20, color: theme.fg }}>
        {label}
      </span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
      <span
        style={{ fontFamily: fonts.mono, fontSize: 20, color: theme.fgMuted }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: 20,
          fontWeight: 700,
          width: 110,
          textAlign: "right",
          color: loss ? theme.dangerText : theme.accentText,
        }}
      >
        {pnl}
      </span>
    </div>
  </div>
);

const PortfolioVignette: React.FC = () => {
  const frame = useCurrentFrame();
  const value = countUp(frame, V2 + 6, 12180, 12460);
  const valueStr = `$${value.toLocaleString("en-US")}`;
  return (
    <Panel start={V2}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 22,
          height: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 26,
              fontWeight: 700,
              color: theme.fg,
            }}
          >
            Portfolio
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: fonts.sans,
                fontSize: 15,
                color: theme.fgFaint,
                letterSpacing: "0.1em",
              }}
            >
              PORTFOLIO VALUE
            </div>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 44,
                fontWeight: 700,
                color: theme.fg,
              }}
            >
              {valueStr}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Row
            label="Bitcoin above $100,000?"
            side="YES"
            value="$1,240"
            pnl="320"
          />
          <Row label="Fed cuts in December?" side="NO" value="$860" pnl="128" />
          <Row
            label="Team clinches the title?"
            side="YES"
            value="$540"
            pnl="76"
          />
          <Row
            label="ETH above $5,000?"
            side="YES"
            value="$460"
            pnl="-60"
            loss
          />
        </div>
      </div>
    </Panel>
  );
};

const WhalesVignette: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Panel start={V3}>
      <div style={{ display: "flex", gap: 24, height: "100%" }}>
        {/* Whales feed */}
        <div
          style={{
            flex: 1.3,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 26,
              fontWeight: 700,
              color: theme.fg,
            }}
          >
            Whales
          </div>
          <div
            style={{
              padding: 24,
              borderRadius: 14,
              background: `color-mix(in srgb, ${theme.accent} 12%, ${theme.bgAlt})`,
              border: `1px solid color-mix(in srgb, ${theme.accent} 34%, transparent)`,
              opacity: fade(frame, V3 + 8, V3 + 24),
            }}
          >
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 16,
                color: theme.fgMuted,
              }}
            >
              0x9f4c…c2a1
            </div>
            <div
              style={{
                fontFamily: fonts.sans,
                fontSize: 22,
                color: theme.fg,
                marginTop: 8,
              }}
            >
              bought{" "}
              <span
                style={{
                  fontFamily: fonts.mono,
                  color: theme.accentText,
                  fontWeight: 700,
                }}
              >
                $84,000
              </span>{" "}
              YES · Bitcoin above $100k
            </div>
          </div>
          {[
            "0x2b…7f · $22,400 YES",
            "0x88…19 · $16,900 NO",
            "0x4d…a0 · $11,250 YES",
          ].map((t, i) => (
            <div
              key={t}
              style={{
                padding: "16px 22px",
                borderRadius: 12,
                background: theme.bgAlt,
                border: `1px solid ${theme.ruleFaint}`,
                fontFamily: fonts.mono,
                fontSize: 18,
                color: theme.fgMuted,
                opacity: fade(frame, V3 + 16 + i * 6, V3 + 30 + i * 6),
              }}
            >
              {t}
            </div>
          ))}
        </div>
        {/* Leaderboard */}
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 26,
              fontWeight: 700,
              color: theme.fg,
            }}
          >
            Leaderboard
          </div>
          {[
            { r: "01", n: "prophet.eth", p: "184,200" },
            { r: "02", n: "0x51…d9", p: "142,780" },
            { r: "03", n: "calibrated", p: "98,540" },
          ].map((row, i) => (
            <div
              key={row.r}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "18px 22px",
                borderRadius: 12,
                background: theme.bgAlt,
                border: `1px solid ${theme.ruleFaint}`,
                opacity: fade(frame, V3 + 20 + i * 6, V3 + 34 + i * 6),
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 22,
                    fontWeight: 700,
                    color: theme.accentText,
                  }}
                >
                  {row.r}
                </span>
                <span
                  style={{
                    fontFamily: fonts.sans,
                    fontSize: 20,
                    color: theme.fg,
                  }}
                >
                  {row.n}
                </span>
              </div>
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 20,
                  fontWeight: 700,
                  color: theme.accentText,
                }}
              >
                {row.p}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
};

/**
 * The web app — three product vignettes inside browser chrome, cut hard (no
 * crossfade): markets & event detail, portfolio, whales & leaderboard. Numbers
 * are mono; P&L greens carry no `+`, the single loss keeps its `-`.
 */
export const Scene07WebApp: React.FC = () => {
  const frame = useCurrentFrame();
  const label =
    frame < V2 ? "Markets" : frame < V3 ? "Portfolio" : "Whales & Leaderboard";

  return (
    <AbsoluteFill style={{ opacity: outro(frame, SCENE_07_DURATION) }}>
      <Grain />
      <Drift>
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <BrowserVignette url="knoww.app" width={1500} height={660}>
            {frame < V2 ? <MarketsVignette /> : null}
            {frame >= V2 && frame < V3 ? <PortfolioVignette /> : null}
            {frame >= V3 ? <WhalesVignette /> : null}
          </BrowserVignette>
        </AbsoluteFill>
      </Drift>

      {/* Per-vignette small-caps label */}
      <div style={{ position: "absolute", left: 150, top: 96 }}>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 600,
            fontSize: 22,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: theme.accentText,
          }}
        >
          {label}
        </div>
      </div>

      {/* Footnote */}
      <div
        style={{
          position: "absolute",
          right: 150,
          bottom: 70,
          fontFamily: fonts.mono,
          fontSize: 20,
          color: theme.fgMuted,
          opacity: fade(frame, 20, 40),
        }}
      >
        14K+ markets via Polymarket
      </div>
    </AbsoluteFill>
  );
};
