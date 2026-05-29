"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient cursor glow for the marketing landing page. A soft, accent-tinted
 * bloom follows the pointer in viewport space (so it tracks the cursor even as
 * the page scrolls), reading as atmospheric lighting rather than a flashlight
 * — text stays legible.
 *
 * Disabled for coarse pointers (touch) and when the user prefers reduced
 * motion. Pointer position is committed inside a single rAF per frame so the
 * stream of `pointermove` events never thrashes layout.
 */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (!fine || reduced) return;

    let raf = 0;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let shown = false;

    const commit = () => {
      raf = 0;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (!shown) {
        shown = true;
        el.style.opacity = "var(--kw-cursor-glow-opacity, 0.32)";
      }
      if (!raf) raf = requestAnimationFrame(commit);
    };

    const onLeave = () => {
      // Reset `shown` so the glow re-reveals on the next move — otherwise,
      // once the pointer leaves the window (e.g. clicking another app), the
      // flag stays true and `onMove` never restores opacity on return.
      shown = false;
      el.style.opacity = "0";
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={ref} className="kw-cursor-glow" aria-hidden="true" />;
}
