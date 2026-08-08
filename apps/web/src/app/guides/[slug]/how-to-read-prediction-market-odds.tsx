import Link from "next/link";

/**
 * Guide body: "How to read prediction-market odds." Rendered inside the
 * shared article shell (.kw-legal.kw-guide).
 */
export function HowToReadPredictionMarketOdds() {
  return (
    <>
      <p>
        Prediction-market odds look intimidating until you learn the one rule
        that unlocks all of them:{" "}
        <strong>
          the price in cents is the implied probability in percent
        </strong>
        . A Yes share trading at 62¢ implies a 62% chance; a share at 7¢ implies
        7%. Everything else in this guide is refinement on that rule.
      </p>

      <h2 id="price-to-probability">From price to probability — and payout</h2>
      <p>
        Shares settle at $1 if the outcome occurs and $0 if it does not, so the
        price is what the market collectively pays today for a $1 claim on the
        event. Three numbers follow directly from it:
      </p>
      <ul>
        <li>
          <strong>Implied probability:</strong> the price itself. 62¢ → 62%.
        </li>
        <li>
          <strong>Potential return:</strong> (100¢ − price) ÷ price. At 62¢, a
          winning Yes returns 38¢ on 62¢ risked — about 61%.
        </li>
        <li>
          <strong>Your edge:</strong> your probability minus the market&rsquo;s.
          If you believe the true chance is 70% and the price is 62¢, your
          expected value is 0.70 × $1 − $0.62 = 8¢ per share. No edge, no trade.
        </li>
      </ul>
      <aside className="kw-guide-example">
        <p className="kw-guide-example-label">Worked example</p>
        <p>
          A market asks whether a rate cut happens by December. Yes trades at
          38¢, No at 63¢. Reading it: the crowd sees roughly a 38% chance of a
          cut. Buying 50 Yes shares costs $19; if the cut lands they redeem for
          $50 ($31 profit), if not you lose $19. Note the two sides sum to 101¢,
          not 100¢ — that extra cent is the spread, the market&rsquo;s built-in
          transaction cost.
        </p>
      </aside>

      <h2 id="bid-ask">Bid, ask, and the real price of trading</h2>
      <p>
        A live market has two prices: the <strong>bid</strong> (the most a buyer
        currently offers) and the <strong>ask</strong> (the least a seller
        accepts). If Yes is bid 61¢ / ask 63¢, the &ldquo;price&rdquo; you see
        quoted is usually the last trade or the midpoint (62¢), but <em>you</em>{" "}
        buy at 63¢ and sell at 61¢. The gap is the spread:
      </p>
      <ul>
        <li>
          A tight spread (a cent or two) means an actively traded market whose
          price you can take mostly at face value.
        </li>
        <li>
          A wide spread (five cents or more) means the &ldquo;implied
          probability&rdquo; is really a range, and round-tripping a position
          costs real money.
        </li>
      </ul>
      <p>
        Depth matters the same way: a big order in a shallow book moves the
        price against itself. Volume and liquidity figures — both shown on Knoww
        market pages — tell you how much weight a price can bear.
      </p>

      <h2 id="movement">Reading movement</h2>
      <p>
        A price is a snapshot; the change is the story. A market moving from 30¢
        to 42¢ in a day is the crowd repricing new information — worth more
        attention than the level itself. But scale your reading to the
        market&rsquo;s size: in a thin market, a few hundred dollars can produce
        the same 12-point move that would take serious capital in a deep one.
        Movement in a high-volume market is signal; movement in a tiny one may
        just be one trader.
      </p>

      <h2 id="multi-outcome">Multi-outcome markets</h2>
      <p>
        Questions with several answers — who wins a nomination, which team takes
        a title — are structured as a set of binary markets, one per candidate.
        Each has its own Yes price, and the leader&rsquo;s price is the headline
        probability. Two quirks to expect:
      </p>
      <ul>
        <li>
          <strong>The prices rarely sum to exactly 100%.</strong> Each outcome
          trades in its own book with its own spread, so the sum drifts a little
          above or below. Small deviations are structural, not a signal.
        </li>
        <li>
          <strong>Longshots are usually a touch expensive.</strong> The
          favorite–longshot bias means 2–5¢ candidates tend to be overpriced
          relative to their true chances. Treat sub-5% prices as
          &ldquo;unlikely,&rdquo; not as precise estimates.
        </li>
      </ul>

      <h2 id="time">The time factor</h2>
      <p>
        A share is a claim on $1 <em>at resolution</em>, so far-off markets
        price in the wait. A near-certain outcome resolving next week can trade
        at 99¢, while an equally certain one resolving next year sits at 95¢ —
        the 5¢ gap is largely the cost of locking up capital, not extra doubt.
        When comparing odds across markets, check the resolution date before
        reading small price differences as disagreement about probability.
      </p>

      <h2 id="checklist">A 30-second reading checklist</h2>
      <ul>
        <li>Convert the price to a probability (cents → percent).</li>
        <li>
          Check volume and liquidity — how much weight can this price bear?
        </li>
        <li>
          Check the spread — is the probability a point estimate or a range?
        </li>
        <li>Check the 24-hour move — has news just repriced this?</li>
        <li>Check the resolution date — how much of the price is time?</li>
        <li>
          Read the resolution rules — the market settles on its written terms,
          not the headline. See{" "}
          <Link href="/guides/how-prediction-markets-resolve">
            how prediction markets resolve
          </Link>
          .
        </li>
      </ul>
      <p>
        Then practice on live examples: the{" "}
        <Link href="/markets">markets feed</Link> and category pages like{" "}
        <Link href="/events/politics">politics</Link> and{" "}
        <Link href="/events/finance">finance</Link> show all of these numbers on
        real, open markets. New to the subject entirely? Start with{" "}
        <Link href="/guides/what-is-a-prediction-market">
          what is a prediction market
        </Link>
        .
      </p>
    </>
  );
}
