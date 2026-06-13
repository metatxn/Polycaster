import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { CompactEventRow } from "./event-rows";
import type { EventMarket, LiveEvent } from "./types";

// ExpandedMarketPanel pulls in the charting stack; the compact row only
// renders it when a market is expanded, which these tests never do.
vi.mock("./market-panel", () => ({
  ExpandedMarketPanel: () => null,
}));

const moneylineMarket: EventMarket = {
  id: "m1",
  question: "Lakers vs Celtics",
  outcomes: JSON.stringify(["Lakers", "Celtics"]),
  outcomePrices: JSON.stringify(["0.6", "0.4"]),
  sportsMarketType: "moneyline",
  clobTokenIds: ["tok-home", "tok-away"],
};

const event: LiveEvent = {
  id: "e1",
  title: "Lakers vs Celtics",
  markets: [moneylineMarket],
};

function renderRow(
  overrides: Partial<React.ComponentProps<typeof CompactEventRow>> = {}
) {
  return render(
    <CompactEventRow
      event={event}
      game={null}
      expandedMarketId={null}
      onToggleExpand={() => {}}
      onOpenExpand={() => {}}
      onMarketSelect={() => {}}
      getMarketPositions={() => []}
      getLivePrice={(_market, _outcomeIndex, fallback) => fallback}
      {...overrides}
    />
  );
}

describe("CompactEventRow", () => {
  it("renders moneyline prices from getLivePrice, not the static snapshot", () => {
    renderRow({
      getLivePrice: (_market, outcomeIndex, fallback) =>
        outcomeIndex === 0 ? 0.75 : fallback,
    });
    expect(screen.getByText("75.0¢")).toBeInTheDocument();
    expect(screen.queryByText("60.0¢")).not.toBeInTheDocument();
  });

  it("marks the outcome matching selectedOutcomeTokenId as selected", () => {
    renderRow({ selectedOutcomeTokenId: "tok-home" });
    const homeButton = screen.getByText("60.0¢").closest("button");
    const awayButton = screen.getByText("40.0¢").closest("button");
    expect(homeButton?.classList.contains("border-(--kwm-ink)")).toBe(true);
    expect(awayButton?.classList.contains("border-(--kwm-ink)")).toBe(false);
  });
});
