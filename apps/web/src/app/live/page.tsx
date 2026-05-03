import { permanentRedirect } from "next/navigation";

/**
 * Permanent redirect from the legacy `/live` route to the canonical
 * `/events/sports/live`. Live event coverage on this app is sports-only,
 * and sports content lives under the `/events/sports/*` namespace, so
 * `/live` jumps straight to the canonical URL (no intermediate hop
 * through `/sports/live`).
 */
export default function LiveLegacyRedirect(): never {
  permanentRedirect("/events/sports/live");
}
