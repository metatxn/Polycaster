import assert from "node:assert/strict";
import { test } from "vitest";
import { renderSnapshotSections } from "../../src/sidepanel/markets";

function snapshotMarket(id: string, title: string, priceCents: string) {
  return {
    id,
    title,
    source: "polymarket",
    imageUrl: "",
    category: "",
    volume: "",
    priceCents,
    priceSideLabel: "Yes",
    status: "active" as const,
  };
}

test("sidepanel snapshots keep 90¢ markets and omit closed 99¢ markets", () => {
  const html = renderSnapshotSections({
    active: [
      snapshotMarket("open", "Open at 90", "90"),
      snapshotMarket("closed", "Closed at 99", "99"),
    ],
    seen: [],
    trending: [],
  });

  assert.match(html, /Open at 90/);
  assert.doesNotMatch(html, /Closed at 99/);
  assert.match(html, /knoww-stack-section-count">01</);
});
