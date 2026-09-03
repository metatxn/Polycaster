import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { fonts, theme } from "./theme";

export const WEBMCP_IN_APP_DEMO_DURATION = 2700; // 90 seconds at 30fps

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const settle = Easing.bezier(0.16, 1, 0.3, 1);

type ScreenshotSource =
  | "markets-initial"
  | "markets-trending"
  | "fed-market-live"
  | "fed-market-no-change-1w";

const screenshotSources: Record<ScreenshotSource, string> = {
  "markets-initial": "webmcp-captures-high/markets-initial.png",
  "markets-trending": "webmcp-captures-high/markets-trending.png",
  "fed-market-live": "webmcp-captures-high/fed-market-live.png",
  "fed-market-no-change-1w": "webmcp-captures-high/fed-market-no-change-1w.png",
};

const Kicker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      color: theme.accentText,
      fontFamily: fonts.sans,
      fontSize: 22,
      fontWeight: 800,
      letterSpacing: "0.2em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const Enter: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        opacity: interpolate(frame, [delay, delay + 20], [0, 1], {
          easing: settle,
          ...clamp,
        }),
        translate: `0px ${interpolate(frame, [delay, delay + 20], [26, 0], {
          easing: settle,
          ...clamp,
        })}px`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const Screenshot: React.FC<{
  source: ScreenshotSource;
  style?: React.CSSProperties;
}> = ({ source, style }) => (
  <div
    style={{
      background: "#f7f5f1",
      border: "1px solid rgba(240,235,224,0.34)",
      borderRadius: 22,
      boxShadow: "0 30px 80px rgba(0,0,0,0.46)",
      overflow: "hidden",
      ...style,
    }}
  >
    <Img
      src={staticFile(screenshotSources[source])}
      style={{
        display: "block",
        height: "100%",
        objectFit: "cover",
        width: "100%",
      }}
    />
  </div>
);

