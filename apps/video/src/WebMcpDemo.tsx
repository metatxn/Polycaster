import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { fonts, theme } from "./theme";

const FPS = 30;
export const WEBMCP_DEMO_DURATION = 1980; // 66 seconds

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const settle = Easing.bezier(0.16, 1, 0.3, 1);

const ToolRow: React.FC<{
  name: string;
  detail: string;
  index: number;
  accent?: boolean;
}> = ({ name, detail, index, accent = false }) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        alignItems: "center",
        background: accent
          ? "rgba(74, 222, 128, 0.12)"
          : "rgba(255,255,255,0.035)",
        border: `1px solid ${accent ? "rgba(74, 222, 128, 0.38)" : theme.ruleFaint}`,
        borderRadius: 18,
        display: "flex",
        gap: 16,
        marginTop: 10,
        opacity: interpolate(frame, [index * 7, index * 7 + 18], [0, 1], {
          easing: settle,
          ...clamp,
        }),
        padding: "13px 16px",
        translate: `0px ${interpolate(
          frame,
          [index * 7, index * 7 + 18],
          [20, 0],
          {
            easing: settle,
            ...clamp,
          }
        )}px`,
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: accent ? theme.accent : "rgba(240,235,224,0.12)",
          borderRadius: 999,
          color: accent ? theme.bg : theme.fgMuted,
          display: "flex",
          fontFamily: fonts.mono,
          fontSize: 20,
          fontWeight: 700,
          height: 36,
          justifyContent: "center",
          width: 36,
        }}
      >
        {accent ? "✓" : "→"}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: accent ? theme.accentText : theme.fg,
            fontFamily: fonts.mono,
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          {name}
        </div>
        <div
          style={{
            color: theme.fgMuted,
            fontFamily: fonts.sans,
            fontSize: 19,
            lineHeight: 1.35,
            marginTop: 5,
          }}
        >
          {detail}
        </div>
      </div>
    </div>
  );
};

const BrowserChrome: React.FC<{
  children: React.ReactNode;
  path: string;
  toolLabel?: string;
}> = ({ children, path, toolLabel }) => {
  return (
    <div
      style={{
        background: "#12110e",
        border: `1px solid ${theme.rule}`,
        borderRadius: 34,
        boxShadow: "0 32px 100px rgba(0,0,0,0.42)",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "#1b1813",
          borderBottom: `1px solid ${theme.ruleFaint}`,
          display: "flex",
          gap: 16,
          padding: "18px 24px",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          {["#ef6a63", "#efb35b", "#4ade80"].map((color) => (
            <div
              key={color}
              style={{
                background: color,
                borderRadius: 999,
                height: 13,
                width: 13,
              }}
            />
          ))}
        </div>
        <div
          style={{
            background: "rgba(255,255,255,0.07)",
            borderRadius: 12,
            color: theme.fgMuted,
            flex: 1,
            fontFamily: fonts.mono,
            fontSize: 20,
            padding: "10px 16px",
          }}
        >
          knoww.app{path}
        </div>
        {toolLabel ? (
          <div
            style={{
              background: theme.accentSoft,
              border: "1px solid rgba(74, 222, 128, 0.35)",
              borderRadius: 999,
              color: theme.accentText,
              fontFamily: fonts.sans,
              fontSize: 18,
              fontWeight: 700,
              padding: "9px 15px",
            }}
          >
            {toolLabel}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
};

const Kicker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      color: theme.accentText,
      fontFamily: fonts.sans,
      fontSize: 24,
      fontWeight: 800,
      letterSpacing: "0.22em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const Caption: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        bottom: 82,
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 37,
        fontWeight: 600,
        left: 160,
        lineHeight: 1.25,
        maxWidth: 1500,
        opacity: interpolate(frame, [10, 30], [0, 1], {
          easing: settle,
          ...clamp,
        }),
        position: "absolute",
      }}
    >
      {children}
    </div>
  );
};

const MarketRows: React.FC = () => {
  const markets = [
    ["Fed Decision in September?", "YES  74¢", "+$3.2M today"],
    ["What price will Bitcoin hit in 2026?", "↓ 75,000  84¢", "+$1.8M today"],
    ["Will the U.S. cut rates this year?", "YES  68¢", "+$640K today"],
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        marginTop: 32,
      }}
    >
      {markets.map(([title, price, volume]) => (
        <div
          key={title}
          style={{
            alignItems: "center",
            background: "rgba(255,255,255,0.035)",
            border: `1px solid ${theme.ruleFaint}`,
            borderRadius: 17,
            display: "flex",
            gap: 24,
            padding: "20px 24px",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                color: theme.fg,
                fontFamily: fonts.sans,
                fontSize: 27,
                fontWeight: 700,
              }}
            >
              {title}
            </div>
            <div
              style={{
                color: theme.fgFaint,
                fontFamily: fonts.mono,
                fontSize: 19,
                marginTop: 7,
              }}
            >
              {volume}
            </div>
          </div>
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 27,
              fontWeight: 700,
            }}
          >
            {price}
          </div>
        </div>
      ))}
    </div>
  );
};

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        padding: "120px 160px",
      }}
    >
      <div
        style={{
          background:
            "radial-gradient(circle at 72% 36%, rgba(74,222,128,0.17), transparent 29%), radial-gradient(circle at 18% 74%, rgba(104,92,255,0.18), transparent 28%)",
          inset: 0,
          position: "absolute",
        }}
      />
      <div style={{ position: "relative", width: "100%" }}>
        <Kicker>Knoww × WebMCP</Kicker>
        <div
          style={{
            color: theme.fg,
            fontFamily: fonts.sans,
            fontSize: 118,
            fontWeight: 800,
            letterSpacing: "-0.07em",
            lineHeight: 0.96,
            marginTop: 28,
            maxWidth: 1300,
            opacity: interpolate(frame, [10, 36], [0, 1], {
              easing: settle,
              ...clamp,
            }),
            translate: `0px ${interpolate(frame, [10, 36], [48, 0], { easing: settle, ...clamp })}px`,
          }}
        >
          Research live odds with an agent. Keep the final call human.
        </div>
        <div
          style={{
            color: theme.fgMuted,
            fontFamily: fonts.sans,
            fontSize: 37,
            lineHeight: 1.35,
            marginTop: 42,
            maxWidth: 1040,
            opacity: interpolate(frame, [40, 66], [0, 1], {
              easing: settle,
              ...clamp,
            }),
          }}
        >
          A 66-second look at the WebMCP tools now live in Knoww.
        </div>
      </div>
      <Caption>
        Knoww makes prediction-market research a shared human-agent workflow.
      </Caption>
    </AbsoluteFill>
  );
};

