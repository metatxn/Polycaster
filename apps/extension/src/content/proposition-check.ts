export type PropositionFieldState = "compatible" | "conflict" | "unknown";

interface PropositionFieldEvidence<T> {
  state: PropositionFieldState;
  post: T | null;
  market: T | null;
}

export type PropositionConflictType =
  | "date"
  | "direction"
  | "entity"
  | "numericThreshold"
  | "outcome";

export interface PropositionCompatibilityResult {
  compatible: boolean;
  conflictTypes: PropositionConflictType[];
  fields: {
    date: PropositionFieldEvidence<string[]>;
    direction: PropositionFieldEvidence<string>;
    entity: PropositionFieldEvidence<string[]>;
    numericThreshold: PropositionFieldEvidence<NumericThreshold>;
    outcome: PropositionFieldEvidence<string>;
  };
}

export function shouldBlockCandidateForProposition(
  result: PropositionCompatibilityResult,
  calibrationActive: boolean
): boolean {
  return calibrationActive && !result.compatible;
}

interface NumericThreshold {
  value: number;
  unit: "currency" | "number" | "percent";
}

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

const ENTITY_STOP_WORDS = new Set([
  "a",
  "an",
  "by",
  "does",
  "is",
  "the",
  "what",
  "when",
  "will",
  "yes",
  "no",
  ...Object.keys(MONTHS),
  "ai",
  "api",
  "ceo",
  "gpu",
]);

function compareValues<T>(
  post: T | null,
  market: T | null,
  compatible: (left: T, right: T) => boolean
): PropositionFieldEvidence<T> {
  if (post === null || market === null) {
    return { state: "unknown", post, market };
  }
  return {
    state: compatible(post, market) ? "compatible" : "conflict",
    post,
    market,
  };
}

function extractDates(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    values.add(
      `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
    );
  }

  const monthPattern = Object.keys(MONTHS).join("|");
  const monthDateRe = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{4})\\b`,
    "gi"
  );
  for (const match of text.matchAll(monthDateRe)) {
    values.add(
      `${match[3]}-${MONTHS[match[1].toLowerCase()]}-${match[2].padStart(2, "0")}`
    );
  }

  const withoutFullDates = text
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, " ")
    .replace(monthDateRe, " ");
  const monthYearRe = new RegExp(`\\b(${monthPattern})\\s+(\\d{4})\\b`, "gi");
  for (const match of withoutFullDates.matchAll(monthYearRe)) {
    values.add(`${match[2]}-${MONTHS[match[1].toLowerCase()]}`);
  }
  const withoutMonthYears = withoutFullDates.replace(monthYearRe, " ");
  for (const match of withoutMonthYears.matchAll(/\b(20\d{2}|19\d{2})\b/g)) {
    values.add(match[1]);
  }
  return [...values];
}

function datesOverlap(left: string[], right: string[]): boolean {
  return left.some((leftDate) =>
    right.some(
      (rightDate) =>
        leftDate === rightDate ||
        leftDate.startsWith(`${rightDate}-`) ||
        rightDate.startsWith(`${leftDate}-`)
    )
  );
}

function extractNumericThreshold(text: string): NumericThreshold | null {
  const match = text.match(
    /(?:above|below|over|under|exceed(?:s|ed)?|at\s+least|at\s+most|more\s+than|less\s+than|reach(?:es|ed)?|pass(?:es|ed)?)\s+([+-]?)(\$)?(\d[\d,]*(?:\.\d+)?)([kmb])?(%)?/i
  );
  if (!match) return null;

  let value = Number(match[3].replaceAll(",", ""));
  const suffix = match[4]?.toLowerCase();
  if (suffix === "k") value *= 1_000;
  if (suffix === "m") value *= 1_000_000;
  if (suffix === "b") value *= 1_000_000_000;
  if (match[1] === "-") value *= -1;
  return {
    value,
    unit: match[5] ? "percent" : match[2] ? "currency" : "number",
  };
}

function extractDirection(text: string): string | null {
  if (
    /\b(above|over|more than|at least|exceed|increase|rise|gain|up)\b/i.test(
      text
    )
  ) {
    return "up";
  }
  if (
    /\b(below|under|less than|at most|decrease|fall|drop|down)\b/i.test(text)
  ) {
    return "down";
  }
  if (/\bbefore\b/i.test(text)) return "before";
  if (/\bafter\b/i.test(text)) return "after";
  return null;
}

function extractEntities(text: string): string[] {
  const entities = new Set<string>();
  for (const match of text.matchAll(
    /[$@][A-Za-z0-9_]+|\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)*/g
  )) {
    const value = match[0].trim().toLowerCase();
    if (!ENTITY_STOP_WORDS.has(value)) entities.add(value);
  }
  return [...entities];
}

function entitiesOverlap(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((entity) => rightSet.has(entity));
}

function extractOutcome(text: string): string | null {
  if (
    /\b(no|not|never|won't|will not)\b.{0,24}\b(win|launch|release|approve|pass|happen|occur|close)\b/i.test(
      text
    )
  ) {
    return "negative";
  }
  if (/\b(win|launch|release|approve|pass|happen|occur|close)\b/i.test(text)) {
    return "positive";
  }
  return null;
}

export function checkPropositionCompatibility(
  postText: string,
  marketText: string
): PropositionCompatibilityResult {
  const postDates = extractDates(postText);
  const marketDates = extractDates(marketText);
  const postEntities = extractEntities(postText);
  const marketEntities = extractEntities(marketText);
  const fields = {
    date: compareValues(
      postDates.length > 0 ? postDates : null,
      marketDates.length > 0 ? marketDates : null,
      datesOverlap
    ),
    direction: compareValues(
      extractDirection(postText),
      extractDirection(marketText),
      (left, right) => left === right
    ),
    entity: compareValues(
      postEntities.length > 0 ? postEntities : null,
      marketEntities.length > 0 ? marketEntities : null,
      entitiesOverlap
    ),
    numericThreshold: compareValues(
      extractNumericThreshold(postText),
      extractNumericThreshold(marketText),
      (left, right) =>
        left.unit === right.unit && Math.abs(left.value - right.value) < 1e-9
    ),
    outcome: compareValues(
      extractOutcome(postText),
      extractOutcome(marketText),
      (left, right) => left === right
    ),
  };
  const conflictTypes = (
    Object.entries(fields) as Array<
      [PropositionConflictType, PropositionFieldEvidence<unknown>]
    >
  )
    .filter(([, evidence]) => evidence.state === "conflict")
    .map(([field]) => field);

  return {
    compatible: conflictTypes.length === 0,
    conflictTypes,
    fields,
  };
}
