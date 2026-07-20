import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketsView, type MarketViewEvent } from "./markets-view";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} src={String(src ?? "")} {...props} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-price-history-batch", () => ({
  useBatchPriceHistory: () => ({ data: new Map(), isLoading: false }),
}));

const worldCupConcedeEvent: MarketViewEvent = {
  id: "587588",
  slug: "world-cup-team-to-concede-the-most-goals-group-stage",
  title: "World Cup: Team to Concede the Most Goals (Group Stage)",
  image: "/logo-256x256.png",
  volume24hr: 1250,
  liquidityClob: 12_520,
  markets: [
    {
      id: "placeholder-a",
      question:
        "Will Team A concede the most goals in the 2026 FIFA World Cup Group Stage?",
      groupItemTitle: "Team A",
      outcomes: JSON.stringify(["Yes", "No"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      clobTokenIds: JSON.stringify(["team-a-yes", "team-a-no"]),
    },
    {
      id: "placeholder-b",
      question:
        "Will Team B concede the most goals in the 2026 FIFA World Cup Group Stage?",
      groupItemTitle: "Team B",
      outcomes: JSON.stringify(["Yes", "No"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      clobTokenIds: JSON.stringify(["team-b-yes", "team-b-no"]),
    },
    {
      id: "other",
      question:
        "Will another team concede the most goals in the 2026 FIFA World Cup Group Stage?",
      groupItemTitle: "Other",
      outcomes: JSON.stringify(["Yes", "No"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      clobTokenIds: JSON.stringify(["other-yes", "other-no"]),
    },
    {
      id: "scotland",
      question:
        "Will Scotland concede the most goals in the 2026 FIFA World Cup Group Stage?",
      groupItemTitle: "Scotland",
      outcomes: JSON.stringify(["Yes", "No"]),
      outcomePrices: JSON.stringify(["0.24", "0.76"]),
      clobTokenIds: JSON.stringify(["scotland-yes", "scotland-no"]),
    },
    {
      id: "curacao",
      question:
        "Will Curaçao concede the most goals in the 2026 FIFA World Cup Group Stage?",
      groupItemTitle: "Curaçao",
      outcomes: JSON.stringify(["Yes", "No"]),
      outcomePrices: JSON.stringify(["0.14", "0.86"]),
      clobTokenIds: JSON.stringify(["curacao-yes", "curacao-no"]),
    },
  ],
};

function makeMultiOutcomeEvent(
  id: string,
  title: string,
  volume24hr: number
): MarketViewEvent {
  return {
    ...worldCupConcedeEvent,
    id,
    slug: id,
    title,
    volume24hr,
    markets: worldCupConcedeEvent.markets?.map((market, i) => ({
      ...market,
      id: `${id}-${i}`,
      clobTokenIds: JSON.stringify([`${id}-${i}-yes`, `${id}-${i}-no`]),
    })),
  };
}

function makeBinaryEvent(
  id: string,
  title: string,
  volume24hr: number
): MarketViewEvent {
  return {
    id,
    slug: id,
    title,
    image: "/logo-256x256.png",
    volume24hr,
    liquidityClob: 5_000,
    markets: [
      {
        id: `${id}-market`,
        question: title,
        outcomes: JSON.stringify(["Yes", "No"]),
        outcomePrices: JSON.stringify(["0.99", "0.01"]),
        clobTokenIds: JSON.stringify([`${id}-yes`, `${id}-no`]),
      },
    ],
  };
}

function getFeaturedTitles(): string[] {
  return Array.from(document.querySelectorAll(".kwm-tob-card")).map(
    (card) => card.textContent ?? ""
  );
}

describe("MarketsView", () => {
  it("keeps binary markets out of Top of Book when multi-outcome events fill it", () => {
    const binary = makeBinaryEvent("binary-1", "Binary Question Event", 9_999);
    const events = [
      binary,
      makeMultiOutcomeEvent("multi-1", "Multi Event One", 500),
      makeMultiOutcomeEvent("multi-2", "Multi Event Two", 400),
      makeMultiOutcomeEvent("multi-3", "Multi Event Three", 300),
    ];

    render(
      <MarketsView events={events} viewMode="new" onViewChange={() => {}} />
    );

    const featuredTitles = getFeaturedTitles();
    expect(featuredTitles).toHaveLength(3);
    expect(featuredTitles.join(" ")).not.toContain("Binary Question Event");
    // The deferred binary still surfaces in The Book table below.
    expect(screen.getAllByText("Binary Question Event").length).toBeGreaterThan(
      0
    );
  });

  it("backfills Top of Book with binary events when multi-outcome events run short", () => {
    const events = [
      makeBinaryEvent("binary-1", "Binary Question Event", 9_999),
      makeMultiOutcomeEvent("multi-1", "Multi Event One", 500),
    ];

    render(
      <MarketsView events={events} viewMode="new" onViewChange={() => {}} />
    );

    const featuredTitles = getFeaturedTitles();
    expect(featuredTitles).toHaveLength(2);
    // Multi-outcome leads the strip; the binary fills the empty slot.
    expect(featuredTitles[0]).toContain("Multi Event One");
    expect(featuredTitles[1]).toContain("Binary Question Event");
  });

  it("omits generic placeholder candidates from market summaries", () => {
    render(
      <MarketsView
        events={[worldCupConcedeEvent]}
        viewMode="new"
        onViewChange={() => {}}
      />
    );

    const card = screen.getByRole("link", {
      name: /World Cup: Team to Concede the Most Goals/i,
    });

    expect(within(card).queryByText("Team A")).not.toBeInTheDocument();
    expect(within(card).queryByText("Team B")).not.toBeInTheDocument();
    expect(within(card).getByText("Scotland")).toBeInTheDocument();
    expect(within(card).getByText("Curaçao")).toBeInTheDocument();
  });
});
