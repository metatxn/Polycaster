import { permanentRedirect } from "next/navigation";

/**
 * Permanent redirect from the intermediate `/sports/live` path to the
 * canonical `/events/sports/live`. Sports content lives under the
 * `/events/sports/*` namespace alongside per-sport pages
 * (`/events/sports/cricket`, `/events/sports/tennis`, …) so the live
 * sportsbook now lives there as the default sports landing.
 */
export default function SportsLiveLegacyRedirect(): never {
  permanentRedirect("/events/sports/live");
}
