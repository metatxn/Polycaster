import type { Metadata, Viewport } from "next";
import {
  Fraunces,
  Geist,
  Geist_Mono,
  JetBrains_Mono,
  Plus_Jakarta_Sans,
} from "next/font/google";
import { headers } from "next/headers";
import { RootRouteShell } from "@/components/root-route-shell";
import { ThemeProviders } from "@/components/theme-providers";
import { CLOB_BASE_URL, CLOB_WS_BASE_URL } from "@/constants/polymarket";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  DEFAULT_SEO_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  TITLE_TEMPLATE,
} from "@/lib/seo";
import "./globals.css";

// Variable font — one file covers the full 200-800 weight axis (the
// explicit-weight form downloaded seven separate files for the same range).
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
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
  style: ["normal", "italic"],
  display: "swap",
});

// DeFi/trading typography — scoped to product surfaces (markets, etc.).
// Geist is the display/body face; Geist Mono carries every number, label,
// and ticker so prices align across rows. Loaded globally so the variables
// are available, but only consumed inside `.kw-app` so editorial
// surfaces (landing, privacy, terms) keep their current type system.
const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#8b5cf6",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "Knoww — Prediction markets for every opinion",
    template: TITLE_TEMPLATE,
  },
  description: DEFAULT_SEO_DESCRIPTION,
  keywords: ["prediction markets", "polymarket", "trading", "crypto", "odds"],
  metadataBase: new URL(SITE_URL),
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
    siteName: SITE_NAME,
    title: "Knoww — Prediction markets for every opinion",
    description: DEFAULT_SEO_DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Knoww — prediction markets for everything you read",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Knoww — Prediction markets for every opinion",
    description: DEFAULT_SEO_DESCRIPTION,
    images: ["/og-image.png"],
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
  const requestHeaders = await headers();
  const cookies = requestHeaders.get("cookie");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/logo-512x512.png`,
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        publisher: {
          "@id": `${SITE_URL}/#organization`,
        },
      },
    ],
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
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      </head>
      <body
        className={`${plusJakartaSans.variable} ${jetbrainsMono.variable} ${fraunces.variable} ${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <ThemeProviders>
          <RootRouteShell cookies={cookies}>{children}</RootRouteShell>
        </ThemeProviders>
      </body>
    </html>
  );
}
