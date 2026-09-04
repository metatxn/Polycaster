import type { Metadata } from "next";
import Link from "next/link";
import { KnowwMark } from "@/components/knoww-mark";
import { LandingShell } from "@/components/landing/landing-shell";
import "../../styles/landing-route.css";

export const metadata: Metadata = {
  title: "Connect your wallet to Knoww",
  description: "A first-party connection page for Knoww extension setup.",
  robots: { index: false, follow: false },
};

export default function ExtensionConnectPage() {
  return (
    <LandingShell>
      <main
        id="content"
        tabIndex={-1}
        className="relative flex min-h-svh items-center justify-center overflow-hidden px-6 py-12 sm:px-8"
      >
        <div
          className="kw-hero-aurora pointer-events-none absolute inset-0 z-0 overflow-hidden"
          aria-hidden="true"
        >
          <div className="kw-hero-aurora-noise kw-hero-aurora-noise-a" />
          <div className="kw-hero-aurora-noise kw-hero-aurora-noise-b" />
        </div>
        <div className="kw-stage-glow" />
        <div className="kw-grain" />

        <section className="relative z-1 w-full max-w-[720px] border border-(--kw-fg)/20 bg-(--kw-bg)/90 px-6 py-8 backdrop-blur-md sm:px-10 sm:py-12">
          <div className="mb-10 flex items-center gap-3">
            <KnowwMark />
            <span className="text-[15px] font-bold tracking-tight">Knoww</span>
          </div>

          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-(--kw-accent)">
            Extension setup
          </p>
          <h1 className="max-w-[600px] text-[34px] font-bold leading-[1.04] tracking-[-0.035em] sm:text-[48px]">
            Connect your wallet to Knoww
          </h1>
          <p className="mt-5 max-w-[590px] text-[15px] leading-7 text-(--kw-fg)/70 sm:text-base">
            Continue in the Knoww side panel to choose MetaMask or another
            supported wallet. Knoww never receives your private key.
          </p>

          <div
            role="status"
            className="mt-8 border-l-2 border-(--kw-accent) bg-(--kw-fg)/5 px-5 py-4"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-(--kw-fg)/80">
              Continue in the Knoww side panel
            </p>
            <p className="mt-2 text-[13px] leading-6 text-(--kw-fg)/60">
              Keep this tab open while you finish connecting your wallet.
            </p>
          </div>

          <Link
            href="/"
            className="mt-8 inline-flex border-b border-(--kw-fg)/30 pb-1 text-[13px] text-(--kw-fg)/70 transition-colors hover:border-(--kw-fg) hover:text-(--kw-fg)"
          >
            Return to Knoww
          </Link>
        </section>
      </main>
    </LandingShell>
  );
}