const Panel: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  title: string;
}> = ({ children, style, title }) => (
  <div
    style={{
      background: "rgba(20, 18, 14, 0.97)",
      border: `1px solid ${theme.rule}`,
      borderRadius: 22,
      boxShadow: "0 24px 60px rgba(0,0,0,0.36)",
      padding: 28,
      ...style,
    }}
  >
    <div
      style={{
        color: theme.accentText,
        fontFamily: fonts.sans,
        fontSize: 18,
        fontWeight: 800,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

const Tool: React.FC<{ description: string; name: string; index: number }> = ({
  description,
  name,
  index,
}) => (
  <Enter delay={22 + index * 9}>
    <div
      style={{
        background: index === 0 ? theme.accentSoft : "rgba(255,255,255,0.035)",
        border: `1px solid ${index === 0 ? "rgba(74,222,128,0.34)" : theme.ruleFaint}`,
        borderRadius: 14,
        marginTop: 12,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          color: index === 0 ? theme.accentText : theme.fg,
          fontFamily: fonts.mono,
          fontSize: 21,
          fontWeight: 700,
        }}
      >
        {name}
      </div>
      <div
        style={{
          color: theme.fgMuted,
          fontFamily: fonts.sans,
          fontSize: 18,
          lineHeight: 1.3,
          marginTop: 6,
        }}
      >
        {description}
      </div>
    </div>
  </Enter>
);

const EventTool: React.FC<{ name: string }> = ({ name }) => (
  <div
    style={{
      background: "rgba(255,255,255,0.035)",
      border: `1px solid ${theme.ruleFaint}`,
      borderRadius: 12,
      color: theme.fg,
      fontFamily: fonts.mono,
      fontSize: 17,
      fontWeight: 700,
      padding: "13px 14px",
    }}
  >
    {name}
  </div>
);

const Footer: React.FC = () => (
  <div
    style={{
      bottom: 30,
      color: theme.fgFaint,
      fontFamily: fonts.mono,
      fontSize: 17,
      left: 100,
      letterSpacing: "0.08em",
      position: "absolute",
      right: 100,
    }}
  >
    LIVE PRODUCTION CAPTURE · KNOWW.APP · CODEX IN-APP BROWSER
  </div>
);

const OpenPage: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Enter>
      <Kicker>Live production walkthrough</Kicker>
      <div
        style={{
          color: theme.fg,
          fontFamily: fonts.sans,
          fontSize: 72,
          fontWeight: 800,
          letterSpacing: "-0.055em",
          lineHeight: 1.03,
          marginTop: 16,
        }}
      >
        Codex opens Knoww in its in-app browser.
      </div>
    </Enter>
    <Enter delay={26} style={{ flex: 1, marginTop: 34 }}>
      <Screenshot
        source="markets-initial"
        style={{ height: 720, width: 1280 }}
      />
    </Enter>
    <Enter delay={52} style={{ position: "absolute", right: 110, top: 246 }}>
      <Panel title="Connected page" style={{ width: 410 }}>
        <div
          style={{
            color: theme.fg,
            fontFamily: fonts.mono,
            fontSize: 23,
            lineHeight: 1.42,
            marginTop: 18,
          }}
        >
          https://knoww.app/markets
        </div>
        <div
          style={{
            alignItems: "center",
            color: theme.accentText,
            display: "flex",
            fontFamily: fonts.sans,
            fontSize: 22,
            fontWeight: 700,
            gap: 12,
            marginTop: 24,
          }}
        >
          <span style={{ fontFamily: fonts.mono }}>✓</span>
          WebMCP available
        </div>
      </Panel>
    </Enter>
    <Footer />
  </AbsoluteFill>
);

const DiscoverTools: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Kicker>Step 1 · tool discovery</Kicker>
    <div
      style={{
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 68,
        fontWeight: 800,
        letterSpacing: "-0.055em",
        lineHeight: 1.04,
        marginTop: 16,
      }}
    >
      The page registers five WebMCP tools.
    </div>
    <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 34 }}>
      <Enter delay={8} style={{ alignSelf: "flex-start", width: 900 }}>
        <Screenshot
          source="markets-initial"
          style={{ height: 506, width: 900 }}
        />
      </Enter>
      <div style={{ flex: 1 }}>
        <Panel title="Codex discovered tools">
          <Tool
            index={0}
            name="get_markets_page_context"
            description="Read the current view and loaded events."
          />
          <Tool
            index={1}
            name="search_events"
            description="Search public prediction-market events."
          />
          <Tool
            index={2}
            name="set_market_filters"
            description="Change only the visible page filters."
          />
          <Tool
            index={3}
            name="open_event"
            description="Open a verified event on the page."
          />
          <Tool
            index={4}
            name="load_more_markets"
            description="Load the next page of events."
          />
        </Panel>
      </div>
    </div>
    <Footer />
  </AbsoluteFill>
);

const ContextCall: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Kicker>Step 2 · live tool call</Kicker>
    <div
      style={{
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 68,
        fontWeight: 800,
        letterSpacing: "-0.055em",
        lineHeight: 1.04,
        marginTop: 16,
      }}
    >
      Read live page context without scraping the UI.
    </div>
    <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 40 }}>
      <Enter delay={8} style={{ alignSelf: "flex-start", width: 870 }}>
        <Screenshot
          source="markets-initial"
          style={{ height: 490, width: 870 }}
        />
      </Enter>
      <Enter delay={26} style={{ flex: 1 }}>
        <Panel title="Codex WebMCP call">
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 27,
              fontWeight: 700,
              marginTop: 22,
            }}
          >
            get_markets_page_context
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 13,
              color: theme.fg,
              fontFamily: fonts.mono,
              fontSize: 22,
              lineHeight: 1.5,
              marginTop: 18,
              padding: 18,
            }}
          >
            {'{ "limit": 1 }'}
          </div>
          <div
            style={{
              borderTop: `1px solid ${theme.ruleFaint}`,
              color: theme.fgMuted,
              fontFamily: fonts.mono,
              fontSize: 20,
              lineHeight: 1.55,
              marginTop: 22,
              paddingTop: 22,
            }}
          >
            {
              '{\n  "view": "categories",\n  "loaded_count": 20,\n  "title": "Fed Decision in September?"\n}'
            }
          </div>
        </Panel>
      </Enter>
    </div>
    <Footer />
  </AbsoluteFill>
);

