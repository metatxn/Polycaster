export interface GroupableMarket {
  id: string;
  parentEventId?: string | number;
  parentEventTitle?: string;
}

export interface GroupableSportsEvent<
  TMarket extends GroupableMarket = GroupableMarket,
> {
  id: string;
  title: string;
  parentEventId?: string | number | null;
  markets?: TMarket[];
}

function eventIdKey(id: string | number | null | undefined): string | null {
  if (id === undefined || id === null) return null;
  const value = String(id);
  return value ? value : null;
}

function parentTitleFromChild(event: Pick<GroupableSportsEvent, "title">) {
  const idx = event.title.indexOf(" - ");
  if (idx <= 0) return null;
  return event.title.slice(0, idx);
}

function buildParentIdByTitle<T extends GroupableSportsEvent>(
  events: readonly T[]
): Map<string, string> {
  const parentTitles = new Map<string, string>();
  for (const event of events) {
    if (parentTitleFromChild(event)) continue;
    parentTitles.set(event.title, event.id);
  }
  return parentTitles;
}

function getInferredParentId<T extends GroupableSportsEvent>(
  event: T,
  parentIdByTitle: ReadonlyMap<string, string>
): string | null {
  const explicitParentId = eventIdKey(event.parentEventId);
  if (explicitParentId) return explicitParentId;

  const parentTitle = parentTitleFromChild(event);
  return parentTitle ? (parentIdByTitle.get(parentTitle) ?? null) : null;
}

function buildChildEventsByParent<T extends GroupableSportsEvent>(
  events: readonly T[],
  parentIdByTitle: ReadonlyMap<string, string>
): Map<string, T[]> {
  const children = new Map<string, T[]>();
  for (const event of events) {
    const parentId = getInferredParentId(event, parentIdByTitle);
    if (!parentId) continue;
    const bucket = children.get(parentId) ?? [];
    bucket.push(event);
    children.set(parentId, bucket);
  }
  return children;
}

function enrichWithChildMarkets<T extends GroupableSportsEvent>(
  event: T,
  childrenByParent: ReadonlyMap<string, T[]>
): T {
  const children = childrenByParent.get(event.id);
  if (!children?.length) return event;

  const seenMarketIds = new Set(
    (event.markets ?? []).map((market) => market.id)
  );
  const childMarkets = children.flatMap((child) =>
    (child.markets ?? [])
      .filter((market) => {
        if (market.id && seenMarketIds.has(market.id)) return false;
        if (market.id) seenMarketIds.add(market.id);
        return true;
      })
      .map((market) => ({
        ...market,
        parentEventId: child.id,
        parentEventTitle: child.title,
      }))
  );

  if (childMarkets.length === 0) return event;
  return {
    ...event,
    markets: [...(event.markets ?? []), ...childMarkets],
  } as T;
}

export function mergeChildSportsMarkets<T extends GroupableSportsEvent>(
  events: readonly T[]
): T[] {
  const parentIdByTitle = buildParentIdByTitle(events);
  const childrenByParent = buildChildEventsByParent(events, parentIdByTitle);

  return events
    .filter((event) => !getInferredParentId(event, parentIdByTitle))
    .map((event) => enrichWithChildMarkets(event, childrenByParent));
}
