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

describe("MarketsView", () => {
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
