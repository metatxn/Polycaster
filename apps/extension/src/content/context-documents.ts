export const CONTEXT_DOCUMENT_LIMITS = {
  totalCharacters: 1_600,
  childCount: 20,
  imageAltCount: 3,
  bodyCharacters: 640,
  quotedTextCharacters: 240,
  articleLeadCharacters: 360,
  marketDescriptionCharacters: 360,
  activeChildrenCharacters: 900,
  fieldCharacters: 240,
} as const;

export const CONTEXT_DOCUMENT_SCHEMA_VERSION = "context-documents-v1";

export interface ContextDocument {
  text: string;
  directText: string;
  exactTokens: string[];
  includedFields: string[];
}

export interface PostContextDocumentInput {
  body: string;
  authorHandle?: string;
  quotedText?: string;
  imageAltTexts?: string[];
  articleLead?: string;
}

export interface MarketContextDocumentInput {
  title: string;
  ticker?: string;
  outcomes?: string[];
  activeChildren?: Array<{ label?: string; question?: string }>;
  startDate?: string;
  endDate?: string;
  resolutionText?: string;
  aliases?: string[];
  description?: string;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function bound(value: string, maximumCharacters: number): string {
  const normalized = compact(value);
  if (normalized.length <= maximumCharacters) return normalized;

  const slice = normalized.slice(0, maximumCharacters);
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace >= maximumCharacters * 0.75
    ? slice.slice(0, lastSpace)
    : slice;
}

function buildDocument(
  directText: string,
  exactTokens: string[],
  fields: Array<{ name: string; value: string; maximumCharacters: number }>
): ContextDocument {
  const parts: string[] = [];
  const includedFields: string[] = [];
  let remaining = CONTEXT_DOCUMENT_LIMITS.totalCharacters;

  for (const field of fields) {
    const separatorLength = parts.length === 0 ? 0 : 1;
    if (remaining <= separatorLength) break;
    const value = bound(
      field.value,
      Math.min(field.maximumCharacters, remaining - separatorLength)
    );
    if (!value) continue;
    parts.push(value);
    includedFields.push(field.name);
    remaining -= value.length + separatorLength;
  }

  return {
    text: parts.join("\n"),
    directText,
    exactTokens: [...new Set(exactTokens.filter(Boolean))],
    includedFields,
  };
}

export function buildPostContextDocument(
  input: PostContextDocumentInput
): ContextDocument {
  const imageAltText = (input.imageAltTexts ?? [])
    .slice(0, CONTEXT_DOCUMENT_LIMITS.imageAltCount)
    .map((value) => bound(value, 120))
    .filter(Boolean)
    .join(" ");

  return buildDocument(
    input.body,
    [],
    [
      {
        name: "body",
        value: input.body,
        maximumCharacters: CONTEXT_DOCUMENT_LIMITS.bodyCharacters,
      },
      {
        name: "authorHandle",
        value: input.authorHandle ?? "",
        maximumCharacters: 80,
      },
      {
        name: "quotedText",
        value: input.quotedText ?? "",
        maximumCharacters: CONTEXT_DOCUMENT_LIMITS.quotedTextCharacters,
      },
      {
        name: "articleLead",
        value: input.articleLead ?? "",
        maximumCharacters: CONTEXT_DOCUMENT_LIMITS.articleLeadCharacters,
      },
      {
        name: "imageAltTexts",
        value: imageAltText,
        maximumCharacters: 360,
      },
    ]
  );
}

export function buildMarketContextDocument(
  input: MarketContextDocumentInput
): ContextDocument {
  const children = (input.activeChildren ?? [])
    .slice(0, CONTEXT_DOCUMENT_LIMITS.childCount)
    .map(({ label, question }) => [label, question].filter(Boolean).join(": "))
    .filter(Boolean)
    .join(" | ");
  const dates = [input.startDate, input.endDate].filter(Boolean).join(" to ");

  return buildDocument(input.title, input.ticker ? [input.ticker] : [], [
    {
      name: "title",
      value: input.title,
      maximumCharacters: CONTEXT_DOCUMENT_LIMITS.fieldCharacters,
    },
    { name: "ticker", value: input.ticker ?? "", maximumCharacters: 80 },
    {
      name: "outcomes",
      value: (input.outcomes ?? []).slice(0, 12).join(" | "),
      maximumCharacters: CONTEXT_DOCUMENT_LIMITS.fieldCharacters,
    },
    {
      name: "activeChildren",
      value: children,
      maximumCharacters: CONTEXT_DOCUMENT_LIMITS.activeChildrenCharacters,
    },
    { name: "dates", value: dates, maximumCharacters: 120 },
    {
      name: "resolutionText",
      value: input.resolutionText ?? "",
      maximumCharacters: CONTEXT_DOCUMENT_LIMITS.fieldCharacters,
    },
    {
      name: "aliases",
      value: (input.aliases ?? []).slice(0, 12).join(" | "),
      maximumCharacters: CONTEXT_DOCUMENT_LIMITS.fieldCharacters,
    },
    {
      name: "description",
      value: input.description ?? "",
      maximumCharacters: CONTEXT_DOCUMENT_LIMITS.marketDescriptionCharacters,
    },
  ]);
}
