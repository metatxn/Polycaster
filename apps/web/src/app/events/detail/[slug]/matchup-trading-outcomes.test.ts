import { describe, expect, it } from "vitest";
import {
  compactMatchupOutcomeName,
  compactMatchupTradingOutcomes,
} from "./matchup-trading-outcomes";

describe("compactMatchupTradingOutcomes", () => {
  it("keeps separate binary moneyline tickets labeled yes/no", () => {
    const outcomes = compactMatchupTradingOutcomes(
      [
        {
          name: "Yes",
          tokenId: "draw-yes",
          price: 0.24,
          probability: 24,
        },
        {
          name: "No",
          tokenId: "draw-no",
          price: 0.77,
          probability: 77,
        },
      ],
      [
        { name: "Austria", abbreviation: "AUT" },
        { name: "Jordan", abbreviation: "JOR" },
      ]
    );

    expect(outcomes).toEqual([
      {
        name: "Yes",
        tokenId: "draw-yes",
        price: 0.24,
        probability: 24,
      },
      {
        name: "No",
        tokenId: "draw-no",
        price: 0.77,
        probability: 77,
      },
    ]);
  });

  it("compacts named team outcomes using abbreviations", () => {
    const outcomes = compactMatchupTradingOutcomes(
      [
        {
          name: "India",
          tokenId: "india-token",
          price: 0.6,
          probability: 60,
        },
        {
          name: "Afghanistan",
          tokenId: "afghanistan-token",
          price: 0.42,
          probability: 42,
        },
      ],
      [
        { name: "India", abbreviation: "IND4" },
        { name: "Afghanistan", abbreviation: "AFG2" },
      ]
    );

    expect(outcomes).toEqual([
      {
        name: "IND4",
        tokenId: "india-token",
        price: 0.6,
        probability: 60,
      },
      {
        name: "AFG2",
        tokenId: "afghanistan-token",
        price: 0.42,
        probability: 42,
      },
    ]);
  });
});

describe("compactMatchupOutcomeName", () => {
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
