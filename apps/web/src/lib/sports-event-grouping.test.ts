import { describe, expect, it } from "vitest";
import { mergeChildSportsMarkets } from "./sports-event-grouping";

describe("mergeChildSportsMarkets", () => {
  it("folds child sports events into the parent event markets", () => {
    const events = [
      {
        id: "parent",
        title: "Austria vs. Jordan",
        markets: [{ id: "moneyline", groupItemTitle: "Moneyline" }],
      },
      {
        id: "child-by-title",
        title: "Austria vs. Jordan - Total Goals",
        markets: [{ id: "totals", groupItemTitle: "O/U 2.5" }],
      },
      {
        id: "child-by-parent-id",
        title: "Austria vs. Jordan - Corners",
        parentEventId: "parent",
        markets: [{ id: "corners", groupItemTitle: "Corners" }],
      },
      {
        id: "other",
        title: "Portugal vs. Colombia",
        markets: [{ id: "other-moneyline", groupItemTitle: "Moneyline" }],
      },
    ];

    expect(mergeChildSportsMarkets(events)).toEqual([
      {
        id: "parent",
        title: "Austria vs. Jordan",
        markets: [
          { id: "moneyline", groupItemTitle: "Moneyline" },
          {
            id: "totals",
            groupItemTitle: "O/U 2.5",
            parentEventId: "child-by-title",
            parentEventTitle: "Austria vs. Jordan - Total Goals",
          },
          {
            id: "corners",
            groupItemTitle: "Corners",
            parentEventId: "child-by-parent-id",
            parentEventTitle: "Austria vs. Jordan - Corners",
          },
        ],
      },
      {
        id: "other",
        title: "Portugal vs. Colombia",
        markets: [{ id: "other-moneyline", groupItemTitle: "Moneyline" }],
      },
    ]);
  });

  it("drops linked child events when the parent is absent", () => {
    const events = [
      {
        id: "child-with-missing-parent",
        title: "Austria vs. Jordan - Corners",
        parentEventId: "missing-parent",
        markets: [{ id: "corners", groupItemTitle: "Corners" }],
      },
    ];

    expect(mergeChildSportsMarkets(events)).toEqual([]);
  });
});
