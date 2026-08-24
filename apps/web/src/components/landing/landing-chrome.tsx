import { Download } from "lucide-react";
import Link from "next/link";
import { KnowwMark } from "@/components/knoww-mark";
import { LandingLogoLink } from "@/components/landing/landing-logo-link";
import { LandingThemeDropdown } from "@/components/landing/landing-theme-dropdown";

export const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/knoww-%E2%80%94-every-opinion-is/naoaonihikedoiemhbolbnolibpmojgf";

export type LandingNavLink = { label: string; href: string };

/** Header nav for the editorial/content pages (guides, about, how-it-works). */
export const CONTENT_NAV: LandingNavLink[] = [
  { label: "Guides", href: "/guides" },
  { label: "About", href: "/about" },
  { label: "How Knoww works", href: "/how-knoww-works" },
  { label: "Markets →", href: "/markets" },
];

const NAV_LINK_CLASS =
  "inline-flex items-center py-1 hover:text-(--kw-fg)/60 transition-colors";

/** Shared landing-page header. Hash hrefs render as plain anchors (in-page
 * scroll); path hrefs render as Next links. */
export function LandingHeader({ nav }: { nav: LandingNavLink[] }) {
  return (
    <header className="kw-glass-bar border-b border-(--kw-fg)/10">
      <div className="max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <LandingLogoLink className="flex items-center gap-2">
            <KnowwMark />
            <span className="font-bold text-[15px] tracking-tight">Knoww</span>
          </LandingLogoLink>
        </div>

        <nav className="hidden lg:flex items-center gap-8 text-[14px] font-medium">
          {nav.map((item) =>
            item.href.startsWith("/") ? (
              <Link key={item.href} href={item.href} className={NAV_LINK_CLASS}>
                {item.label}
              </Link>
            ) : (
              <a key={item.href} href={item.href} className={NAV_LINK_CLASS}>
                {item.label}
              </a>
            )
          )}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LandingThemeDropdown />
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Add to Chrome"
            className="inline-flex items-center gap-2 bg-(--kw-fg) text-(--kw-bg) px-3 py-2 text-[14px] font-medium hover:bg-(--kw-fg)/90 transition-colors whitespace-nowrap sm:px-4"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Add to Chrome</span>
          </a>
        </div>
      </div>
    </header>
  );
}

/** Shared landing-page footer. */
export function LandingFooter() {
  return (
    <footer className="border-t border-(--kw-fg)/10 bg-(--kw-bg-alt)">
      <div className="max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-10 grid grid-cols-2 md:grid-cols-3 gap-8 text-[13px]">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <KnowwMark size="sm" />
            <span className="font-bold text-[14px]">Knoww</span>
          </div>
          <p className="text-[12px] text-(--kw-fg)/70 leading-[1.55] max-w-[220px]">
            The prediction-market layer for the{" "}
            <span className="kw-editorial text-(--kw-fg)/80">
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
              <Link
                href="/extension"
                className="hover:text-(--kw-fg)/60 transition-colors"
              >
                Extension
              </Link>
            </li>
            <li>
              <a
                href="/#agent"
                className="hover:text-(--kw-fg)/60 transition-colors"
              >
                Agent
              </a>
            </li>
            <li>
              <Link
                href="/guides"
                className="hover:text-(--kw-fg)/60 transition-colors"
              >
                Guides
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-(--kw-fg)/60 mb-4">
            Company
          </div>
          <ul className="space-y-2">
            <li>
              <Link
                href="/about"
                className="hover:text-(--kw-fg)/60 transition-colors"
              >
                About
              </Link>
            </li>
            <li>
              <Link
                href="/how-knoww-works"
                className="hover:text-(--kw-fg)/60 transition-colors"
              >
                How Knoww works
              </Link>
            </li>
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
        <div className="max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-6 sm:px-8 py-4 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.15em] text-(--kw-fg)/70">
          <span>© 2026 Knoww</span>
          <span>Made for the prediction-literate</span>
        </div>
      </div>
    </footer>
  );
}