const ResearchToOdds: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: "110px 160px" }}>
      <Kicker>Start with a research question</Kicker>
      <div
        style={{
          color: theme.fg,
          fontFamily: fonts.sans,
          fontSize: 78,
          fontWeight: 800,
          letterSpacing: "-0.055em",
          lineHeight: 1.02,
          marginTop: 24,
          maxWidth: 1200,
        }}
      >
        MacroGuru frames the scenario. Knoww brings it to live market odds.
      </div>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flex: 1,
          gap: 48,
          marginBottom: 100,
          marginTop: 56,
        }}
      >
        <div
          style={{
            background:
              "linear-gradient(145deg, rgba(104,92,255,0.28), rgba(13,12,27,0.96))",
            border: "1px solid rgba(172,162,255,0.38)",
            borderRadius: 28,
            flex: 1,
            minHeight: 370,
            padding: 44,
          }}
        >
          <div
            style={{ color: "#c4b5fd", fontFamily: fonts.mono, fontSize: 23 }}
          >
            research.knoww.app
          </div>
          <div
            style={{
              color: theme.fg,
              fontFamily: fonts.sans,
              fontSize: 44,
              fontWeight: 800,
              lineHeight: 1.1,
              marginTop: 35,
            }}
          >
            "What would a September rate cut mean?"
          </div>
          <div
            style={{
              color: theme.fgMuted,
              fontFamily: fonts.sans,
              fontSize: 28,
              lineHeight: 1.35,
              marginTop: 28,
            }}
          >
            Scenario. Evidence. Time horizon.
          </div>
        </div>
        <div
          style={{
            color: theme.accentText,
            fontFamily: fonts.mono,
            fontSize: 62,
            opacity: interpolate(frame, [26, 50], [0, 1], {
              easing: settle,
              ...clamp,
            }),
          }}
        >
          →
        </div>
        <div
          style={{
            background:
              "linear-gradient(145deg, rgba(74,222,128,0.18), rgba(12,18,14,0.96))",
            border: "1px solid rgba(74,222,128,0.36)",
            borderRadius: 28,
            flex: 1,
            minHeight: 370,
            padding: 44,
          }}
        >
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 23,
            }}
          >
            knoww.app/markets
          </div>
          <div
            style={{
              color: theme.fg,
              fontFamily: fonts.sans,
              fontSize: 44,
              fontWeight: 800,
              lineHeight: 1.1,
              marginTop: 35,
            }}
          >
            Fed Decision in September?
          </div>
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 48,
              fontWeight: 800,
              marginTop: 33,
            }}
          >
            YES 74¢
          </div>
        </div>
      </div>
      <Caption>
        Research frames the question. The market shows the live price.
      </Caption>
    </AbsoluteFill>
  );
};

