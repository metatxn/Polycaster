import { z } from "zod";
import { UpstreamPriceHistoryError } from "../errors";
import {
  type ServiceFetchOptions,
  withUpstreamTimeout,
} from "../fetch-options";
import { decimalValueSchema } from "../validation";
import { CLOB_API_BASE } from "./orderbook";

/**
 * Standalone CLOB /prices-history fetcher. Deliberately does not reuse
 * @knoww/shared-types/clob (dynamic SDK import; see orderbook.ts).
 *
 * Probed contract (2026-08-25): the query key is `market` but it carries
 * the TOKEN id; `t` is a seconds epoch number, `p` a float, points arrive
 * ascending; an unknown token answers HTTP 200 with an empty history, so
 * there is no not-found case here.
 */

const PRICE_HISTORY_UPSTREAM_TIMEOUT_MS = 8500;

/** One validated sample: `t` seconds epoch, `p` an exact decimal string. */
export interface PriceHistoryPoint {
  t: number;
  p: string;
}

export interface PriceHistoryParams {
  startTs: number;
  endTs: number;
  fidelity: number;
}

const historySchema = z.object({
  history: z.array(
    z.object({
      t: z.number().int().safe().positive(),
      p: decimalValueSchema({ min: "0", max: "1" }).transform((value) =>
        String(value)
      ),
    })
  ),
});

function normalizePoints(
  payload: unknown,
  params: PriceHistoryParams
): PriceHistoryPoint[] {
  const parsed = historySchema.safeParse(payload);
  if (!parsed.success) {
    throw new UpstreamPriceHistoryError(
      "CLOB price history returned a malformed payload"
    );
  }
  if (
    parsed.data.history.some(
      (point) => point.t < params.startTs || point.t > params.endTs
    )
  ) {
    throw new UpstreamPriceHistoryError(
      "CLOB price history returned a point outside the requested window"
    );
  }
  return parsed.data.history.sort((a, b) => a.t - b.t);
}

/**
 * Fetches price history for one CLOB token id. An empty array can mean an
 * unknown token or simply no trades in the window; upstream does not
 * distinguish. Throws UpstreamPriceHistoryError with the status on failure.
 */
export async function fetchPriceHistoryByTokenId(
  tokenId: string,
  params: PriceHistoryParams,
  options?: ServiceFetchOptions
): Promise<PriceHistoryPoint[]> {
  return withUpstreamTimeout(
    options,
    PRICE_HISTORY_UPSTREAM_TIMEOUT_MS,
    async (fetchImpl, signal) => {
      const query = new URLSearchParams({
        market: tokenId,
        startTs: String(params.startTs),
        endTs: String(params.endTs),
        fidelity: String(params.fidelity),
      });
      const response = await fetchImpl(
        `${CLOB_API_BASE}/prices-history?${query.toString()}`,
        {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal,
        }
      );

      if (!response.ok) {
        throw new UpstreamPriceHistoryError(
          `CLOB price history lookup failed with ${response.status}`,
          response.status
        );
      }

      const payload: unknown = await response.json();

      return normalizePoints(payload, params);
    }
  );
}
