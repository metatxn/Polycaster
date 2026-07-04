import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PositionsTable } from "./positions-table";
import type { Position } from "./types";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

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

function makePosition(
  overrides: Partial<Position> = {}
): Position & { redeemable?: boolean } {
  return {
    id: "position-1",
    outcome: "Yes",
    size: 2,
    avgPrice: 0.4,
    currentPrice: 0.62,
    currentValue: 1.24,
    initialValue: 0.8,
    unrealizedPnl: 0.44,
    unrealizedPnlPercent: 55,
    asset: "token-1",
    conditionId: "condition-1",
    market: {
      title: "Will the match resolve?",
      slug: "match-resolve",
      eventSlug: "match-resolve-event",
    },
    ...overrides,
  };
}

function renderPositionsTable(
  positions: Array<Position & { redeemable?: boolean }>,
  props: Record<string, unknown> = {}
) {
  return render(
    <PositionsTable
      positions={positions}
      isLoading={false}
      searchQuery=""
      pnlFilter="all"
      sortField="value"
      sortDirection="desc"
      onSort={() => {}}
      {...props}
    />
  );
}

describe("PositionsTable", () => {
  it("renders redeem actions for redeemable resolved positions", async () => {
    const onRedeem = vi.fn();

    renderPositionsTable([makePosition({ redeemable: true })], { onRedeem });

    expect(screen.getAllByRole("button", { name: /^Redeem$/i })).toHaveLength(
      2
    );
    expect(screen.queryByRole("button", { name: /^Sell$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Trade/i })).toBeNull();

    await userEvent.click(
      screen.getAllByRole("button", { name: /^Redeem$/i })[0]
    );

    expect(onRedeem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "position-1",
        conditionId: "condition-1",
        redeemable: true,
      })
    );
  });

  it("keeps sell and trade actions for active positions", () => {
    renderPositionsTable([makePosition({ redeemable: false })]);

    expect(screen.getAllByRole("button", { name: /^Sell$/i })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /^Trade/i })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Redeem$/i })).toBeNull();
  });

  it("does not render redeem actions for zero-value redeemable rows", () => {
    renderPositionsTable([
      makePosition({
        redeemable: true,
        currentPrice: 0,
        currentValue: 0,
      }),
    ]);

    expect(screen.queryByRole("button", { name: /^Redeem$/i })).toBeNull();
  });

  it("disables only the redeeming row while a CTF redeem is in flight", () => {
    renderPositionsTable(
      [
        makePosition({ id: "position-1", redeemable: true }),
        makePosition({
          id: "position-2",
          conditionId: "condition-2",
          redeemable: true,
        }),
      ],
      {
        onRedeem: vi.fn(),
        redeemingPositionIds: new Set(["position-1"]),
      }
    );

    const buttons = screen.getAllByRole("button", { name: /^Redeem$/i });
    expect(buttons).toHaveLength(4);
    expect(
      buttons.filter((button) => button.hasAttribute("disabled"))
    ).toHaveLength(2);
    expect(
      buttons.filter((button) => !button.hasAttribute("disabled"))
    ).toHaveLength(2);
  });

  it("keeps the mobile current value semibold", () => {
    renderPositionsTable([makePosition()]);

    const mobileCurrentValue = screen
      .getAllByText("$1.24")
      .find(
        (node) => node.parentElement?.className === "font-mono tabular-nums"
      );

    expect(mobileCurrentValue).toBeDefined();
    expect(mobileCurrentValue?.className).toContain("font-semibold");
  });

  it("precomputes per-row metrics once for desktop and mobile layouts", () => {
    const source = readSource("src/components/portfolio/positions-table.tsx");

    expect(source.match(/positionMetrics\(position\)/g)).toHaveLength(1);
    expect(source).toMatch(/const positionRows = useMemo/);
    expect(source).toMatch(/filteredPositions\.map\(\(position\) =>/);
    expect(source).toMatch(/sum \+ row\.metrics\.toWin/);
  });
});
