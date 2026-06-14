import { describe, expect, it } from "vitest";
import {
  buildMatchupTradingOutcomes,
  compactMatchupOutcomeName,
} from "./matchup-trading-outcomes";

describe("buildMatchupTradingOutcomes", () => {
  it("builds sports moneyline ticket outcomes from each team's YES token", () => {
    const outcomes = buildMatchupTradingOutcomes(
      [
        {
          id: "india-market",
          groupItemTitle: "India",
          yesTokenId: "india-yes",
          yesPrice: "0.64",
          displayYesPrice: "0.6",
        },
        {
          id: "afghanistan-market",
          groupItemTitle: "Afghanistan",
          yesTokenId: "afghanistan-yes",
          yesPrice: "0.37",
          displayYesPrice: "0.42",
        },
      ],
      [
        { name: "India", abbreviation: "IND4" },
        { name: "Afghanistan", abbreviation: "AFG2" },
      ]
    );

    expect(outcomes).toEqual([
      {
        marketId: "india-market",
        name: "IND4",
        tokenId: "india-yes",
        price: 0.6,
        probability: 60,
      },
      {
        marketId: "afghanistan-market",
        name: "AFG2",
        tokenId: "afghanistan-yes",
        price: 0.42,
        probability: 42,
      },
    ]);
  });

  it("compacts named matchup outcomes using team abbreviations", () => {
    expect(
      compactMatchupOutcomeName("India", [
        { name: "India", abbreviation: "IND4" },
        { name: "Afghanistan", abbreviation: "AFG2" },
      ])
    ).toBe("IND4");

    expect(
      compactMatchupOutcomeName("Afghanistan", [
        { name: "India", abbreviation: "IND4" },
        { name: "Afghanistan", abbreviation: "AFG2" },
      ])
    ).toBe("AFG2");
  });
});