const SearchCall: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Kicker>Step 3 · live search</Kicker>
    <div
      style={{
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 68,
        fontWeight: 800,
        letterSpacing: "-0.055em",
        lineHeight: 1.04,
        marginTop: 16,
      }}
    >
      Ask for Bitcoin. Get a typed result back.
    </div>
    <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 40 }}>
      <Enter delay={8} style={{ alignSelf: "flex-start", width: 870 }}>
        <Screenshot
          source="markets-initial"
          style={{ height: 490, width: 870 }}
        />
      </Enter>
      <Enter delay={28} style={{ flex: 1 }}>
        <Panel title="Codex WebMCP call">
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 27,
              fontWeight: 700,
              marginTop: 22,
            }}
          >
            search_events
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 13,
              color: theme.fg,
              fontFamily: fonts.mono,
              fontSize: 22,
              lineHeight: 1.5,
              marginTop: 18,
              padding: 18,
            }}
          >
            {'{ "query": "bitcoin", "limit": 1 }'}
          </div>
          <div
            style={{
              borderTop: `1px solid ${theme.ruleFaint}`,
              color: theme.fg,
              fontFamily: fonts.sans,
              fontSize: 29,
              fontWeight: 800,
              lineHeight: 1.2,
              marginTop: 22,
              paddingTop: 22,
            }}
          >
            What price will Bitcoin hit in 2026?
          </div>
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 35,
              fontWeight: 800,
              marginTop: 18,
            }}
          >
            ↓ 75,000 · 86.5¢
          </div>
          <div
            style={{
              color: theme.fgMuted,
              fontFamily: fonts.sans,
              fontSize: 21,
              lineHeight: 1.35,
              marginTop: 15,
            }}
          >
            Returned by the live production page.
          </div>
        </Panel>
      </Enter>
    </div>
    <Footer />
  </AbsoluteFill>
);

const FilterCall: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Kicker>Step 4 · change the visible page</Kicker>
    <div
      style={{
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 68,
        fontWeight: 800,
        letterSpacing: "-0.055em",
        lineHeight: 1.04,
        marginTop: 16,
      }}
    >
      Switch the live markets view to Trending.
    </div>
    <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 40 }}>
      <Enter delay={16} style={{ alignSelf: "flex-start", width: 980 }}>
        <Screenshot
          source="markets-trending"
          style={{ height: 552, width: 980 }}
        />
      </Enter>
      <Enter delay={36} style={{ flex: 1 }}>
        <Panel title="Codex WebMCP call">
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 27,
              fontWeight: 700,
              marginTop: 22,
            }}
          >
            set_market_filters
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 13,
              color: theme.fg,
              fontFamily: fonts.mono,
              fontSize: 22,
              lineHeight: 1.5,
              marginTop: 18,
              padding: 18,
            }}
          >
            {'{ "view": "trending" }'}
          </div>
          <div
            style={{
              alignItems: "center",
              color: theme.accentText,
              display: "flex",
              fontFamily: fonts.sans,
              fontSize: 28,
              fontWeight: 800,
              gap: 15,
              marginTop: 30,
            }}
          >
            <span style={{ fontFamily: fonts.mono }}>✓</span> Applied: Trending
          </div>
          <div
            style={{
              color: theme.fgMuted,
              fontFamily: fonts.sans,
              fontSize: 21,
              lineHeight: 1.4,
              marginTop: 16,
            }}
          >
            It changes only this page view. It does not connect a wallet or
            trade.
          </div>
        </Panel>
      </Enter>
    </div>
    <Footer />
  </AbsoluteFill>
);

