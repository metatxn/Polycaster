import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GammaEventFull } from "@/lib/server-cache";
import { EventSeoContent } from "./event-seo-content";

function renderContent(event: Record<string, unknown>) {
  return render(
    <EventSeoContent
      event={event as unknown as GammaEventFull}
      category={null}
      relatedEvents={[]}
    />
  );
}

describe("EventSeoContent", () => {
  it("inverts the 24-hour movement when No is the leading binary outcome", () => {
    renderContent({
      title: "Will it happen?",
      active: true,
      closed: false,
      markets: [
        {
          id: "market-1",
          active: true,
          closed: false,
          question: "Will it happen?",
          outcomes: JSON.stringify(["Yes", "No"]),
          outcomePrices: JSON.stringify(["0.40", "0.60"]),
          oneDayPriceChange: 0.1,
        },
      ],
    });

    expect(screen.getByText("No (60%)")).toBeInTheDocument();
    expect(
      screen.getByText(/moved down 10 percentage points/i)
    ).toBeInTheDocument();
  });

  it("labels closed-unresolved markets without claiming a final result", () => {
    renderContent({
      title: "Will it happen?",
      active: false,
      closed: true,
      markets: [
        {
          id: "market-1",
          active: false,
          closed: true,
          outcomes: JSON.stringify(["Yes", "No"]),
          outcomePrices: JSON.stringify(["0.55", "0.45"]),
          umaResolutionStatus: "proposed",
        },
      ],
    });

    expect(screen.getByText("Trading closed")).toBeInTheDocument();
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
    expect(screen.queryByText("Final outcome")).not.toBeInTheDocument();
  });

  it("labels fully settled markets as resolved with a final outcome", () => {
    renderContent({
      title: "Will it happen?",
      active: false,
      closed: true,
      markets: [
        {
          id: "market-1",
          active: false,
          closed: true,
          outcomes: JSON.stringify(["Yes", "No"]),
          outcomePrices: JSON.stringify(["1", "0"]),
          umaResolutionStatus: "resolved",
        },
      ],
    });

    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Final outcome")).toBeInTheDocument();
  });
});
