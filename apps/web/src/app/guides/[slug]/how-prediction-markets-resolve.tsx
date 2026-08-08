import Link from "next/link";

/**
 * Guide body: "How prediction markets resolve." Rendered inside the shared
 * article shell (.kw-legal.kw-guide). The UMA description is deliberately
 * high-level — parameters like bond sizes and challenge windows vary by
 * market and change over time, so we describe the mechanism, not constants.
 */
export function HowPredictionMarketsResolve() {
  return (
    <>
      <p>
        Every prediction market ends the same way: someone has to decide what
        actually happened, and winning shares have to be paid. That step —
        resolution — is where prediction markets earn or lose their credibility,
        and it is worth understanding before you trade or lean on a
        market&rsquo;s price.
      </p>

      <h2 id="rules-govern">The written rules govern, not the headline</h2>
      <p>
        A market&rsquo;s question (&ldquo;Will X win?&rdquo;) is shorthand. What
        actually settles it is the <strong>resolution text</strong>: a written
        rule stating precisely what counts, by when, and according to which
        source. On Polymarket, whose markets Knoww tracks, this text plus any
        named <strong>resolution source</strong> — an official announcement, a
        government data release, a sports governing body — is the contract. When
        a result feels ambiguous, the rules text decides, which is why
        experienced traders read it before the order book. Knoww shows each
        market&rsquo;s rules and resolution source on its event page.
      </p>
      <aside className="kw-guide-example">
        <p className="kw-guide-example-label">Why the fine print matters</p>
        <p>
          A market on &ldquo;Will the Fed cut rates in September?&rdquo; might
          specify the federal funds <em>target range</em> announced at the
          scheduled FOMC meeting. An emergency inter-meeting cut, or a change to
          a different rate, could resolve the market No even though headlines
          say &ldquo;the Fed cut rates.&rdquo; The market pays on its rule, not
          on the vibe of the news cycle.
        </p>
      </aside>

      <h2 id="closed-vs-resolved">
        &ldquo;Closed&rdquo; and &ldquo;resolved&rdquo; are different states
      </h2>
      <p>
        When a market&rsquo;s end conditions are met,{" "}
        <strong>trading closes</strong> — prices stop moving and Knoww labels
        the event with its final odds. But closing is not settlement. Between
        close and payout sits a verification step, so a market can be closed for
        hours or days while its outcome is confirmed. Only after that does it
        become <strong>resolved</strong>, when shares actually redeem: $1 for
        the winning side, $0 for the losing side.
      </p>

      <h2 id="uma">How outcomes are verified: the optimistic oracle</h2>
      <p>
        Polymarket markets settle on-chain, so the outcome has to be reported to
        the blockchain by something trustworthy. Most markets use{" "}
        <a href="https://uma.xyz" target="_blank" rel="noopener noreferrer">
          UMA
        </a>
        &rsquo;s <strong>optimistic oracle</strong>, which works like a
        challenge system rather than a referee:
      </p>
      <ul>
        <li>
          <strong>Proposal.</strong> After the outcome is knowable, anyone can
          propose a result, posting a monetary bond behind it.
        </li>
        <li>
          <strong>Challenge window.</strong> The proposal then sits open for a
          dispute period. If nobody objects, it is accepted — the
          &ldquo;optimistic&rdquo; part — and the market resolves.
        </li>
        <li>
          <strong>Dispute.</strong> If someone posts a counter-bond, the
          question escalates to a vote of UMA token holders, who settle it per
          the market&rsquo;s rules. The wrong side loses its bond, which is what
          makes false proposals and frivolous disputes expensive.
        </li>
      </ul>
      <p>
        In practice, clear outcomes resolve quickly and quietly; disputes are
        the exception and add days when they happen. The system&rsquo;s
        integrity rests on incentives — being wrong costs money at every step —
        rather than on trusting a single referee.
      </p>

      <h2 id="edge-cases">Edge cases to expect</h2>
      <ul>
        <li>
          <strong>Early resolution.</strong> Many markets can settle before
          their end date once the outcome is locked in — a candidate clinches, a
          bill passes, a match ends.
        </li>
        <li>
          <strong>Deadline passes, nothing happens.</strong> &ldquo;By
          date&rdquo; markets resolve No when the date arrives without the
          event. A price drifting toward zero as a deadline approaches is this
          mechanic at work, not fresh news.
        </li>
        <li>
          <strong>Ambiguity.</strong> Occasionally reality outruns the rules
          text — a postponed event, a renamed metric, a disputed announcement.
          Resolution then turns on close reading of the rules, and prices can
          swing hard while traders argue about interpretation.
        </li>
      </ul>

      <h2 id="on-knoww">What this looks like on Knoww</h2>
      <p>
        Knoww labels events by trading state: live events show current odds, and
        closed events show the final odds at the time trading ended. Because
        settlement can lag the close, a closed market&rsquo;s last price is the
        market&rsquo;s final estimate, not always the official outcome — the
        definitive result is the resolution itself. Knoww displays this data but
        plays no part in deciding outcomes: resolution happens entirely on
        Polymarket and its oracle.
      </p>
      <p>
        For the fundamentals behind all of this, start with{" "}
        <Link href="/guides/what-is-a-prediction-market">
          what is a prediction market
        </Link>
        , learn the numbers in{" "}
        <Link href="/guides/how-to-read-prediction-market-odds">
          how to read prediction-market odds
        </Link>
        , or watch live markets heading toward resolution on the{" "}
        <Link href="/markets">markets feed</Link> and category pages like{" "}
        <Link href="/events/geopolitics">geopolitics</Link>.
      </p>
    </>
  );
}