const MarketsTools: React.FC = () => {
  return (
    <AbsoluteFill style={{ padding: "90px 160px" }}>
      <Kicker>Production markets page</Kicker>
      <div
        style={{
          color: theme.fg,
          fontFamily: fonts.sans,
          fontSize: 68,
          fontWeight: 800,
          letterSpacing: "-0.055em",
          lineHeight: 1.05,
          marginBottom: 42,
          marginTop: 18,
        }}
      >
        ChatGPT discovers five page tools.
      </div>
      <BrowserChrome path="/markets" toolLabel="5 WebMCP tools">
        <div style={{ display: "flex", gap: 28, padding: 30 }}>
          <div style={{ flex: 1.12, padding: 10 }}>
            <div
              style={{
                color: theme.fg,
                fontFamily: fonts.sans,
                fontSize: 42,
                fontWeight: 800,
              }}
            >
              Prediction markets
            </div>
            <div
              style={{
                color: theme.fgMuted,
                fontFamily: fonts.sans,
                fontSize: 23,
                marginTop: 8,
              }}
            >
              Live public events, ready for research.
            </div>
            <MarketRows />
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.22)",
              border: `1px solid ${theme.ruleFaint}`,
              borderRadius: 24,
              flex: 0.88,
              padding: 26,
            }}
          >
            <div
              style={{
                color: theme.accentText,
                fontFamily: fonts.sans,
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              WebMCP tools
            </div>
            <ToolRow
              name="get_markets_page_context"
              detail="Read view, filters, and loaded events"
              index={0}
              accent
            />
            <ToolRow
              name="search_events"
              detail="Search public prediction-market events"
              index={1}
            />
            <ToolRow
              name="set_market_filters"
              detail="Change only the visible page filters"
              index={2}
            />
            <ToolRow
              name="open_event"
              detail="Open a verified event from the current page"
              index={3}
            />
            <ToolRow
              name="load_more_markets"
              detail="Load one more page when available"
              index={4}
            />
          </div>
        </div>
      </BrowserChrome>
    </AbsoluteFill>
  );
};

const ToolCall: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: "104px 160px" }}>
      <Kicker>One real workflow</Kicker>
      <div
        style={{
          color: theme.fg,
          fontFamily: fonts.sans,
          fontSize: 74,
          fontWeight: 800,
          letterSpacing: "-0.06em",
          lineHeight: 1.03,
          marginTop: 22,
        }}
      >
        Ask for a market. Get structured context back.
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          gap: 40,
          marginBottom: 120,
          marginTop: 48,
        }}
      >
        <div
          style={{
            background: "#15120d",
            border: `1px solid ${theme.rule}`,
            borderRadius: 26,
            flex: 1,
            padding: 38,
          }}
        >
          <div
            style={{
              color: theme.fgFaint,
              fontFamily: fonts.sans,
              fontSize: 23,
              fontWeight: 800,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            Agent call
          </div>
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 34,
              fontWeight: 700,
              marginTop: 28,
            }}
          >
            search_events
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.26)",
              borderRadius: 16,
              color: "#d5d0c6",
              fontFamily: fonts.mono,
              fontSize: 27,
              lineHeight: 1.45,
              marginTop: 24,
              padding: 24,
            }}
          >
            {'{\n  "query": "bitcoin",\n  "limit": 1\n}'}
          </div>
          <div
            style={{
              alignItems: "center",
              background: theme.accent,
              borderRadius: 14,
              color: theme.bg,
              display: "flex",
              fontFamily: fonts.sans,
              fontSize: 26,
              fontWeight: 800,
              justifyContent: "center",
              marginTop: 30,
              padding: "18px 20px",
              width: 210,
            }}
          >
            Run tool
          </div>
        </div>
        <div
          style={{
            background: "#15120d",
            border: "1px solid rgba(74,222,128,0.38)",
            borderRadius: 26,
            flex: 1.2,
            opacity: interpolate(frame, [38, 66], [0, 1], {
              easing: settle,
              ...clamp,
            }),
            padding: 38,
            translate: `0px ${interpolate(frame, [38, 66], [24, 0], { easing: settle, ...clamp })}px`,
          }}
        >
          <div
            style={{
              color: theme.fgFaint,
              fontFamily: fonts.sans,
              fontSize: 23,
              fontWeight: 800,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            Result
          </div>
          <div
            style={{
              color: theme.fg,
              fontFamily: fonts.sans,
              fontSize: 39,
              fontWeight: 800,
              lineHeight: 1.18,
              marginTop: 28,
            }}
          >
            What price will Bitcoin hit in 2026?
          </div>
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 47,
              fontWeight: 800,
              marginTop: 28,
            }}
          >
            ↓ 75,000 · 84¢
          </div>
          <div
            style={{
              color: theme.fgMuted,
              fontFamily: fonts.sans,
              fontSize: 27,
              lineHeight: 1.35,
              marginTop: 30,
            }}
          >
            The answer stays structured and tied to the live page.
          </div>
        </div>
      </div>
      <Caption>
        I tested this exact context read and Bitcoin search on the production
        page.
      </Caption>
    </AbsoluteFill>
  );
};

