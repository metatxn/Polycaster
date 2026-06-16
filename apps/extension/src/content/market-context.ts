import type { Market } from "../types/market";

const DIACRITIC_RE = /[\u0300-\u036f]/g;
const NON_WORD_RE = /[^a-z0-9]+/g;
const MAX_NESTED_CONTEXT_PARTS = 160;

export function normalizeMarketContextText(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITIC_RE, "")
    .toLowerCase()
    .replace(NON_WORD_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNormalizedPhrase(context: string, phrase: string): boolean {
  const normalizedPhrase = normalizeMarketContextText(phrase);
  if (!context || !normalizedPhrase) return false;
  return ` ${context} `.includes(` ${normalizedPhrase} `);
}

function isActiveNestedMarket(
  nested: NonNullable<Market["markets"]>[number]
): boolean {
  return (
    nested.active !== false &&
    nested.closed !== true &&
    nested.archived !== true
  );
}

function getNestedMarketLabel(
  nested: NonNullable<Market["markets"]>[number]
): string {
  return nested.groupItemTitle || "";
}

export function getNestedMarketContextParts(
  market: Pick<Market, "markets">
): string[] {
  const parts: string[] = [];
  for (const nested of market.markets || []) {
    if (!isActiveNestedMarket(nested)) continue;
    const label = getNestedMarketLabel(nested);
    if (label) parts.push(label);
    if (nested.question) parts.push(nested.question);
    if (parts.length >= MAX_NESTED_CONTEXT_PARTS) break;
  }
  return parts;
}

export function buildMarketContextText(
  market: Pick<Market, "title" | "description" | "markets">
): string {
  return [
    market.title || "",
    market.description || "",
    ...getNestedMarketContextParts(market),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getPreferredOutcomeNames(
  postText: string,
  market: Pick<Market, "markets">
): string[] {
  const context = normalizeMarketContextText(postText);
  const preferred: string[] = [];
  const seen = new Set<string>();

  for (const nested of market.markets || []) {
    if (!isActiveNestedMarket(nested)) continue;
    const label = getNestedMarketLabel(nested);
    const normalizedLabel = normalizeMarketContextText(label);
    if (
      !label ||
      !normalizedLabel ||
      seen.has(normalizedLabel) ||
      !hasNormalizedPhrase(context, label)
    ) {
      continue;
    }

    seen.add(normalizedLabel);
    preferred.push(label);
  }

  return preferred;
}

export function prioritizeByPreferredOutcomeNames<T extends { name: string }>(
  items: T[],
  preferredNames: string[] | undefined
): T[] {
  if (!preferredNames || preferredNames.length === 0) return items;

  const preferredOrder = new Map<string, number>();
  preferredNames.forEach((name, index) => {
    const key = normalizeMarketContextText(name);
    if (key && !preferredOrder.has(key)) preferredOrder.set(key, index);
  });

  if (preferredOrder.size === 0) return items;

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aOrder =
        preferredOrder.get(normalizeMarketContextText(a.item.name)) ??
        Number.POSITIVE_INFINITY;
      const bOrder =
        preferredOrder.get(normalizeMarketContextText(b.item.name)) ??
        Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