const OpenIndividualMarket: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Kicker>Step 5 · open an individual event</Kicker>
    <div
      style={{
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 68,
        fontWeight: 800,
        letterSpacing: "-0.055em",
        lineHeight: 1.04,
        marginTop: 16,
      }}
    >
      Open the individual market Codex just found.
    </div>
    <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 40 }}>
      <Enter delay={10} style={{ alignSelf: "flex-start", width: 980 }}>
        <Screenshot
          source="fed-market-live"
          style={{ height: 552, width: 980 }}
        />
      </Enter>
      <Enter delay={32} style={{ flex: 1 }}>
        <Panel title="Codex WebMCP call">
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 27,
              fontWeight: 700,
              marginTop: 22,
            }}
          >
            open_event
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 13,
              color: theme.fg,
              fontFamily: fonts.mono,
              fontSize: 22,
              lineHeight: 1.5,
              marginTop: 18,
              padding: 18,
            }}
          >
            {'{ "event_id": "481717" }'}
          </div>
          <div
            style={{
              borderTop: `1px solid ${theme.ruleFaint}`,
              color: theme.fg,
              fontFamily: fonts.sans,
              fontSize: 29,
              fontWeight: 800,
              lineHeight: 1.2,
              marginTop: 22,
              paddingTop: 22,
            }}
          >
            Fed Decision in September?
          </div>
          <div
            style={{
              color: theme.fgMuted,
              fontFamily: fonts.mono,
              fontSize: 20,
              lineHeight: 1.5,
              marginTop: 18,
            }}
          >
            {
              '{\n  "opened": true,\n  "path": "/events/detail/fed-decision-in-september-762"\n}'
            }
          </div>
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.sans,
              fontSize: 21,
              fontWeight: 700,
              lineHeight: 1.35,
              marginTop: 20,
            }}
          >
            The page opens only an event already verified on Knoww.
          </div>
        </Panel>
      </Enter>
    </div>
    <Footer />
  </AbsoluteFill>
);

const EventToolDiscovery: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Kicker>Step 6 · event-level tools</Kicker>
    <div
      style={{
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 68,
        fontWeight: 800,
        letterSpacing: "-0.055em",
        lineHeight: 1.04,
        marginTop: 16,
      }}
    >
      The event page registers seven more WebMCP tools.
    </div>
    <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 40 }}>
      <Enter delay={10} style={{ alignSelf: "flex-start", width: 860 }}>
        <Screenshot
          source="fed-market-live"
          style={{ height: 484, width: 860 }}
        />
      </Enter>
      <Enter delay={30} style={{ flex: 1 }}>
        <Panel title="Codex discovered tools">
          <div
            style={{
              color: theme.fgMuted,
              fontFamily: fonts.sans,
              fontSize: 20,
              lineHeight: 1.35,
              marginTop: 14,
            }}
          >
            They work with the current event and selected market.
          </div>
          <div
            style={{
              display: "grid",
              gap: 11,
              gridTemplateColumns: "1fr 1fr",
              marginTop: 20,
            }}
          >
            <EventTool name="get_current_event_context" />
            <EventTool name="find_markets_on_page" />
            <EventTool name="compare_markets" />
            <EventTool name="get_selected_order_book" />
            <EventTool name="select_market_view" />
            <EventTool name="set_chart_range" />
            <EventTool name="prepare_trade" />
          </div>
        </Panel>
      </Enter>
    </div>
    <Footer />
  </AbsoluteFill>
);