const EventTools: React.FC = () => {
  const tools = [
    ["get_current_event_context", "Read the current event and outcomes"],
    ["compare_markets", "Compare probabilities on the visible page"],
    ["get_selected_order_book", "Inspect the selected outcome"],
    ["set_chart_range", "Change the visible chart time range"],
    ["prepare_trade", "Fill a draft, never submit it"],
  ];
  return (
    <AbsoluteFill style={{ padding: "90px 160px" }}>
      <Kicker>Event detail view</Kicker>
      <div
        style={{
          color: theme.fg,
          fontFamily: fonts.sans,
          fontSize: 70,
          fontWeight: 800,
          letterSpacing: "-0.055em",
          lineHeight: 1.04,
          marginBottom: 42,
          marginTop: 18,
        }}
      >
        Seven more tools help with the investigation.
      </div>
      <BrowserChrome
        path="/events/detail/fed-decision-in-september-762"
        toolLabel="7 WebMCP tools"
      >
        <div style={{ display: "flex", gap: 28, padding: 30 }}>
          <div style={{ flex: 1, padding: 16 }}>
            <div
              style={{
                color: theme.fg,
                fontFamily: fonts.sans,
                fontSize: 43,
                fontWeight: 800,
              }}
            >
              Fed Decision in September?
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 30 }}>
              <div
                style={{
                  background: theme.accentSoft,
                  border: "1px solid rgba(74,222,128,0.4)",
                  borderRadius: 16,
                  color: theme.accentText,
                  fontFamily: fonts.mono,
                  fontSize: 35,
                  fontWeight: 800,
                  padding: "20px 28px",
                }}
              >
                YES 74¢
              </div>
              <div
                style={{
                  background: theme.dangerSoft,
                  border: "1px solid rgba(248,113,113,0.35)",
                  borderRadius: 16,
                  color: theme.dangerText,
                  fontFamily: fonts.mono,
                  fontSize: 35,
                  fontWeight: 800,
                  padding: "20px 28px",
                }}
              >
                NO 26¢
              </div>
            </div>
            <div
              style={{
                background:
                  "linear-gradient(155deg, rgba(74,222,128,0.28), transparent 52%), rgba(255,255,255,0.03)",
                border: `1px solid ${theme.ruleFaint}`,
                borderRadius: 20,
                height: 255,
                marginTop: 26,
                overflow: "hidden",
                position: "relative",
              }}
            >
              <svg height="255" viewBox="0 0 800 255" width="100%">
                <title>One-week market price chart</title>
                <polyline
                  fill="none"
                  points="0,202 82,181 162,188 238,132 316,156 402,96 492,112 582,71 660,88 800,32"
                  stroke="#6ee7a0"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="7"
                />
              </svg>
              <div
                style={{
                  bottom: 18,
                  color: theme.fgMuted,
                  fontFamily: fonts.mono,
                  fontSize: 18,
                  position: "absolute",
                  right: 22,
                }}
              >
                1W chart range
              </div>
            </div>
          </div>
          <div style={{ flex: 0.95, padding: 8 }}>
            {tools.map(([name, detail], index) => (
              <ToolRow
                key={name}
                name={name}
                detail={detail}
                index={index}
                accent={index === 4}
              />
            ))}
          </div>
        </div>
      </BrowserChrome>
    </AbsoluteFill>
  );
};

