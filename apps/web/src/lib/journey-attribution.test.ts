import { describe, expect, it } from "vitest";
import { createJourneyAttribution } from "./journey-attribution";

describe("temporary extension handoff attribution", () => {
  it("correlates a handoff across pages without extending its lifetime on reload", () => {
    let now = 1000;
    const values = new Map<string, string>();
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    };
    const journey = createJourneyAttribution(storage, () => now);
    const id = "12345678-1234-4123-8123-123456789abc";
    const url = new URL(
      `https://knoww.app/?utm_source=knoww_extension&handoff_id=${id}`
    );
    expect(journey.receive(url)).toBe(true);
    expect(journey.properties()).toEqual({
      handoff_id: id,
      entry_source: "knoww_extension",
    });
    now += 1000;
    expect(journey.receive(url)).toBe(false);
    expect(journey.receive(new URL("https://knoww.app/markets"))).toBe(false);
    now += 30 * 60 * 1000;
    expect(journey.properties()).toEqual({});
    expect(journey.receive(url)).toBe(false);
    expect(journey.properties()).toEqual({});
    journey.clear();
    expect(values.size).toBe(0);
  });

  it("rejects arbitrary identifiers and tolerates unavailable storage", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw Error("disabled");
      },
      removeItem: () => {},
    };
    const journey = createJourneyAttribution(storage);
    expect(
      journey.receive(
        new URL(
          "https://knoww.app/?utm_source=knoww_extension&handoff_id=wallet-address"
        )
      )
    ).toBe(false);
    expect(
      journey.receive(
        new URL(
          "https://knoww.app/?utm_source=knoww_extension&handoff_id=12345678-1234-4123-8123-123456789abc"
        )
      )
    ).toBe(false);
    expect(journey.properties()).toEqual({});
  });
});