const EventContextCall: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Kicker>Step 7 · inspect the individual event</Kicker>
    <div
      style={{
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 68,
        fontWeight: 800,
        letterSpacing: "-0.055em",
        lineHeight: 1.04,
        marginTop: 16,
      }}
    >
      Read the event, its markets, and the current selection.
    </div>
    <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 40 }}>
      <Enter delay={10} style={{ alignSelf: "flex-start", width: 870 }}>
        <Screenshot
          source="fed-market-live"
          style={{ height: 490, width: 870 }}
        />
      </Enter>
      <Enter delay={30} style={{ flex: 1 }}>
        <Panel title="Codex WebMCP call">
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 27,
              fontWeight: 700,
              marginTop: 22,
            }}
          >
            get_current_event_context
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 13,
              color: theme.fg,
              fontFamily: fonts.mono,
              fontSize: 22,
              lineHeight: 1.5,
              marginTop: 18,
              padding: 18,
            }}
          >
            {"{}"}
          </div>
          <div
            style={{
              borderTop: `1px solid ${theme.ruleFaint}`,
              color: theme.fgMuted,
              fontFamily: fonts.mono,
              fontSize: 20,
              lineHeight: 1.55,
              marginTop: 22,
              paddingTop: 22,
            }}
          >
            {
              '{\n  "market_count": 5,\n  "selected": "25 bps increase",\n  "outcome": "Yes",\n  "price": 0.52\n}'
            }
          </div>
        </Panel>
      </Enter>
    </div>
    <Footer />
  </AbsoluteFill>
);

const OrderBookCall: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Kicker>Step 8 · read market depth</Kicker>
    <div
      style={{
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 68,
        fontWeight: 800,
        letterSpacing: "-0.055em",
        lineHeight: 1.04,
        marginTop: 16,
      }}
    >
      Ask for the selected market’s order-book summary.
    </div>
    <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 40 }}>
      <Enter delay={10} style={{ alignSelf: "flex-start", width: 870 }}>
        <Screenshot
          source="fed-market-live"
          style={{ height: 490, width: 870 }}
        />
      </Enter>
      <Enter delay={30} style={{ flex: 1 }}>
        <Panel title="Codex WebMCP call">
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 27,
              fontWeight: 700,
              marginTop: 22,
            }}
          >
            get_selected_order_book
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 13,
              color: theme.fg,
              fontFamily: fonts.mono,
              fontSize: 22,
              lineHeight: 1.5,
              marginTop: 18,
              padding: 18,
            }}
          >
            {'{ "levels": 3 }'}
          </div>
          <div
            style={{
              borderTop: `1px solid ${theme.ruleFaint}`,
              color: theme.fgMuted,
              fontFamily: fonts.mono,
              fontSize: 20,
              lineHeight: 1.55,
              marginTop: 22,
              paddingTop: 22,
            }}
          >
            {
              '{\n  "market": "25 bps increase",\n  "best_bid": 0.51,\n  "best_ask": 0.52,\n  "spread": 0.01\n}'
            }
          </div>
          <div
            style={{
              color: theme.fgMuted,
              fontFamily: fonts.sans,
              fontSize: 20,
              lineHeight: 1.35,
              marginTop: 20,
            }}
          >
            This reads public depth. It does not place an order.
          </div>
        </Panel>
      </Enter>
    </div>
    <Footer />
  </AbsoluteFill>
);

