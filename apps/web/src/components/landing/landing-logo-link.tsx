"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/** Header logo link. From other pages it navigates home; on the homepage
 * itself the App Router treats a same-route Link as a no-op, so scroll to
 * the top instead. The landing pages scroll inside the LandingShell's
 * `.kw-landing` fixed overflow container, not on window. */
export function LandingLogoLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href="/"
      className={className}
      onClick={(event) => {
        if (window.location.pathname !== "/") return;
        event.preventDefault();
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        const shell = event.currentTarget.closest(".kw-landing");
        (shell ?? window).scrollTo({
          top: 0,
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }}
    >
      {children}
    </Link>
  );
}
