import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarMobile } from "./sidebar-mobile";
import { TopNav } from "./top-nav";

const navigationState = vi.hoisted(() => ({
  pathname: "/markets",
  push: vi.fn(),
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

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({
    push: navigationState.push,
  }),
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    address: undefined,
    isConnected: false,
  }),
}));

vi.mock("@/components/knoww-mark", () => ({
  KnowwMark: () => <span aria-hidden="true">K</span>,
}));

vi.mock("@/components/market-search", () => ({
  MarketSearch: () => <div />,
}));

vi.mock("@/components/notifications", () => ({
  NotificationBellMobile: () => null,
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("@/components/deposit-modal", () => ({
  DepositModal: () => null,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  SheetTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/hooks/use-proxy-wallet", () => ({
  useProxyWallet: () => ({
    isDeployed: false,
    proxyAddress: undefined,
    usdcBalance: 0,
  }),
}));

vi.mock("@/hooks/use-relayer-client", () => ({
  useRelayerClient: () => ({
    hasDeployedSafe: false,
    proxyAddress: undefined,
  }),
}));

describe("app navigation", () => {
  beforeEach(() => {
    navigationState.pathname = "/markets";
    navigationState.push.mockReset();
  });

  it("lists the desktop primary destinations in order", () => {
    render(<TopNav />);

    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    const primaryLabels = within(primaryNav)
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(primaryLabels).toEqual([
      "Markets",
      "Live",
      "Whales",
      "Leaderboard",
      "Portfolio",
    ]);
  });

  it("lists the mobile drawer primary destinations in order", () => {
    render(<SidebarMobile />);

    const primaryButtons = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.replace("→", ""))
      .filter((label) =>
        [
          "Markets",
          "Live",
          "Whales",
          "Leaderboard",
          "Portfolio",
          "Search",
        ].includes(label ?? "")
      );
    const whalesButton = screen.getByRole("button", { name: "Whales" });
    fireEvent.click(whalesButton);

    expect(primaryButtons).toEqual([
      "Markets",
      "Live",
      "Whales",
      "Leaderboard",
      "Portfolio",
      "Search",
    ]);
    expect(navigationState.push).toHaveBeenCalledWith("/whales");
  });
});
