import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildMarketContextDocument,
  buildPostContextDocument,
  CONTEXT_DOCUMENT_LIMITS,
} from "../../src/content/context-documents";

test("market documents keep high-value fields in stable order within hard limits", () => {
  const document = buildMarketContextDocument({
    title: "Will $TSLA close above $500 by 2027-06-30?",
    ticker: "$TSLA",
    outcomes: ["Yes", "No"],
    activeChildren: Array.from({ length: 30 }, (_, index) => ({
      label: `Outcome ${index + 1}`,
      question: `Will outcome ${index + 1} happen?`,
    })),
    endDate: "2027-06-30",
    resolutionText: "Resolves Yes if Tesla closes above $500.",
    aliases: ["Tesla", "TSLA"],
    description: "low priority ".repeat(300),
  });

  assert.equal(
    document.directText,
    "Will $TSLA close above $500 by 2027-06-30?"
  );
  assert.deepEqual(document.exactTokens, ["$TSLA"]);
  assert.ok(
    document.text.indexOf("$TSLA") < document.text.indexOf("Outcome 1")
  );
  assert.match(document.text, /Outcome 20/);
  assert.doesNotMatch(document.text, /Outcome 21/);
  assert.match(document.text, /2027-06-30/);
  assert.match(document.text, /Resolves Yes/);
  assert.ok(document.text.length <= CONTEXT_DOCUMENT_LIMITS.totalCharacters);
  assert.deepEqual(document.includedFields.slice(0, 4), [
    "title",
    "ticker",
    "outcomes",
    "activeChildren",
  ]);
});

test("post documents bound quotes, image alt text, article lead, and total text", () => {
  const document = buildPostContextDocument({
    body: "Core post body about the Federal Reserve decision.",
    authorHandle: "@macrodesk",
    quotedText: "quoted detail ".repeat(100),
    imageAltTexts: Array.from(
      { length: 8 },
      (_, index) => `Chart ${index + 1}: rates projection`
    ),
    articleLead: "Article lead about a June rate cut. ".repeat(50),
  });

  assert.match(document.text, /^Core post body/);
  assert.match(document.text, /@macrodesk/);
  assert.match(document.text, /Chart 3/);
  assert.doesNotMatch(document.text, /Chart 4/);
  assert.ok(document.text.length <= CONTEXT_DOCUMENT_LIMITS.totalCharacters);
  assert.deepEqual(document.includedFields, [
    "body",
    "authorHandle",
    "quotedText",
    "articleLead",
    "imageAltTexts",
  ]);
});
