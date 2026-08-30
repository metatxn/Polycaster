import type { Market } from "../types/market";
import {
  buildMarketContextDocument,
  CONTEXT_DOCUMENT_LIMITS,
  type ContextDocument,
} from "./context-documents";

const DIACRITIC_RE = /[\u0300-\u036f]/g;
const NON_WORD_RE = /[^a-z0-9]+/g;
export const MAX_NESTED_CONTEXT_CHILDREN = 20;
export const MAX_MARKET_CONTEXT_TEXT_LENGTH =
  CONTEXT_DOCUMENT_LIMITS.totalCharacters;

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
  let includedChildren = 0;
  for (const nested of market.markets || []) {
    if (!isActiveNestedMarket(nested)) continue;
    const label = getNestedMarketLabel(nested);
    const childParts = [label, nested.question || ""].filter(Boolean);
    if (childParts.length === 0) continue;
    parts.push(...childParts);
    includedChildren++;
    if (includedChildren >= MAX_NESTED_CONTEXT_CHILDREN) break;
  }
  return parts;
}

export function boundMarketContextText(value: string): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= MAX_MARKET_CONTEXT_TEXT_LENGTH) return compacted;

  const truncated = compacted.slice(0, MAX_MARKET_CONTEXT_TEXT_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace >= MAX_MARKET_CONTEXT_TEXT_LENGTH * 0.8
    ? truncated.slice(0, lastSpace)
    : truncated;
}

export function buildMarketContextText(
  market: Pick<
    Market,
    | "title"
    | "description"
    | "markets"
    | "outcomes"
    | "startDate"
    | "endDate"
    | "ticker"
    | "tags"
  >
): string {
  return buildMarketContextDocumentFromMarket(market).text;
}

export function buildMarketContextDocumentFromMarket(
  market: Pick<
    Market,
    | "title"
    | "description"
    | "markets"
    | "outcomes"
    | "startDate"
    | "endDate"
    | "ticker"
    | "tags"
  >
): ContextDocument {
  return buildMarketContextDocument({
    title: market.title || "",
    ticker: market.ticker,
    outcomes: (market.outcomes ?? [])
      .map((outcome) => outcome.name || outcome.title || "")
      .filter(Boolean),
    activeChildren: (market.markets ?? [])
      .filter(isActiveNestedMarket)
      .map((nested) => ({
        label: getNestedMarketLabel(nested),
        question: nested.question,
      })),
    startDate: market.startDate,
    endDate: market.endDate,
    aliases: (market.tags ?? [])
      .map((tag) => tag.label || tag.slug || "")
      .filter(Boolean),
    description: market.description,
  });
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
