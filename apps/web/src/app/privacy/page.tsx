import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Knoww (knoww.app) and the Knoww Extension.",
};

const LAST_UPDATED = "January 26, 2026";

const sections = [
  { id: "overview", title: "Overview" },
  { id: "what-we-collect", title: "Information We Collect" },
  { id: "how-we-use", title: "How We Use Information" },
  { id: "sharing", title: "Sharing & Third Parties" },
  { id: "extension", title: "Knoww Extension – Additional Details" },
  { id: "cookies", title: "Storage, Cookies & Similar Technologies" },
  { id: "security", title: "Security" },
  { id: "retention", title: "Data Retention" },
  { id: "your-rights", title: "Your Choices & Rights" },
  { id: "children", title: "Children’s Privacy" },
  { id: "changes", title: "Changes to This Policy" },
  { id: "contact", title: "Contact" },
] as const;

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-primary hover:underline underline-offset-4"
    >
      {children}
    </a>
  );
}
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/80">
        {children}
      </div>
    </section>
  );
}
export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
      <PageBackground />
      <Navbar />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-10">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-3 rounded-2xl bg-linear-to-br from-violet-500 to-blue-500 shadow-lg shadow-violet-500/20">
                <Image
                  src="/logo-256x256.png"
                  alt="Knoww"
                  width={28}
                  height={28}
                  className="rounded-md"
                />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  Privacy Policy
                </h1>
                <p className="text-sm text-foreground/70 font-medium">
                  Last updated: {LAST_UPDATED}
                </p>
              </div>
            </div>

            <p className="text-sm text-foreground/75 leading-relaxed max-w-3xl">
              This Privacy Policy explains how <strong>Knoww</strong> (“Knoww,”
              “we,” “us”) handles information when you use our website and web
              app at{" "}
              <ExternalLink href="https://knoww.app">knoww.app</ExternalLink>{" "}
              (the “Web App”) and our Chrome extension{" "}
              <strong>Knoww – Prediction Markets for Social Media</strong> (also
              referred to as the <strong>Knoww Extension</strong>, the
              “Extension”).
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
            <aside className="lg:sticky lg:top-20 lg:self-start">
              <Card className="bg-card/80 backdrop-blur-sm border-border shadow-sm">
                <CardHeader className="py-4">
                  <CardTitle className="text-base">On this page</CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <nav aria-label="Privacy Policy table of contents">
                    <ul className="space-y-1.5 text-sm">
                      {sections.map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`#${s.id}`}
                            className="text-foreground/75 hover:text-foreground hover:underline underline-offset-4"
                          >
                            {s.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </nav>
                </CardContent>
              </Card>
            </aside>

            <Card className="bg-card/80 backdrop-blur-sm border-border shadow-sm">
              <CardContent className="pt-6 space-y-8">
                <Section id="overview" title="Overview">
                  <p>
                    Knoww is a product that helps you discover and interact with
                    prediction markets (including markets provided by third
                    parties) and related information. The Web App may connect to
                    blockchain wallets and display data associated with public
                    blockchain addresses.
                  </p>
                  <p>
                    The Extension enhances supported social websites by
                    detecting topics in on-screen content and surfacing
                    potentially relevant markets. The Extension processes page
                    content to power these features and makes network requests
                    to market data providers to retrieve results.
                  </p>
                </Section>

                <Section id="what-we-collect" title="Information We Collect">
                  <div className="space-y-2">
                    <p className="font-semibold text-foreground">
                      Information you provide
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>
                        <strong>Wallet information</strong>: if you connect a
                        wallet in the Web App, we and our wallet connectivity
                        providers may receive your public wallet address and
                        related connection metadata.
                      </li>
                      <li>
                        <strong>Support communications</strong>: if you contact
                        us, you may provide your email address and the contents
                        of your message.
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="font-semibold text-foreground">
                      Information collected automatically
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>
                        <strong>Usage and device data</strong>: standard log
                        data such as IP address, browser type, pages viewed, and
                        timestamps may be processed by our hosting and
                        infrastructure providers.
                      </li>
                      <li>
                        <strong>Local app state</strong>: the Web App stores
                        certain preferences and session state in your browser
                        (see “Storage, Cookies & Similar Technologies”).
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="font-semibold text-foreground">
                      Information processed by the Extension
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>
                        <strong>On-page text content</strong> from supported
                        sites may be read and processed to extract keywords and
                        topics for market discovery. This is used to determine
                        what market data queries to run.
                      </li>
                      <li>
                        <strong>Extension settings</strong> (e.g., enabled
                        platforms and sources) are stored using Chrome’s
                        extension storage.
                      </li>
                    </ul>
                  </div>
                </Section>

                <Section id="how-we-use" title="How We Use Information">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <strong>Provide the product</strong>: operate the Web App,
                      show markets, and enable wallet-based features.
                    </li>
                    <li>
                      <strong>Improve and debug</strong>: diagnose issues,
                      protect against abuse, and improve reliability and
                      performance.
                    </li>
                    <li>
                      <strong>Communicate</strong>: respond to support requests
                      and important updates.
                    </li>
                  </ul>
                </Section>

                <Section id="sharing" title="Sharing & Third Parties">
                  <p>
                    We do not sell your personal information. We may share
                    information in the following circumstances:
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <strong>Market data providers</strong>: Knoww queries
                      third party services (for example, Polymarket and Kalshi
                      APIs) to fetch market information. Requests may include
                      search terms derived from your activity (e.g., keywords or
                      tags) and standard network metadata (like IP address)
                      handled by those providers.
                    </li>
                    <li>
                      <strong>Wallet connectivity providers</strong>: the Web
                      App integrates with wallet connection tooling (for
                      example, Reown / WalletConnect and wallet applications).
                      These services may process connection metadata according
                      to their own policies.
                    </li>
                    <li>
                      <strong>Infrastructure providers</strong>: hosting and
                      networking providers may process standard logs to deliver
                      the service.
                    </li>
                    <li>
                      <strong>Legal and safety</strong>: if required by law or
                      to protect users, the public, or our rights.
                    </li>
                  </ul>
                </Section>

                <Section
                  id="extension"
                  title="Knoww Extension – Additional Details"
                >
                  <p className="font-semibold text-foreground">
                    Supported sites
                  </p>
                  <p>
                    The Extension runs on: <strong>x.com</strong>,{" "}
                    <strong>twitter.com</strong>, <strong>linkedin.com</strong>,{" "}
                    <strong>reddit.com</strong> (including old Reddit).
                  </p>

                  <p className="font-semibold text-foreground mt-3">
                    What the Extension does with page content
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      The Extension reads visible content (such as post text) to
                      extract keywords/topics and match relevant markets.
                    </li>
                    <li>
                      The Extension uses those extracted keywords/tags to query
                      market data APIs (e.g., Polymarket and Kalshi) and display
                      results on the page.
                    </li>
                    <li>
                      The Extension stores user settings using Chrome’s{" "}
                      <code className="font-mono text-xs">storage</code>{" "}
                      permission.
                    </li>
                  </ul>

                  <p className="font-semibold text-foreground mt-3">
                    Data sent to Knoww
                  </p>
                  <p>
                    The Extension may communicate with{" "}
                    <ExternalLink href="https://knoww.app">
                      knoww.app
                    </ExternalLink>{" "}
                    to support certain features. If we add features that send
                    more information (for example, sending full page text for AI
                    processing), we will update this policy and/or provide
                    in-product notice where appropriate.
                  </p>
                </Section>

                <Section
                  id="cookies"
                  title="Storage, Cookies & Similar Technologies"
                >
                  <p>
                    The Web App uses browser storage to keep the app usable and
                    remember your preferences. Examples include:
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <strong>Theme and accent preferences</strong> stored in{" "}
                      <code className="font-mono text-xs">localStorage</code>.
                    </li>
                    <li>
                      <strong>Trading onboarding completion</strong> stored in{" "}
                      <code className="font-mono text-xs">localStorage</code>{" "}
                      (per wallet address).
                    </li>
                    <li>
                      <strong>Trading session state</strong> stored in{" "}
                      <code className="font-mono text-xs">localStorage</code>{" "}
                      (with expiration).
                    </li>
                    <li>
                      <strong>API credentials/session secrets</strong> stored in{" "}
                      <code className="font-mono text-xs">sessionStorage</code>{" "}
                      and cleared when you close your browser.
                    </li>
                  </ul>
                  <p>
                    Third parties (such as wallet connectivity providers and
                    hosting providers) may use their own cookies or similar
                    technologies as part of providing their services.
                  </p>
                </Section>

                <Section id="security" title="Security">
                  <p>
                    We use reasonable safeguards designed to protect
                    information. No method of transmission or storage is 100%
                    secure, and we cannot guarantee absolute security.
                  </p>
                </Section>

                <Section id="retention" title="Data Retention">
                  <p>
                    We retain information only for as long as needed for the
                    purposes described in this policy, unless a longer retention
                    period is required or permitted by law. Much of Knoww’s
                    state is stored locally in your browser and can be cleared
                    by clearing site data.
                  </p>
                </Section>

                <Section id="your-rights" title="Your Choices & Rights">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <strong>Disconnect your wallet</strong>: you can
                      disconnect in the Web App and/or in your wallet provider.
                    </li>
                    <li>
                      <strong>Disable the Extension</strong>: you can disable or
                      uninstall the Extension at any time in Chrome.
                    </li>
                    <li>
                      <strong>Control local storage</strong>: you can clear site
                      data (local/session storage) in your browser settings.
                    </li>
                    <li>
                      <strong>Request help</strong>: contact us to ask questions
                      about this policy or your information.
                    </li>
                  </ul>
                </Section>

                <Section id="children" title="Children’s Privacy">
                  <p>
                    Knoww is not intended for children under 13 (or the minimum
                    age required in your jurisdiction). We do not knowingly
                    collect personal information from children.
                  </p>
                </Section>

                <Section id="changes" title="Changes to This Policy">
                  <p>
                    We may update this policy from time to time. If we make
                    material changes, we will update the “Last updated” date and
                    may provide additional notice as appropriate.
                  </p>
                </Section>

                <Section id="contact" title="Contact">
                  <p>
                    If you have questions or requests about this Privacy Policy,
                    contact us at{" "}
                    <a
                      href="mailto:privacy@knoww.app"
                      className="font-semibold text-primary hover:underline underline-offset-4"
                    >
                      privacy@knoww.app
                    </a>
                    .
                  </p>
                </Section>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-border/30 py-6 bg-background/50 backdrop-blur-xl">
        <div className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-256x256.png"
              alt="Knoww Logo"
              width={24}
              height={24}
              className="rounded-md"
            />
            <span className="font-bold text-foreground">Knoww</span>
            <span>•</span>
            <span>
              <Link
                href="/privacy"
                className="hover:text-foreground hover:underline underline-offset-4"
              >
                Privacy
              </Link>
            </span>
          </div>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
