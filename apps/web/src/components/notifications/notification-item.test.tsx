import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type Notification, NotificationType } from "@/types/notifications";
import { NotificationItem } from "./notification-item";

describe("NotificationItem", () => {
  it("shows the market title for order fill notifications", () => {
    const notification: Notification = {
      id: 1,
      owner: "api-key",
      timestamp: 100,
      type: NotificationType.ORDER_FILL,
      payload: {
        order_id: "order-1",
        market: "Will France win the 2026 FIFA World Cup?",
        asset_id: "asset-1",
        side: "BUY",
        matched_size: "7",
        price: "0.18",
        outcome: "YES",
      },
    };

    const { container } = render(
      <NotificationItem notification={notification} showDismiss={false} />
    );

    expect(
      screen.getByText("Will France win the 2026 FIFA World Cup?")
    ).toBeInTheDocument();
    expect(
      screen.getByText("You bought 7 YES shares at $0.18")
    ).toBeInTheDocument();
    expect(
      container.textContent?.indexOf("Will France win the 2026 FIFA World Cup?")
    ).toBeLessThan(
      container.textContent?.indexOf("You bought 7 YES shares at $0.18") ?? -1
    );
  });
});
