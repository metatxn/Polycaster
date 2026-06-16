"use client";

import { useEffect, useState } from "react";
import type { LiveEvent } from "./types";

// ── League helpers ─────────────────────────────────────────────────

const LEAGUE_DISPLAY: Record<string, string> = {
  nba: "NBA",
  nfl: "NFL",
  mlb: "MLB",
  nhl: "NHL",
  ncaab: "NCAAB",
  ncaaf: "NCAAF",
  "la-liga": "La Liga",
  "la-liga-2": "La Liga 2",
  bundesliga: "Bundesliga",
  "efl-championship": "EFL Championship",
  "scottish-premiership": "Scottish Premiership",
  "serie-a": "Serie A",
  "serie-b": "Serie B",
  "ligue-1": "Ligue 1",
  "ligue-2": "Ligue 2",
  epl: "Premier League",
  "premier-league": "Premier League",
  ere: "Eredivisie",
  eredivisie: "Eredivisie",
  rus: "Russian Premier League",
  mls: "MLS",
  "liga-mx": "Liga MX",
  ucl: "Champions League",
  "champions-league": "Champions League",
  "europa-league": "Europa League",
  "copa-libertadores": "Copa Libertadores",
  soccer: "Soccer",
  esports: "Esports",
  lol: "League of Legends",
  cs2: "Counter-Strike 2",
  "counter-strike": "Counter-Strike 2",
  dota2: "Dota 2",
  valorant: "Valorant",
  "honor-of-kings": "Honor of Kings",
  "call-of-duty": "Call of Duty",
  tennis: "Tennis",
  cricket: "Cricket",
  ufc: "UFC",
  boxing: "Boxing",
  rugby: "Rugby",
  golf: "Golf",
  f1: "Formula 1",
  lacrosse: "Lacrosse",
  wbc: "WBC",
  baseball: "Baseball",
  "table-tennis": "Table Tennis",
  chess: "Chess",
};

const GENERIC_TAGS = new Set([
  "sports",
  "esports",
  "soccer",
  "games",
  "live",
  "trending",
  "popular",
]);

const COUNTRY_TIME_ZONE_HINTS: Record<string, string> = {
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Phoenix": "US",
  "America/Anchorage": "US",
  "Pacific/Honolulu": "US",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Sao_Paulo": "BR",
};

const COUNTRY_LEAGUE_PRIORITIES: Record<string, string[]> = {
  IN: [
    "cricket",
    "indian-premier-league",
    "cricipl",
    "international-cricket",
    "tennis",
    "soccer",
    "football",
    "basketball",
    "esports",
  ],
  US: [
    "nba",
    "nfl",
    "mlb",
    "nhl",
    "ncaab",
    "ncaaf",
    "ufc",
    "soccer",
    "tennis",
    "esports",
  ],
  GB: [
    "epl",
    "premier-league",
    "soccer",
    "cricket",
    "tennis",
    "rugby",
    "boxing",
    "f1",
  ],
  IE: ["soccer", "rugby", "cricket", "boxing", "f1"],
  AU: ["cricket", "rugby", "tennis", "f1", "soccer"],
  CA: ["nhl", "nba", "mlb", "soccer", "tennis"],
  BR: ["soccer", "copa-libertadores", "ufc", "f1", "esports"],
};

function extractCountryFromLocale(locale: string): string | null {
  const match = locale.match(/[-_]([a-z]{2}|\d{3})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function inferCountryCodeFromBrowser(): string | null {
  if (typeof window === "undefined") return null;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timeZone && COUNTRY_TIME_ZONE_HINTS[timeZone]) {
    return COUNTRY_TIME_ZONE_HINTS[timeZone];
  }

  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const language of languages) {
    const country = extractCountryFromLocale(language);
    if (country) return country;
  }

  return null;
}

export function useInferredCountryCode(): string | null {
  const [countryCode, setCountryCode] = useState<string | null>(null);

  useEffect(() => {
    setCountryCode(inferCountryCodeFromBrowser());
  }, []);

  return countryCode;
}

function eventTags(
  event: LiveEvent
): Array<string | { slug?: string; label?: string }> {
  return event.tags ?? [];
}

function eventMatchesPriority(
  event: LiveEvent,
  league: string,
  priority: string
): boolean {
  const normalizedPriority = priority.toLowerCase();
  const priorityWords = normalizedPriority.replace(/-/g, " ");
  const haystack = `${league} ${event.slug ?? ""} ${event.title}`.toLowerCase();

  if (
    league.toLowerCase() === normalizedPriority ||
    haystack.includes(normalizedPriority) ||
    haystack.includes(priorityWords)
  ) {
    return true;
  }

  return eventTags(event).some((tag) => {
    const slug = typeof tag === "string" ? tag : tag.slug;
    return slug?.toLowerCase() === normalizedPriority;
  });
}

function getLeagueRegionRank(
  league: string,
  events: LiveEvent[],
  countryCode: string | null
): number {
  if (!countryCode) return Number.MAX_SAFE_INTEGER;

  const priorities = COUNTRY_LEAGUE_PRIORITIES[countryCode];
  if (!priorities) return Number.MAX_SAFE_INTEGER;

  const priorityIndex = priorities.findIndex((priority) =>
    events.some((event) => eventMatchesPriority(event, league, priority))
  );

  return priorityIndex >= 0 ? priorityIndex : Number.MAX_SAFE_INTEGER;
}

export function sortLeagueEntriesForRegion(
  entries: Array<[string, LiveEvent[]]>,
  countryCode: string | null
): Array<[string, LiveEvent[]]> {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aRank = getLeagueRegionRank(a.entry[0], a.entry[1], countryCode);
      const bRank = getLeagueRegionRank(b.entry[0], b.entry[1], countryCode);
      if (aRank !== bRank) return aRank - bRank;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

export function getLeagueFromTags(
  tags: Array<string | { slug?: string; label?: string }> | undefined,
  title: string
): string {
  if (!tags?.length) return guessLeagueFromTitle(title);
  const slugs = tags.map((t) => (typeof t === "string" ? t : t.slug || ""));
  const specific = slugs.find(
    (s) => s && !GENERIC_TAGS.has(s) && LEAGUE_DISPLAY[s]
  );
  if (specific) return specific;
  const nonGeneric = slugs.find((s) => s && !GENERIC_TAGS.has(s));
  if (nonGeneric) return nonGeneric;
  return guessLeagueFromTitle(title);
}

function guessLeagueFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.startsWith("lol:") || t.includes("league of legends")) return "lol";
  if (t.startsWith("counter-strike:") || t.startsWith("cs2:")) return "cs2";
  if (t.startsWith("dota 2:") || t.startsWith("dota2:")) return "dota2";
  if (t.startsWith("valorant:")) return "valorant";
  if (t.startsWith("honor of kings:")) return "honor-of-kings";
  if (t.includes("fc") || t.includes("united") || t.includes("city"))
    return "soccer";
  return "other";
}

export function leagueDisplayName(slug: string): string {
  return LEAGUE_DISPLAY[slug] || slug.toUpperCase();
}
