import { permanentRedirect } from "next/navigation";

/**
 * The Sports landing page IS the live sportsbook. Hitting `/events/sports`
 * forwards to `/events/sports/live` — matching Polymarket's pattern where
 * `polymarket.com/sports/live` is the default sports view, not a separate
 * "all events" grid.
 *
 * Per-sport pages (`/events/sports/cricket`, `/events/sports/tennis`, …)
 * still render via the dynamic `[sport]` route below this one.
 */
export default function SportsLandingRedirect(): never {
  permanentRedirect("/events/sports/live");
}