const SelectMarketView: React.FC = () => (
  <AbsoluteFill style={{ padding: "84px 100px" }}>
    <Kicker>Step 9 · inspect another outcome</Kicker>
    <div
      style={{
        color: theme.fg,
        fontFamily: fonts.sans,
        fontSize: 68,
        fontWeight: 800,
        letterSpacing: "-0.055em",
        lineHeight: 1.04,
        marginTop: 16,
      }}
    >
      Change the selected market and chart range.
    </div>
    <div style={{ display: "flex", flex: 1, gap: 34, marginTop: 40 }}>
      <Enter delay={10} style={{ alignSelf: "flex-start", width: 980 }}>
        <Screenshot
          source="fed-market-no-change-1w"
          style={{ height: 552, width: 980 }}
        />
      </Enter>
      <Enter delay={32} style={{ flex: 1 }}>
        <Panel title="Codex WebMCP calls">
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 25,
              fontWeight: 700,
              marginTop: 22,
            }}
          >
            select_market_view
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 13,
              color: theme.fg,
              fontFamily: fonts.mono,
              fontSize: 20,
              lineHeight: 1.5,
              marginTop: 14,
              padding: 16,
            }}
          >
            {'{ "market_id": "2252244", "outcome_index": 0 }'}
          </div>
          <div
            style={{
              color: theme.accentText,
              fontFamily: fonts.sans,
              fontSize: 26,
              fontWeight: 800,
              marginTop: 18,
            }}
          >
            ✓ No change · Yes
          </div>
          <div
            style={{
              borderTop: `1px solid ${theme.ruleFaint}`,
              color: theme.accentText,
              fontFamily: fonts.mono,
              fontSize: 25,
              fontWeight: 700,
              marginTop: 22,
              paddingTop: 20,
            }}
          >
            set_chart_range
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 13,
              color: theme.fg,
              fontFamily: fonts.mono,
              fontSize: 20,
              lineHeight: 1.5,
              marginTop: 14,
              padding: 16,
            }}
          >
            {'{ "range": "1W" }'}
          </div>
          <div
            style={{
              color: theme.fgMuted,
              fontFamily: fonts.sans,
              fontSize: 20,
              lineHeight: 1.35,
              marginTop: 18,
            }}
          >
            These calls update only the visible event page.
          </div>
        </Panel>
      </Enter>
    </div>
    <Footer />
  </AbsoluteFill>
);

const Close: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        padding: "100px",
      }}
    >
      <div
        style={{
          filter: "brightness(0.28) blur(2px)",
          inset: 0,
          position: "absolute",
        }}
      >
        <Screenshot
          source="markets-trending"
          style={{ borderRadius: 0, height: "100%", width: "100%" }}
        />
      </div>
      <div
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(74,222,128,0.26), transparent 44%)",
          inset: 0,
          position: "absolute",
        }}
      />
      <div style={{ position: "relative", textAlign: "center" }}>
        <Kicker>WebMCP on Knoww</Kicker>
        <div
          style={{
            color: theme.fg,
            fontFamily: fonts.sans,
            fontSize: 104,
            fontWeight: 800,
            letterSpacing: "-0.07em",
            lineHeight: 0.96,
            marginTop: 24,
            maxWidth: 1380,
            opacity: interpolate(frame, [10, 36], [0, 1], {
              easing: settle,
              ...clamp,
            }),
          }}
        >
          A real Codex in-app browser. Real production tool calls.
        </div>
        <div
          style={{
            color: theme.accentText,
            fontFamily: fonts.mono,
            fontSize: 34,
            fontWeight: 700,
            marginTop: 42,
          }}
        >
          knoww.app/markets
        </div>
      </div>
      <Footer />
    </AbsoluteFill>
  );
};

export const KnowwWebMcpInAppDemo: React.FC = () => {
  const scenes = [
    { component: OpenPage, duration: 210, name: "01 · Open production page" },
    { component: DiscoverTools, duration: 270, name: "02 · Discover tools" },
    { component: ContextCall, duration: 270, name: "03 · Context call" },
    { component: SearchCall, duration: 270, name: "04 · Search call" },
    { component: FilterCall, duration: 240, name: "05 · Filter call" },
    {
      component: OpenIndividualMarket,
      duration: 240,
      name: "06 · Open individual event",
    },
    {
      component: EventToolDiscovery,
      duration: 240,
      name: "07 · Discover event tools",
    },
    {
      component: EventContextCall,
      duration: 240,
      name: "08 · Event context call",
    },
    { component: OrderBookCall, duration: 240, name: "09 · Order book call" },
    {
      component: SelectMarketView,
      duration: 210,
      name: "10 · Select market view",
    },
    { component: Close, duration: 270, name: "11 · Close" },
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
    </AbsoluteFill>
  );
};
