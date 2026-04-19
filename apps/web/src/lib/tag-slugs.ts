interface TagShape {
  id?: string | number;
  tag?: string;
  slug?: string;
  label?: string;
  description?: string;
  icon?: string;
  eventCount?: number;
  marketCount?: number;
  forceShow?: boolean;
  forceHide?: boolean;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface NormalizedTag {
  id?: string;
  tag: string;
  slug: string;
  label: string;
  description?: string;
  icon?: string;
  eventCount?: number;
  marketCount?: number;
  forceShow?: boolean;
  forceHide?: boolean;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface KnownTagDefinition {
  slug: string;
  label: string;
  description: string;
}

const TAG_ALIAS_MAP: Record<string, string> = {
  culture: "pop-culture",
  entertainment: "pop-culture",
  mentions: "mention-markets",
  technology: "tech",
};

const KNOWN_TAG_DEFINITIONS: readonly KnownTagDefinition[] = [
  {
    slug: "politics",
    label: "Politics",
    description: "Political events, elections, and government decisions",
  },
  {
    slug: "sports",
    label: "Sports",
    description: "Sports prediction markets including NFL, NBA, MLB, and more",
  },
  {
    slug: "crypto",
    label: "Crypto",
    description: "Cryptocurrency prices, blockchain events, and DeFi",
  },
  {
    slug: "finance",
    label: "Finance",
    description: "Financial markets, macro trends, and business outcomes",
  },
  {
    slug: "geopolitics",
    label: "Geopolitics",
    description: "International conflicts, diplomacy, and geopolitical events",
  },
  {
    slug: "earnings",
    label: "Earnings",
    description: "Company earnings, guidance, and revenue outcomes",
  },
  {
    slug: "tech",
    label: "Tech",
    description: "Technology launches, AI, startups, and platform shifts",
  },
  {
    slug: "pop-culture",
    label: "Culture",
    description: "Entertainment, celebrities, awards, and culture trends",
  },
  {
    slug: "world",
    label: "World",
    description: "Global events, international relations, and world affairs",
  },
  {
    slug: "economy",
    label: "Economy",
    description: "Economic indicators, central banks, and recession odds",
  },
  {
    slug: "elections",
    label: "Elections",
    description: "Election outcomes, primaries, and campaign developments",
  },
  {
    slug: "mention-markets",
    label: "Mentions",
    description: "Markets driven by people, topics, and social mentions",
  },
] as const;

const KNOWN_TAGS_BY_SLUG = new Map(
  KNOWN_TAG_DEFINITIONS.map((tag) => [tag.slug, tag])
);

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeRawTagSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export function normalizeTagSlug(slug: string): string {
  const normalized = normalizeRawTagSlug(slug);
  return TAG_ALIAS_MAP[normalized] ?? normalized;
}

function isLegacyTagAlias(slug: string): boolean {
  return Object.hasOwn(TAG_ALIAS_MAP, normalizeRawTagSlug(slug));
}

export function formatTagLabel(slugOrLabel: string): string {
  return normalizeTagSlug(slugOrLabel)
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function getKnownTagDefinition(slug: string): KnownTagDefinition | null {
  return KNOWN_TAGS_BY_SLUG.get(normalizeTagSlug(slug)) ?? null;
}

export function buildFallbackTags(): NormalizedTag[] {
  return KNOWN_TAG_DEFINITIONS.map(({ slug, label, description }) => ({
    tag: slug,
    slug,
    label,
    description,
  }));
}

export function normalizeTagRecord(tag: TagShape): NormalizedTag | null {
  const rawSlug = readText(tag.slug) ?? readText(tag.tag);
  if (!rawSlug) {
    return null;
  }

  const canonicalSlug = normalizeTagSlug(rawSlug);
  const fallback = getKnownTagDefinition(canonicalSlug);
  const isLegacyAlias = isLegacyTagAlias(rawSlug);

  const label = isLegacyAlias
    ? (fallback?.label ?? readText(tag.label))
    : (readText(tag.label) ?? fallback?.label);

  if (!label) {
    return null;
  }

  return {
    id: tag.id !== undefined && tag.id !== null ? String(tag.id) : undefined,
    tag: canonicalSlug,
    slug: canonicalSlug,
    label,
    description: readText(tag.description) ?? fallback?.description,
    icon: readText(tag.icon),
    eventCount: tag.eventCount,
    marketCount: tag.marketCount,
    forceShow: tag.forceShow,
    forceHide: tag.forceHide,
    publishedAt: readText(tag.publishedAt),
    createdAt: readText(tag.createdAt),
    updatedAt: readText(tag.updatedAt),
  };
}
