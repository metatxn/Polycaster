import type { Metadata } from "next";
import { LandingShell } from "@/components/landing/landing-shell";
import "../../styles/landing-route.css";
import { OnboardingLoading, OnboardingSlot } from "./onboarding-slot";

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
        className="relative flex h-dvh flex-col items-center justify-center overflow-hidden p-3 sm:p-4"
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

        <OnboardingSlot />
        <OnboardingLoading />
      </main>
    </LandingShell>
  );
}
