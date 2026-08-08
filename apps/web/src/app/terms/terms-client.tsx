"use client";

import Link from "next/link";
import { KnowwMark } from "@/components/knoww-mark";
import {
  KW_PAGE_CLASS,
  KwThemeDropdown,
  useKwTheme,
} from "@/components/kw-theme";

const LAST_UPDATED = "August 7, 2026";

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/knoww-%E2%80%94-every-opinion-is/naoaonihikedoiemhbolbnolibpmojgf";

const SECTIONS = [
  { id: "acceptance", title: "Acceptance of these terms", roman: "i" },
  { id: "service", title: "What Knoww is", roman: "ii" },
  {
    id: "eligibility",
    title: "Eligibility & restricted regions",
    roman: "iii",
  },
  { id: "wallets", title: "Wallets & non-custodial trading", roman: "iv" },
  { id: "market-data", title: "Market data & no advice", roman: "v" },
  { id: "risk", title: "Risk disclosure", roman: "vi" },
  { id: "acceptable-use", title: "Acceptable use", roman: "vii" },
  { id: "third-parties", title: "Third-party services", roman: "viii" },
  { id: "ip", title: "Intellectual property", roman: "ix" },
  {
    id: "disclaimers",
    title: "Disclaimers & limitation of liability",
    roman: "x",
  },
  { id: "changes", title: "Changes & termination", roman: "xi" },
  { id: "contact", title: "Contact", roman: "xii" },
] as const;

const PAGE_COUNT = SECTIONS.length;

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Section({
  id,
  title,
  roman,
  index,
  children,
}: {
  id: string;
  title: string;
  roman: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="kw-reveal scroll-mt-24 pt-16 first:pt-0 border-t border-(--kw-fg)/10 first:border-t-0"
    >
      <div className="flex items-baseline justify-between gap-4 pb-5 mb-8 border-b border-(--kw-fg)/10">
        <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60">
          § {roman}. {title}
        </h2>
        <span className="shrink-0 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/45 tabular-nums">
          {String(index).padStart(2, "0")} /{" "}
          {String(PAGE_COUNT).padStart(2, "0")}
        </span>
      </div>
      <div className="kw-legal">{children}</div>
    </section>
  );
}

