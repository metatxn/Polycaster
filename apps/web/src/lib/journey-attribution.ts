const STORAGE_KEY = "knoww_handoff_v1";
const TTL_MS = 30 * 60 * 1000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Handoff = { id: string; expiresAt: number };

export function currentJourneyProperties(): Record<string, string> {
  try {
    return createJourneyAttribution(window.sessionStorage).properties();
  } catch {
    return {};
  }
}

export function createJourneyAttribution(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  now = Date.now
) {
  const clear = () => {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* Storage is optional. */
    }
  };
  const read = (): Handoff | null => {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
      if (
        value &&
        UUID.test(value.id) &&
        Number.isFinite(value.expiresAt) &&
        value.expiresAt > 0 &&
        value.expiresAt <= now() + TTL_MS
      )
        return value;
    } catch {
      /* Invalid or unavailable storage carries no attribution. */
    }
    clear();
    return null;
  };
  return {
    clear,
    receive(url: URL): boolean {
      if (url.searchParams.get("utm_source") !== "knoww_extension")
        return false;
      const id = url.searchParams.get("handoff_id");
      if (!id || !UUID.test(id)) {
        clear();
        return false;
      }
      if (read()?.id === id) return false;
      try {
        storage.setItem(
          STORAGE_KEY,
          JSON.stringify({ id, expiresAt: now() + TTL_MS })
        );
        return true;
      } catch {
        return false;
      }
    },
    properties(): Record<string, string> {
      const handoff = read();
      // Keep the expired ID in this tab so reloading the same URL cannot renew it.
      return handoff && handoff.expiresAt > now()
        ? { handoff_id: handoff.id, entry_source: "knoww_extension" }
        : {};
    },
  };
}
