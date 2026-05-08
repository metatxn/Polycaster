export interface SportRailEventCandidate {
  tags?: Array<string | { slug?: string; label?: string }>;
}

export interface SportRailGroupCandidate {
  slug: string;
  tagSlug: string;
  leagues: Array<{ tagSlug: string }>;
}

function getTagSlug(tag: string | { slug?: string; label?: string }): string {
  return (typeof tag === "string" ? tag : tag.slug || "").toLowerCase();
}

function buildGroupByTagSlug(groups: readonly SportRailGroupCandidate[]) {
  const map = new Map<string, string>();
  for (const group of groups) {
    map.set(group.tagSlug.toLowerCase(), group.slug);
    for (const league of group.leagues) {
      map.set(league.tagSlug.toLowerCase(), group.slug);
    }
  }
  return map;
}

export function getSportRailOpenGroupSlugsFromEvents(
  events: SportRailEventCandidate[],
  groups: readonly SportRailGroupCandidate[]
): string[] {
  const openGroups = new Set<string>();
  const groupByTagSlug = buildGroupByTagSlug(groups);

  for (const event of events) {
    for (const tag of event.tags ?? []) {
      const groupSlug = groupByTagSlug.get(getTagSlug(tag));
      if (groupSlug) openGroups.add(groupSlug);
    }
  }

  return Array.from(openGroups);
}