const Guardrails: React.FC = () => {
  const frame = useCurrentFrame();
  const rules = [
    "Typed inputs",
    "Bounded filters",
    "Verified internal navigation",
    "Public results marked untrusted",
    "No wallet connection or order submission",
  ];
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        padding: "110px 160px",
      }}
    >
      <div style={{ maxWidth: 1500, width: "100%" }}>
        <Kicker>Human control is the point</Kicker>
        <div
          style={{
            color: theme.fg,
            fontFamily: fonts.sans,
            fontSize: 88,
            fontWeight: 800,
            letterSpacing: "-0.065em",
            lineHeight: 1,
            marginTop: 24,
          }}
        >
          Enough agency to help. Not enough to act for you.
        </div>
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "1fr 1fr",
            marginTop: 54,
          }}
        >
          {rules.map((rule, index) => (
            <div
              key={rule}
              style={{
                alignItems: "center",
                background:
                  index === rules.length - 1
                    ? theme.accentSoft
                    : "rgba(255,255,255,0.035)",
                border: `1px solid ${index === rules.length - 1 ? "rgba(74,222,128,0.42)" : theme.ruleFaint}`,
                borderRadius: 18,
                color: index === rules.length - 1 ? theme.accentText : theme.fg,
                display: "flex",
                fontFamily: fonts.sans,
                fontSize: 31,
                fontWeight: 700,
                gap: 18,
                opacity: interpolate(
                  frame,
                  [index * 9, index * 9 + 20],
                  [0, 1],
                  { easing: settle, ...clamp }
                ),
                padding: "24px 28px",
              }}
            >
              <span style={{ color: theme.accentText, fontFamily: fonts.mono }}>
                ✓
              </span>
              {rule}
            </div>
          ))}
        </div>
      </div>
      <Caption>
        WebMCP gives agents useful, visible actions while people retain
        authority.
      </Caption>
    </AbsoluteFill>
  );
};

const Close: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        padding: "120px 160px",
      }}
    >
      <div
        style={{
          background:
            "radial-gradient(circle at 50% 38%, rgba(74,222,128,0.2), transparent 31%)",
          inset: 0,
          position: "absolute",
        }}
      />
      <div style={{ position: "relative", textAlign: "center" }}>
        <Kicker>Live now on knoww.app</Kicker>
        <div
          style={{
            color: theme.fg,
            fontFamily: fonts.sans,
            fontSize: 118,
            fontWeight: 800,
            letterSpacing: "-0.075em",
            lineHeight: 0.94,
            margin: "30px auto 0",
            maxWidth: 1450,
            opacity: interpolate(frame, [14, 42], [0, 1], {
              easing: settle,
              ...clamp,
            }),
          }}
        >
          Better research. Shared control.
        </div>
        <div
          style={{
            color: theme.accentText,
            fontFamily: fonts.mono,
            fontSize: 38,
            fontWeight: 700,
            marginTop: 48,
          }}
        >
          knoww.app/markets
        </div>
      </div>
      <Caption>
        Knoww WebMCP, built for people and agents working together.
      </Caption>
    </AbsoluteFill>
  );
};

export const KnowwWebMcpDemo: React.FC = () => {
  const scenes = [
    { component: Intro, duration: 180, name: "01 · Intro" },
    { component: ResearchToOdds, duration: 270, name: "02 · Research to odds" },
    { component: MarketsTools, duration: 330, name: "03 · Markets tools" },
    { component: ToolCall, duration: 300, name: "04 · Tool call" },
    { component: EventTools, duration: 300, name: "05 · Event tools" },
    { component: Guardrails, duration: 300, name: "06 · Guardrails" },
    { component: Close, duration: 300, name: "07 · Close" },
  ] as const;

  let from = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Audio src={staticFile("score.wav")} volume={0.16} />
      {scenes.map(({ component: Scene, duration, name }) => {
        const start = from;
        from += duration;
        return (
          <Sequence
            key={name}
            from={start}
            durationInFrames={duration}
            name={name}
          >
            <Scene />
          </Sequence>
        );
      })}
      <div
        style={{
          borderTop: `1px solid ${theme.ruleFaint}`,
          bottom: 30,
          color: theme.fgFaint,
          fontFamily: fonts.mono,
          fontSize: 17,
          left: 160,
          letterSpacing: "0.08em",
          paddingTop: 16,
          position: "absolute",
          right: 160,
        }}
      >
        WEBMCP DEMO · {Math.round(WEBMCP_DEMO_DURATION / FPS)} SECONDS · KNOWW
      </div>
    </AbsoluteFill>
  );
};
