export interface ViewportPostEntry {
  post: {
    getBoundingClientRect(): { bottom: number; top: number };
  };
}

interface RankedEntry<T> {
  entry: T;
  index: number;
  distance: number;
  visible: boolean;
}

function prioritizeByViewport<T extends ViewportPostEntry>(
  entries: T[],
  viewportHeight: number
): T[] {
  if (entries.length === 0) return [];

  const height = Math.max(1, viewportHeight);
  const viewportCenter = height / 2;
  const ranked: RankedEntry<T>[] = entries.map((candidate, index) => {
    const rect = candidate.post.getBoundingClientRect();
    const visible = rect.bottom >= 0 && rect.top <= height;
    const center = (rect.top + rect.bottom) / 2;
    const distance = visible
      ? Math.abs(center - viewportCenter)
      : rect.bottom < 0
        ? -rect.bottom
        : rect.top - height;

    return { entry: candidate, index, distance, visible };
  });

  ranked.sort((left, right) => {
    if (left.visible !== right.visible) return left.visible ? -1 : 1;
    return left.distance - right.distance || left.index - right.index;
  });

  return ranked.map(({ entry }) => entry);
}

export function partitionViewportBatch<T extends ViewportPostEntry>(
  entries: T[],
  limit: number,
  viewportHeight: number
): { deferred: T[]; selected: T[] } {
  const boundedLimit = Math.max(0, Math.floor(limit));
  const prioritized = prioritizeByViewport(entries, viewportHeight);

  return {
    selected: prioritized.slice(0, boundedLimit),
    deferred: prioritized.slice(boundedLimit),
  };
}

export function selectViewportBatch<T extends ViewportPostEntry>(
  entries: T[],
  limit: number,
  viewportHeight: number
): T[] {
  return partitionViewportBatch(entries, limit, viewportHeight).selected;
}

export async function processBatchProgressively<T, R>(
  items: T[],
  concurrency: number,
  analyze: (item: T, index: number) => Promise<R | null | undefined>,
  onResult: (result: R, index: number) => void | Promise<void>
): Promise<R[]> {
  const results = new Array<R | undefined>(items.length);
  const workerCount = Math.min(
    Math.max(0, Math.floor(concurrency)),
    items.length
  );
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;

      const result = await analyze(items[currentIndex], currentIndex);
      if (result === null || result === undefined) continue;

      results[currentIndex] = result;
      await onResult(result, currentIndex);
    }
  });

  await Promise.all(workers);
  return results.filter((result): result is R => result !== undefined);
}
