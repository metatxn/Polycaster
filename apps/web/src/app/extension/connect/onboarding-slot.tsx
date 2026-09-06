"use client";

import { useEffect, useRef, useState } from "react";

export function OnboardingLoading() {
  const fallback = useRef<HTMLDivElement>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (fallback.current && !fallback.current.hidden) setShowRecovery(true);
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, []);
  return (
    <div
      ref={fallback}
      id="knoww-extension-onboarding-fallback"
      role="status"
      className="relative z-1 max-w-md text-center text-(--kw-fg)"
    >
      <p className="font-mono text-sm">Loading Knoww setup...</p>
      {showRecovery && (
        <p className="mt-4 text-sm leading-6">
          Setup is taking longer than expected. Please enable or update Knoww in
          your browser, allow it to run on this site, then refresh this page.
        </p>
      )}
    </div>
  );
}

export function OnboardingSlot() {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Mount extension content only after React has hydrated this empty slot.
    if (slot.current) slot.current.dataset.ready = "true";
  }, []);
  return (
    <div
      ref={slot}
      id="knoww-extension-onboarding"
      className="absolute inset-3 z-1 mx-auto max-w-[1280px] sm:inset-4"
    />
  );
}
