import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HistoryTable } from "./history-table";
import type { Trade } from "./types";

declare const process: { cwd(): string };

vi.mock("next/image", () => ({
  default: () => null,
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

beforeAll(() => {
  class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function lostTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "lost-condition-1-0",
    timestamp: "2026-06-20T00:00:00Z",
    type: "REDEEM",
    side: null,
    size: 2,
    price: 0.42,
    usdcAmount: 0,
    outcome: "Yes",
    transactionHash: "",
    market: {
      conditionId: "condition-1",
      title: "Will the market resolve no?",
      slug: "market-resolve-no",
      eventSlug: "market-resolve-no-event",
      icon: "",
      negRisk: true,
    },
    isLostPosition: true,
    ...overrides,
  };
}

describe("HistoryTable", () => {
  it("passes the lost-position negRisk flag when closing a lost position", async () => {
    const onCloseLostPosition = vi.fn();

    render(
      <HistoryTable
        trades={[lostTrade()]}
        isLoading={false}
        searchQuery=""
        onCloseLostPosition={onCloseLostPosition}
      />
    );

    await userEvent.click(
      screen.getAllByRole("button", { name: "Close lost position" })[0]
    );

    expect(onCloseLostPosition).toHaveBeenCalledWith("condition-1", true);
  });

  it("does not label ordinary zero-value redeem activity as lost", () => {
    render(
      <HistoryTable
        trades={[
          lostTrade({
            id: "redeem-condition-1-0",
            isLostPosition: undefined,
          }),
        ]}
        isLoading={false}
        searchQuery=""
        onCloseLostPosition={vi.fn()}
      />
    );

    expect(
      screen.queryByRole("button", { name: "Close lost position" })
    ).toBeNull();
    expect(screen.queryAllByText("Lost")).toHaveLength(0);
    expect(screen.getAllByText("Redeemed").length).toBeGreaterThan(0);
  });

  it("keeps Close disabled for a just-closed position during Data-API indexing lag", async () => {
    // The synthetic lost row survives 10–30s after a successful redeem; a
    // re-click would submit a duplicate (0-payout) redeem via the relayer.
    const onCloseLostPosition = vi.fn();

    render(
      <HistoryTable
        trades={[lostTrade()]}
        isLoading={false}
        searchQuery=""
        onCloseLostPosition={onCloseLostPosition}
        closedPositionIds={new Set(["condition-1"])}
      />
    );

    const buttons = screen.getAllByRole("button", {
      name: "Close lost position",
    });
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    await userEvent.click(buttons[0]);
    expect(onCloseLostPosition).not.toHaveBeenCalled();
  });

  it("portfolio page wires just-closed conditions into the table", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/portfolio/page.tsx"),
      { encoding: "utf8" }
    );

    expect(source).toMatch(/setClosedConditionIds/);
    expect(source).toMatch(/closedPositionIds=\{closedConditionIds\}/);
  });
});