export default function TermsClient() {
  const { colorScheme, setTheme, theme } = useKwTheme();

  return (
    <div
      className={`${KW_PAGE_CLASS} fixed inset-0 z-60 overflow-y-auto bg-(--kw-bg) text-(--kw-fg) font-sans`}
      data-theme={theme}
      style={{ colorScheme }}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="border-b border-(--kw-fg)/10 bg-(--kw-bg)">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <KnowwMark />
              <span className="font-bold text-[15px] tracking-tight">
                Knoww
              </span>
            </Link>
            <span className="hidden md:inline-block text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/55 border-l border-(--kw-fg)/10 pl-6">
              Document · Terms
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-[13px] text-(--kw-fg)/70 hover:text-(--kw-fg) transition-colors"
            >
              ← Back to home
            </Link>
            <KwThemeDropdown theme={theme} onThemeChange={setTheme} />
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="border-b border-(--kw-fg)/10">
        <div className="max-w-[1200px] mx-auto px-6 pt-20 md:pt-24 pb-16">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-(--kw-fg)/60 mb-10">
            <span className="w-1.5 h-1.5 bg-(--kw-accent) animate-pulse" />
            Issue № 02 — An editorial document
          </div>

          <h1 className="font-bold tracking-[-0.035em] leading-[0.95] text-[52px] sm:text-[72px] md:text-[88px] lg:text-[96px] mb-10 max-w-[960px]">
            On <span className="italic kw-editorial kw-tilt">terms</span>
            ,<br />
            <span className="text-(--kw-fg)/55">and where we stand.</span>
          </h1>

          <p className="text-[17px] text-(--kw-fg)/75 max-w-[620px] leading-[1.55] mb-10">
            These terms govern your use of{" "}
            <strong className="text-(--kw-fg)">Knoww</strong>{" "}
            (&ldquo;Knoww,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) — our web
            app at{" "}
            <a
              href="https://knoww.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-(--kw-accent-text) underline underline-offset-[3px] decoration-(--kw-accent)/40 hover:decoration-(--kw-accent)"
            >
              knoww.app
            </a>{" "}
            and our Chrome extension.
          </p>

          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pt-5 border-t border-(--kw-fg)/10 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
            <span>
              Last updated —{" "}
              <span className="kw-editorial italic normal-case tracking-normal text-[13px] text-(--kw-fg)/85">
                {LAST_UPDATED}
              </span>
            </span>
            <span className="text-(--kw-fg)/30">·</span>
            <span>{PAGE_COUNT} sections</span>
            <span className="text-(--kw-fg)/30">·</span>
            <span>≈ 6 minutes to read</span>
          </div>
        </div>
      </section>

      {/* ── Body with sticky TOC ────────────────────────────────────── */}
      <main>
        <div className="max-w-[1200px] mx-auto px-6 py-16 md:py-20 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-12 lg:gap-20">
          {/* TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-6">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4 pb-3 border-b border-(--kw-fg)/15">
                § Contents
              </div>
              <ol className="space-y-3">
                {SECTIONS.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-2.5">
                    <span className="kw-editorial italic text-[13px] text-(--kw-fg)/45 w-6 shrink-0 leading-none">
                      {s.roman}
                    </span>
                    <Link
                      href={`#${s.id}`}
                      className="text-[12px] text-(--kw-fg)/70 hover:text-(--kw-fg) transition-colors leading-[1.45]"
                    >
                      {s.title}
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          {/* Content */}
          <div>
            <Section
              id="acceptance"
              title="Acceptance of these terms"
              roman="i"
              index={1}
            >
              <p>
                By accessing knoww.app or installing and using the Knoww
                Extension (together, the &ldquo;Service&rdquo;), you agree to be
                bound by these Terms of Use and our{" "}
                <Link href="/privacy">Privacy Policy</Link>. If you do not agree
                to these terms, do not use the Service.
              </p>
              <p>
                You are responsible for ensuring that your use of the Service is
                lawful in your jurisdiction. Nothing in these terms overrides
                any obligation you have under applicable law.
              </p>
            </Section>

            <Section id="service" title="What Knoww is" roman="ii" index={2}>
              <p>
                Knoww is an interface for discovering and interacting with
                prediction markets operated by third parties, principally{" "}
                <ExternalLink href="https://polymarket.com">
                  Polymarket
                </ExternalLink>
                . The web app lets you browse live markets, odds, and related
                information. The Extension surfaces potentially relevant markets
                alongside content you are already reading on supported websites.
              </p>
              <p>
                Knoww does not operate, host, or resolve any prediction market.
                We do not set odds, hold order books, act as a counterparty to
                any trade, or take custody of your funds. Markets you access
                through Knoww are created, run, and resolved by the third-party
                platforms that operate them, under those platforms&rsquo; own
                terms.
              </p>
            </Section>

            <Section
              id="eligibility"
              title="Eligibility & restricted regions"
              roman="iii"
              index={3}
            >
              <p>
                You must be at least 18 years old (or the age of majority in
                your jurisdiction, if higher) to use the Service.
              </p>
              <p>
                Prediction-market trading is restricted or unavailable in some
                jurisdictions, and the third-party platforms accessible through
                Knoww apply their own eligibility rules and geographic
                restrictions. It is your responsibility to determine whether you
                may lawfully access and trade on those platforms from your
                location. Knoww does not verify your eligibility to trade and
                does not grant you any right to circumvent restrictions imposed
                by law or by a third-party platform.
              </p>
            </Section>

            <Section
              id="wallets"
              title="Wallets & non-custodial trading"
              roman="iv"
              index={4}
            >
              <p>
                Trading features in the Service are non-custodial. If you choose
                to trade, orders and transactions are created from your own
                device, authorized with your own wallet, and settled on public
                blockchain infrastructure and third-party market platforms.
                Knoww never holds your private keys and never takes possession
                of your funds.
              </p>
              <ul>
                <li>
                  You are solely responsible for your wallet, your private keys
                  and recovery phrases, and every transaction you sign.
                </li>
                <li>
                  Blockchain transactions are irreversible. We cannot cancel,
                  reverse, or recover a transaction once it has been submitted.
                </li>
                <li>
                  Network fees, platform fees, and any other charges applicable
                  to a transaction are shown in the interface or by the
                  underlying platform at the time of the transaction.
                </li>
              </ul>
            </Section>

            <Section
              id="market-data"
              title="Market data & no advice"
              roman="v"
              index={5}
            >
              <p>
                Odds, prices, volumes, and other market data shown in the
                Service come from third-party sources and may be delayed,
                incomplete, or inaccurate. Data is provided for informational
                purposes only.
              </p>
              <p>
                Nothing in the Service is investment, financial, legal, or tax
                advice, and nothing in the Service is a recommendation to enter
                any market or position. Market probabilities reflect the
                aggregate activity of traders on third-party platforms, not a
                statement or prediction by Knoww.
              </p>
            </Section>

            <Section id="risk" title="Risk disclosure" roman="vi" index={6}>
              <p>
                Trading in prediction markets involves substantial risk,
                including the risk of losing the entire amount you commit to a
                position. Markets can be volatile and illiquid, may resolve in
                ways you do not expect, and depend on resolution processes
                controlled by third parties. Digital-asset infrastructure
                carries additional risks, including smart-contract defects,
                network congestion, and loss of wallet access.
              </p>
              <p>
                Only commit funds you can afford to lose. You accept these risks
                entirely when you choose to trade.
              </p>
            </Section>

            <Section
              id="acceptable-use"
              title="Acceptable use"
              roman="vii"
              index={7}
            >
              <p>When using the Service, you agree not to:</p>
              <ul>
                <li>
                  use the Service in violation of applicable law or of the terms
                  of any third-party platform accessed through it;
                </li>
                <li>
                  attempt to probe, disrupt, overload, or gain unauthorized
                  access to the Service or its infrastructure;
                </li>
                <li>
                  scrape, harvest, or redistribute data from the Service at
                  scale without our prior written permission;
                </li>
                <li>
                  post unlawful, fraudulent, or abusive content through any
                  comment or submission feature; or
                </li>
                <li>
                  misrepresent your affiliation with Knoww or use our marks
                  without permission.
                </li>
              </ul>
            </Section>

            <Section
              id="third-parties"
              title="Third-party services"
              roman="viii"
              index={8}
            >
              <p>
                The Service depends on third-party services that we do not
                control, including market platforms such as Polymarket, wallet
                providers, blockchain networks, data providers, and browser
                distribution channels such as the{" "}
                <ExternalLink href={CHROME_STORE_URL}>
                  Chrome Web Store
                </ExternalLink>
                . Your use of those services is governed by their own terms and
                policies, and we are not responsible for their availability,
                accuracy, or conduct.
              </p>
            </Section>

            <Section id="ip" title="Intellectual property" roman="ix" index={9}>
              <p>
                The Service, including its design, text, graphics, and software,
                is owned by Knoww or its licensors and is protected by
                intellectual-property laws. We grant you a limited,
                non-exclusive, non-transferable, revocable license to use the
                Service for personal, non-commercial purposes. Market data and
                trademarks belonging to third parties remain the property of
                their respective owners.
              </p>
            </Section>

            <Section
              id="disclaimers"
              title="Disclaimers & limitation of liability"
              roman="x"
              index={10}
            >
              <p>
                The Service is provided &ldquo;as is&rdquo; and &ldquo;as
                available,&rdquo; without warranties of any kind, express or
                implied, including warranties of merchantability, fitness for a
                particular purpose, accuracy, and non-infringement. We do not
                warrant that the Service will be uninterrupted, error-free, or
                secure.
              </p>
              <p>
                To the maximum extent permitted by law, Knoww and its operators
                will not be liable for any indirect, incidental, special,
                consequential, or exemplary damages — including trading losses,
                loss of profits, or loss of data — arising from your use of the
                Service, even if advised of the possibility of such damages. To
                the extent liability cannot be excluded, our total aggregate
                liability is limited to the greater of one hundred US dollars
                (US$100) or the amount you paid us for the Service in the twelve
                months preceding the claim.
              </p>
            </Section>

            <Section
              id="changes"
              title="Changes & termination"
              roman="xi"
              index={11}
            >
              <p>
                We may modify the Service or these terms at any time. If we make
                material changes to these terms, we will update the &ldquo;Last
                updated&rdquo; date and may provide additional notice as
                appropriate. Your continued use of the Service after a change
                takes effect constitutes acceptance of the revised terms.
              </p>
              <p>
                We may suspend or terminate access to the Service at our
                discretion, including for violations of these terms. You may
                stop using the Service at any time; uninstalling the Extension
                removes its local data as described in our{" "}
                <Link href="/privacy">Privacy Policy</Link>.
              </p>
            </Section>

            <Section id="contact" title="Contact" roman="xii" index={12}>
              <p>
                If you have questions about these Terms of Use, contact us at{" "}
                <a href="mailto:contact.us@knoww.app">contact.us@knoww.app</a>.
              </p>
            </Section>
          </div>
        </div>
      </main>

      {/* ── Footer (matches landing) ────────────────────────────────── */}
      <footer className="border-t border-(--kw-fg)/10 bg-(--kw-bg-alt)">
        <div className="border-b border-(--kw-fg)/10">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex flex-col md:flex-row md:items-baseline md:justify-between gap-2 text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/65">
            <span className="flex items-baseline gap-3">
              <span className="kw-editorial italic normal-case tracking-normal text-[13px] text-(--kw-fg)/80">
                № 02 — Summer 2026
              </span>
              <span className="text-(--kw-fg)/25">·</span>
              <span>A terms document, issued alongside the product</span>
            </span>
            <span>knoww.app</span>
          </div>
        </div>

        <div className="max-w-[1200px] mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-3 gap-8 text-[13px]">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <KnowwMark size="sm" />
              <span className="font-bold text-[14px]">Knoww</span>
            </div>
            <p className="text-[12px] text-(--kw-fg)/60 leading-[1.55] max-w-[220px]">
              A prediction market layer for the{" "}
              <span className="kw-editorial italic text-(--kw-fg)/80">
                open internet
              </span>
              .
            </p>
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4">
              Product
            </div>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/markets"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Markets
                </Link>
              </li>
              <li>
                <a
                  href={CHROME_STORE_URL}
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Extension
                </a>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4">
              Legal
            </div>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/privacy"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Privacy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="hover:text-(--kw-fg)/60 transition-colors"
                >
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-(--kw-fg)/10">
          <div className="max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/60">
            <span>© 2026 Knoww</span>
            <span>Made for the prediction-literate</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
