import Decimal from "decimal.js";
import type { TimeRange } from "@/components/market-price-chart";
import type { Event } from "@/hooks/use-event-detail";
import { isTeamMatchupEvent } from "./team-matchup-hero";

/**
 * Per-outcome palette for the multi-series chart, the field tiles, and the
 * outcomes table — single source of truth so a contender's color is the
 * same everywhere on the page. 5 colors chosen to read on both light and
 * dark themes; cycles for events with more than 5 outcomes.
 */
export const CANDIDATE_PALETTE = [
  "hsl(221, 83%, 53%)", // Blue
  "hsl(25, 95%, 53%)", // Orange
  "hsl(280, 70%, 55%)", // Purple
  "hsl(142, 76%, 36%)", // Green
  "hsl(340, 82%, 52%)", // Rose
];

export const chartTimeRangeToStartTsOffset: Record<TimeRange, number> = {
  "30M": 30 * 60,
  "1H": 60 * 60,
  "2H": 2 * 60 * 60,
  "3H": 3 * 60 * 60,
  "6H": 6 * 60 * 60,
  "1D": 24 * 60 * 60,
  "1W": 7 * 24 * 60 * 60,
  "1M": 30 * 24 * 60 * 60,
  ALL: 365 * 24 * 60 * 60,
};

export const chartTimeRangeToFidelity: Record<
  Exclude<TimeRange, "ALL">,
  number
> = {
  "30M": 1,
  "1H": 1,
  "2H": 1,
  "3H": 1,
  "6H": 1,
  "1D": 5,
  "1W": 30,
  "1M": 120,
};

export function computeAllRangeFidelity(spanSeconds: number): number {
  const spanMinutes = spanSeconds / 60;
  const raw = Math.max(1, Math.round(spanMinutes / 400));
  const buckets = [1, 5, 15, 30, 60, 120, 240, 360, 720, 1440];
  for (const bucket of buckets) {
    if (raw <= bucket) return bucket;
  }
  return 1440;
}

export function getChartRangePriceHistoryRequest(
  timeRange: TimeRange,
  startDate: string | undefined
): { startTs: number; fidelity: number } {
  const nowSec = Math.floor(Date.now() / 1000);

  if (timeRange === "ALL") {
    const parsedStart = startDate
      ? Math.floor(new Date(startDate).getTime() / 1000)
      : Number.NaN;
    const fallback = nowSec - chartTimeRangeToStartTsOffset.ALL;
    const startTs = Number.isFinite(parsedStart)
      ? Math.min(parsedStart, nowSec)
      : fallback;

    return {
      startTs,
      fidelity: computeAllRangeFidelity(Math.max(60, nowSec - startTs)),
    };
  }

  return {
    startTs: nowSec - chartTimeRangeToStartTsOffset[timeRange],
    fidelity: chartTimeRangeToFidelity[timeRange],
  };
}

export function isLiveSportsEventForChart(
  event: Event | null | undefined
): boolean {
  if (
    !event ||
    !isTeamMatchupEvent(event.teams) ||
    event.closed === true ||
    event.archived === true
  ) {
    return false;
  }

  if (event.live === true || event.score || event.period || event.elapsed) {
    return true;
  }

  const kickoffMs = event.startTime ? new Date(event.startTime).getTime() : NaN;
  if (!Number.isFinite(kickoffMs)) return false;

  const elapsedMs = Date.now() - kickoffMs;
  return elapsedMs >= 0 && elapsedMs < 8 * 60 * 60 * 1000;
}

export function toDisplayPercentagePointChange(changeFraction: number): number {
  if (!Number.isFinite(changeFraction)) return 0;

  const percentagePoints = new Decimal(changeFraction).mul(100);
  const rounded = percentagePoints
    .toDecimalPlaces(
      percentagePoints.abs().lt(1) ? 1 : 0,
      Decimal.ROUND_HALF_UP
    )
    .toNumber();

  return Object.is(rounded, -0) ? 0 : rounded;
}
