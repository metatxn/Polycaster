import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fieldTiles = readFileSync(
  "src/app/events/detail/[slug]/field-tiles.tsx",
  "utf8"
);
const outcomesTable = readFileSync(
  "src/app/events/detail/[slug]/outcomes-table.tsx",
  "utf8"
);
const commentsSection = readFileSync(
  "src/components/comments/comments-section.tsx",
  "utf8"
);
const marketStyles = readFileSync("src/app/styles/markets.css", "utf8");
const ticketStyles = readFileSync("src/app/styles/ticket.css", "utf8");

test("event detail page-level sections follow the h1 to h2 heading hierarchy", () => {
  assert.match(fieldTiles, /<h2[\s\S]*?>\s*The Field\s*<\/h2>/);
  assert.match(outcomesTable, /<h2[^>]*>\s*All Outcomes\s*<\/h2>/);
  assert.match(commentsSection, /<h2[^>]*>\s*Comments\s*<\/h2>/);
});

test("event detail controls expose names without replacing their visible labels", () => {
  assert.match(
    commentsSection,
    /<Switch[\s\S]*?aria-label="Holders only"[\s\S]*?id="holders-filter"/
  );
  assert.doesNotMatch(
    outcomesTable,
    /aria-label=\{`\$\{isExpanded \? "Collapse" : "Expand"\}/
  );
});

test("light product signal colors clear contrast on tinted trading surfaces", () => {
  assert.match(marketStyles, /--kwm-up:\s*#14532d;/);
  assert.match(marketStyles, /--kwm-down:\s*#991b1b;/);
  assert.match(marketStyles, /--kwm-warn:\s*#92400e;/);
  assert.match(marketStyles, /--kwm-accent:\s*#1d4ed8;/);
});

test("event-detail neutral microcopy uses the stronger secondary ink tier", () => {
  assert.match(
    fieldTiles,
    /className="font-mono text-\[10px\] tabular-nums shrink-0"[\s\S]*?color: "var\(--kwm-ink-2\)"/
  );
  assert.match(
    fieldTiles,
    /<span style=\{\{ color: "var\(--kwm-ink-2\)" \}\}>\{vol\}<\/span>/
  );
  assert.match(
    outcomesTable,
    /Desktop column headers[\s\S]*?text-\(--kwm-ink-2\)/
  );
  assert.match(
    ticketStyles,
    /\.tk-price \.lbl\s*\{[\s\S]*?text-\(--kwm-ink-2\)/
  );
});
