import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SportsContent } from "./sports-content";

vi.mock("@/components/app-layout", () => ({
  ChromeHeader: () => <header>Chrome header</header>,
}));

vi.mock("@/components/comments", () => ({
  CommentsSection: () => <section>Comments</section>,
}));

vi.mock("@/components/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/league-rail", () => ({
  LeagueRail: () => (
    <aside data-testid="desktop-league-rail">League rail</aside>
  ),
  LeagueRailMobile: () => (
    <aside data-testid="mobile-league-rail">Mobile league rail</aside>
  ),
}));

vi.mock("@/components/market-search", () => ({
  MarketSearch: () => <div>Search</div>,
}));

vi.mock("@/components/navbar", () => ({
  Navbar: () => <nav>Navbar</nav>,
}));

vi.mock("@/components/product-footer", () => ({
  ProductFooter: () => <footer>Footer</footer>,
}));

vi.mock("@/components/product-hero", () => ({
  ProductHero: () => <section>Hero</section>,
}));

vi.mock("@/components/sportsbook-view", () => ({
  SportsbookView: () => <div data-testid="sportsbook-view">Sportsbook</div>,
}));

describe("SportsContent", () => {
  it("does not create overflow scroll containers above the sticky trading panel", () => {
    const { container } = render(
      <SportsContent selectedSport="fifa-world-cup" />
    );

    const root = container.firstElementChild;
    const sportsbookWrapper =
      screen.getByTestId("sportsbook-view").parentElement;

    expect(root).toHaveClass("overflow-x-clip");
    expect(root).not.toHaveClass("overflow-x-hidden");
    expect(sportsbookWrapper).toHaveClass("overflow-x-clip");
    expect(sportsbookWrapper).not.toHaveClass("overflow-hidden");
  });

  it("hides the desktop sports sidebar on the FIFA page", () => {
    render(<SportsContent selectedSport="fifa-world-cup" />);

    const sportsbookWrapper =
      screen.getByTestId("sportsbook-view").parentElement;
    const contentGrid = sportsbookWrapper?.parentElement;

    expect(screen.queryByTestId("desktop-league-rail")).not.toBeInTheDocument();
    expect(screen.getByTestId("mobile-league-rail")).toBeInTheDocument();
    expect(contentGrid?.className).not.toContain(
      "xl:grid-cols-[240px_minmax(0,1fr)]"
    );
  });

  it("keeps the desktop sports sidebar on non-FIFA sports pages", () => {
    render(<SportsContent selectedSport="mls" />);

    expect(screen.getByTestId("desktop-league-rail")).toBeInTheDocument();
  });
});
