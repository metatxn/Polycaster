import Link from "next/link";

/**
 * Guide body: "What is a prediction market?" Rendered inside the shared
 * article shell (.kw-legal.kw-guide), which owns typography and rhythm.
 */
export function WhatIsAPredictionMarket() {
  return (
    <>
      <p>
        A prediction market is a place where people trade on the outcome of a
        future event. Instead of a poll asking what people <em>say</em> they
        expect, a prediction market asks what they are willing to <em>pay</em> —
        and the resulting price doubles as a live, constantly updated
        probability estimate.
      </p>
      <p>
        The building block is a simple contract. On{" "}
        <a
          href="https://polymarket.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Polymarket
        </a>
        , whose markets Knoww tracks, each market is a question with a written
        rule for how it settles — &ldquo;Will X happen by date Y?&rdquo; A{" "}
        <strong>
          Yes share pays $1 if the event happens and $0 if it does not
        </strong>
        ; a No share pays the reverse. Between now and resolution, both trade at
        prices between $0 and $1.
      </p>

      <h2 id="prices-are-probabilities">Why the price is a probability</h2>
      <p>
        Suppose a Yes share trades at 62¢. Anyone who thinks the true chance is
        higher than 62% sees a profitable buy; anyone who thinks it is lower
        sees a profitable sell. Trading pushes the price toward the point where
        neither side has an edge — which is the crowd&rsquo;s aggregate
        probability estimate. That is why a 62¢ price is read as a{" "}
        <strong>62% implied probability</strong>.
      </p>
      <aside className="kw-guide-example">
        <p className="kw-guide-example-label">Worked example</p>
        <p>
          You buy 100 Yes shares at 62¢ each, spending $62. If the event
          happens, the shares redeem for $100 — a $38 profit. If it does not,
          they expire worthless and you lose the $62. Your break-even is exactly
          the price: the position only makes money on average if the true
          probability is above 62%.
        </p>
      </aside>
      <p>
        Nothing forces you to hold to the end. If news moves the price to 80¢
        next week, you can sell and lock in the gain — prediction-market
        positions trade continuously, like any other market.
      </p>

      <h2 id="where-prices-come-from">Where the prices come from</h2>
      <p>
        Every number you see on Knoww comes from live Polymarket order books:
        real bids and offers from traders with money at stake. There is no
        editorial panel setting the odds and no model producing a forecast — the
        probability <em>is</em> the price. That gives prediction markets three
        useful properties:
      </p>
      <ul>
        <li>
          <strong>They update instantly.</strong> Prices react to news in
          minutes, not at the pace of a polling cycle.
        </li>
        <li>
          <strong>They aggregate private information.</strong> Anyone who knows
          something the crowd does not can profit by trading on it, which pulls
          that information into the price.
        </li>
        <li>
          <strong>They are accountable.</strong> A pundit&rsquo;s wrong call
          costs nothing; a trader&rsquo;s wrong call costs money. Prices reflect
          beliefs people are willing to back.
        </li>
      </ul>

      <h2 id="what-happens-at-the-end">What happens when a market ends</h2>
      <p>
        Each market has an end date and a written resolution rule. When the
        outcome is known, the market resolves: winning shares redeem for $1,
        losing shares for $0. Between the close of trading and official
        resolution there is often a verification window — our guide on{" "}
        <Link href="/guides/how-prediction-markets-resolve">
          how prediction markets resolve
        </Link>{" "}
        walks through that process, including how disputes are handled.
      </p>

      <h2 id="limitations">Limitations worth knowing</h2>
      <p>
        Prediction markets are a powerful signal, not an oracle. Keep these
        limits in mind when you read one:
      </p>
      <ul>
        <li>
          <strong>Thin markets are noisy.</strong> A market with little volume
          can be moved several points by one modest trade. Check volume and
          liquidity before treating a price as the crowd&rsquo;s considered
          view.
        </li>
        <li>
          <strong>Extreme prices are less reliable.</strong> Markets tend to
          slightly overprice longshots and underprice near-certainties (the
          favorite–longshot bias), so a 3¢ price does not mean a clean 3%
          chance.
        </li>
        <li>
          <strong>Money has a time cost.</strong> Buying a 95¢ share that
          resolves in a year ties up capital for a ~5% gross return — some of
          that price reflects the wait, not just the probability.
        </li>
        <li>
          <strong>A probability is not a promise.</strong> Events priced at 20%
          happen one time in five. A market being &ldquo;wrong&rdquo; once tells
          you little about whether its prices are well calibrated overall.
        </li>
      </ul>

      <h2 id="where-knoww-fits">Where Knoww fits</h2>
      <p>
        Knoww is a reading layer for these markets. The{" "}
        <Link href="/markets">markets feed</Link> tracks live Polymarket odds
        across <Link href="/events/politics">politics</Link>,{" "}
        <Link href="/events/crypto">crypto</Link>,{" "}
        <Link href="/events/sports/live">sports</Link>, and more, and the{" "}
        <Link href="/extension">browser extension</Link> surfaces relevant
        markets next to the articles and posts you are already reading. Knoww
        does not operate or resolve any market and never takes custody of funds
        — trades happen on Polymarket, from your own wallet. For the full
        picture, see <Link href="/how-knoww-works">how Knoww works</Link>.
      </p>
      <p>
        Ready for the next level of detail? Learn to read an order book in{" "}
        <Link href="/guides/how-to-read-prediction-market-odds">
          how to read prediction-market odds
        </Link>
        .
      </p>
    </>
  );
}
