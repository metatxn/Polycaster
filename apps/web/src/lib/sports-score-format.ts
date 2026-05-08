function parseTennisSetScore(setScore: string): [string, string] | null {
  const match = setScore
    .trim()
    .match(/^(\d+)\s*-\s*(\d+)(?:\((\d+)\s*-\s*(\d+)\))?/);
  if (!match) return null;

  const home = match[3] ? `${match[1]}(${match[3]})` : match[1];
  const away = match[4] ? `${match[2]}(${match[4]})` : match[2];
  return [home, away];
}

function parseTennisScore(raw: string): [string, string] | null {
  if (!raw.includes(",")) return null;

  const sets = raw.split(",").map(parseTennisSetScore);
  if (sets.some((set) => set === null)) return null;

  return [
    sets.map((set) => set?.[0]).join(" "),
    sets.map((set) => set?.[1]).join(" "),
  ];
}

export function isTennisSetScore(raw: string | undefined): boolean {
  if (!raw) return false;
  return parseTennisScore(raw) !== null;
}

/**
 * Parse two-sided sports scores for row display.
 *
 * Tennis uses set-level scores (`6-4, 3-6, 2-2`), so each displayed side
 * needs one value per set. Esports websocket scores can include a pipe-
 * delimited round score where the middle segment is the match score.
 */
export function parseSportsScore(raw: string | undefined): [string, string] {
  if (!raw) return ["", ""];

  const tennisScore = parseTennisScore(raw);
  if (tennisScore) return tennisScore;

  if (raw.includes("|")) {
    const segments = raw.split("|");
    const seriesScore = segments[1];
    if (seriesScore) {
      const parts = seriesScore.split("-").map((s) => s.trim());
      return [parts[0] ?? "", parts[1] ?? ""];
    }
  }

  const parts = raw.split("-").map((s) => s.trim());
  return [parts[0] ?? "", parts[1] ?? ""];
}
