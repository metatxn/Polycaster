export interface SportsEventTeamCandidate {
  name?: string;
  abbreviation?: string;
  alias?: string;
  league?: string;
}

export interface SportsEventMatchCandidate {
  id?: string | number;
  slug?: string;
  title?: string;
  startDate?: string;
  startTime?: string;
  markets?: Array<{ gameStartTime?: string }>;
  teams?: SportsEventTeamCandidate[];
}

export interface SportsGameMatchCandidate {
  gameId?: string | number;
  leagueAbbreviation?: string;
  slug?: string;
  homeTeam?: string;
  awayTeam?: string;
  updatedAt?: string;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsToken(text: string, token: string): boolean {
  const normalized = normalizeText(token);
  if (!normalized) return false;

  return normalized.length <= 3
    ? new RegExp(`\\b${escapeRegExp(normalized)}\\b`).test(text)
    : text.includes(normalized);
}

function teamAliases(team: SportsEventTeamCandidate | undefined): string[] {
  if (!team) return [];
  return [team.name, team.abbreviation, team.alias]
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function teamsFoundIn(
  text: string,
  home: string | undefined,
  away: string | undefined
): boolean {
  if (!home || !away) return false;
  return containsToken(text, home) && containsToken(text, away);
}

function gameTeamsMatchEventTeams(
  eventTeams: SportsEventTeamCandidate[] | undefined,
  game: SportsGameMatchCandidate
): boolean {
  if (
    !eventTeams ||
    eventTeams.length < 2 ||
    !game.homeTeam ||
    !game.awayTeam
  ) {
    return false;
  }

  const gameHome = normalizeText(game.homeTeam);
  const gameAway = normalizeText(game.awayTeam);
  const eventTeamAliases = eventTeams.map(teamAliases);

  const matchesGameSide = (aliases: string[], side: string) =>
    aliases.some(
      (alias) =>
        alias === side ||
        containsToken(side, alias) ||
        containsToken(alias, side)
    );

  return (
    eventTeamAliases.some((aliases) => matchesGameSide(aliases, gameHome)) &&
    eventTeamAliases.some((aliases) => matchesGameSide(aliases, gameAway))
  );
}

function extractDateFromGameSlug(slug: string | undefined): string | null {
  const match = slug?.match(/(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

function extractDateOnly(input?: string): string | null {
  if (!input) return null;
  return input.split(/[T ]/)[0] || null;
}

function areDatesClose(date1: string, date2: string): boolean {
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  if (Number.isNaN(d1) || Number.isNaN(d2)) return false;
  return Math.abs(d1 - d2) <= 86_400_000;
}

function getEventKickoffDate(event: SportsEventMatchCandidate): string | null {
  const eventDate = extractDateOnly(event.startTime);
  if (eventDate) return eventDate;

  for (const market of event.markets ?? []) {
    const marketDate = extractDateOnly(market.gameStartTime);
    if (marketDate) return marketDate;
  }

  return extractDateOnly(event.startDate);
}

export function matchSportsEventToGame<TGame extends SportsGameMatchCandidate>(
  event: SportsEventMatchCandidate,
  games: Map<string, TGame>
): TGame | null {
  if (games.size === 0) return null;

  const titleLower = normalizeText(event.title);
  const slugLower = normalizeText(event.slug);
  const eventDate = getEventKickoffDate(event);
  const eventLeagueHints = [
    titleLower,
    slugLower,
    ...(event.teams ?? []).map((team) => normalizeText(team.league)),
  ];

  let bestMatch: TGame | null = null;
  let bestScore = -1;

  for (const game of games.values()) {
    if (!game.homeTeam || !game.awayTeam) continue;

    const inTitle = teamsFoundIn(titleLower, game.homeTeam, game.awayTeam);
    const inSlug = teamsFoundIn(slugLower, game.homeTeam, game.awayTeam);
    const teamsMatch = gameTeamsMatchEventTeams(event.teams, game);
    if (!inTitle && !inSlug && !teamsMatch) continue;

    const gameDate =
      extractDateFromGameSlug(game.slug) ??
      game.updatedAt?.split("T")[0] ??
      null;
    const dateMatch = Boolean(
      gameDate && eventDate && areDatesClose(gameDate, eventDate)
    );
    if (gameDate && eventDate && !dateMatch) continue;

    const league = normalizeText(game.leagueAbbreviation);
    const leagueMatch =
      league && eventLeagueHints.some((hint) => hint.includes(league));

    let score = 0;
    if (dateMatch) score += 10;
    if (leagueMatch) score += 5;
    if (inTitle && inSlug) score += 3;
    else if (inTitle || inSlug) score += 2;
    if (teamsMatch) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = game;
    }
  }

  return bestMatch;
}
