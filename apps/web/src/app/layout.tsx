import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import { Toaster } from "sonner";
import { ProChromeController } from "@/components/app-pro-layout";
import { MainContent } from "@/components/main-content";
import { SidebarDesktopNoSSR } from "@/components/sidebar-desktop";
import { CLOB_BASE_URL, CLOB_WS_BASE_URL } from "@/constants/polymarket";
import ContextProvider from "@/context";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

// Editorial display serif — used for the italic accent moments on the
// landing page ("a position", "not around it"). Loading only the weights
// we need keeps the font payload under 30KB.
const fraunces = Fraunces({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["italic"],
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#8b5cf6",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "Knoww — Every opinion is a position",
    template: "%s | Knoww",
  },
  description: "A prediction market layer for the open internet.",
  keywords: ["prediction markets", "polymarket", "trading", "crypto", "odds"],
  metadataBase: new URL("https://knoww.app"),
  icons: {
    icon: [
      // Small screens (mobile) - 16x16
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      // Medium screens (tablet) - 32x32
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      // Large screens (desktop) - 48x48
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: [
      // Apple touch icon
      { url: "/logo-256x256.png", sizes: "256x256", type: "image/png" },
    ],
    shortcut: "/favicon-32x32.png",
  },
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Knoww",
    title: "Knoww — Every opinion is a position",
    description: "A prediction market layer for the open internet.",
    images: [
      {
        url: "/logo-512x512.png",
        width: 512,
        height: 512,
        alt: "Knoww — A prediction market layer for the open internet",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Knoww — Every opinion is a position",
    description: "A prediction market layer for the open internet.",
    images: ["/logo-512x512.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieHeader = await headers();
  const cookies = cookieHeader.get("cookie");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Knoww",
    url: "https://knoww.app",
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* These origins are not used before first paint on browse-first pages,
            so keep them at DNS-prefetch instead of paying an eager TLS cost. */}
        <link rel="dns-prefetch" href="https://gamma-api.polymarket.com" />
        <link rel="dns-prefetch" href="https://api.web3modal.org" />
        <link rel="dns-prefetch" href="https://bridge.polymarket.com" />
        <link rel="dns-prefetch" href={CLOB_BASE_URL} />
        <link rel="dns-prefetch" href="https://data-api.polymarket.com" />
        <link rel="dns-prefetch" href="https://user-pnl-api.polymarket.com" />
        <link rel="dns-prefetch" href="https://strapi-matic.poly.market" />
        <link rel="dns-prefetch" href={CLOB_WS_BASE_URL} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Set app-pro-chrome on <html> synchronously, before React
            hydrates, so the app sidebar doesn't flash in and then
            disappear when the page's useEffect runs. Pro chrome is the
            default on every app route listed below, plus any path under
            /events/, /profile/, or /whales/ (covers /events/detail/…,
            /profile/[address], /whales/backtest, etc.); on /markets
            specifically, `?layout=legacy` escapes back to the card grid.
            Other routes (/, /privacy, /terms) keep the app sidebar. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var path=location.pathname;var p=new URLSearchParams(location.search);var proPaths=['/markets','/whales','/leaderboard','/live','/search','/portfolio'];var eventsAny=path.startsWith('/events/');var profileAny=path.startsWith('/profile/');var whalesAny=path.startsWith('/whales/');var marketsAny=path.startsWith('/markets/');var matches=proPaths.indexOf(path)!==-1||eventsAny||profileAny||whalesAny||marketsAny;var legacyOnMarkets=path==='/markets'&&p.get('layout')==='legacy';if(matches&&!legacyOnMarkets){document.documentElement.classList.add('app-pro-chrome');}}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${plusJakartaSans.variable} ${jetbrainsMono.variable} ${fraunces.variable} font-sans antialiased`}
      >
        <ContextProvider cookies={cookies}>
          {/* Keep the `app-pro-chrome` class on <html> in sync with the
              current pathname. Centralizing this prevents the sidebar
              flash that used to appear when navigating between two pro
              routes (e.g. /markets → /live), where the old page's
              cleanup removed the class before the new page's effect
              could re-add it. */}
          <ProChromeController />
          {/* Desktop sidebar (client-only to avoid rendering on mobile SSR) */}
          <SidebarDesktopNoSSR />
          {/* Main content with responsive margin */}
          <MainContent>{children}</MainContent>
          <Toaster
            position="bottom-right"
            theme="dark"
            richColors
            closeButton
          />
        </ContextProvider>
      </body>
    </html>
  );
}
