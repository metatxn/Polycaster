interface FetchGammaKeysetCountPageParams {
  endpoint: string;
  params: URLSearchParams;
  revalidate: number;
}

export interface GammaKeysetCountPage {
  count: number;
  nextCursor?: string;
}

type StringCapture = "key" | "nextCursor" | null;

export async function countGammaKeysetItems(
  body: ReadableStream<Uint8Array>,
  itemKey: string
): Promise<GammaKeysetCountPage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let count = 0;
  let nextCursor: string | undefined;

  let depth = 0;
  let rootExpectKey = false;
  let pendingKey: string | undefined;
  let rootValueKey: string | undefined;

  let inString = false;
  let escaped = false;
  let capture: StringCapture = null;
  let captured = "";

  let inItemArray = false;
  let itemValueDepth = 0;

  const finishString = () => {
    if (capture === "key") {
      pendingKey = captured;
      rootExpectKey = false;
    } else if (capture === "nextCursor") {
      nextCursor = captured;
      pendingKey = undefined;
      rootValueKey = undefined;
    }

    capture = null;
    captured = "";
  };

  const processChar = (char: string) => {
    if (inString) {
      if (escaped) {
        if (capture) captured += char;
        escaped = false;
        return;
      }

      if (char === "\\") {
        escaped = true;
        return;
      }

      if (char === '"') {
        inString = false;
        finishString();
        return;
      }

      if (capture) captured += char;
      return;
    }

    if (char === '"') {
      inString = true;
      escaped = false;
      captured = "";
      if (!inItemArray && depth === 1 && rootExpectKey) {
        capture = "key";
      } else if (
        !inItemArray &&
        depth === 1 &&
        rootValueKey === "next_cursor"
      ) {
        capture = "nextCursor";
      } else {
        capture = null;
      }
      return;
    }

    if (inItemArray) {
      if (char === "]" && itemValueDepth === 0) {
        inItemArray = false;
        pendingKey = undefined;
        rootValueKey = undefined;
        return;
      }

      if (char === "{" && itemValueDepth === 0) {
        count += 1;
        itemValueDepth = 1;
        return;
      }

      if (char === "{" || char === "[") {
        itemValueDepth += 1;
      } else if (char === "}" || char === "]") {
        itemValueDepth -= 1;
      }
      return;
    }

    if (char === "{") {
      depth += 1;
      if (depth === 1) rootExpectKey = true;
      return;
    }

    if (char === "}") {
      depth -= 1;
      return;
    }

    if (char === "[") {
      if (depth === 1 && rootValueKey === itemKey) {
        inItemArray = true;
        itemValueDepth = 0;
      } else {
        depth += 1;
      }
      return;
    }

    if (char === "]") {
      depth -= 1;
      return;
    }

    if (depth !== 1) return;

    if (char === ":" && pendingKey !== undefined) {
      rootValueKey = pendingKey;
      return;
    }

    if (char === ",") {
      rootExpectKey = true;
      pendingKey = undefined;
      rootValueKey = undefined;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const char of chunk) processChar(char);
  }

  const tail = decoder.decode();
  for (const char of tail) processChar(char);

  return { count, nextCursor };
}

export async function fetchGammaKeysetCountPage(
  { endpoint, params }: FetchGammaKeysetCountPageParams,
  itemKey = "events"
): Promise<GammaKeysetCountPage> {
  const response = await fetch(`${endpoint}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Gamma API error: ${response.statusText}`);
  }

  if (!response.body) {
    const payload = (await response.json()) as Record<string, unknown>;
    const items = payload[itemKey];
    return {
      count: Array.isArray(items) ? items.length : 0,
      nextCursor:
        typeof payload.next_cursor === "string"
          ? payload.next_cursor
          : undefined,
    };
  }

  return countGammaKeysetItems(response.body, itemKey);
}
