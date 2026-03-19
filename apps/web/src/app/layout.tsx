import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import { Toaster } from "sonner";
import { MainContent } from "@/components/main-content";
import { SidebarDesktopNoSSR } from "@/components/sidebar-desktop";
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

export const viewport: Viewport = {
  themeColor: "#8b5cf6",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "Knoww - Know your Odds",
    template: "%s | Knoww",
  },
  description:
    "Trade on real-world events with Knoww. Explore prediction markets for politics, sports, crypto, and more.",
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
    title: "Knoww - Know your Odds",
    description: "Trade on real-world events with prediction markets",
    images: [
      {
        url: "/logo-512x512.png",
        width: 512,
        height: 512,
        alt: "Knoww Prediction Markets",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Knoww - Know your Odds",
    description: "Trade on real-world events with prediction markets",
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
        {/* Preconnect to external API domains for faster initial requests */}
        {/* crossOrigin needed for CORS-enabled fetch/XHR requests to reuse the connection */}
        {/* dns-prefetch fallbacks added for older browsers that don't support preconnect */}
        <link
          rel="preconnect"
          href="https://gamma-api.polymarket.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://gamma-api.polymarket.com" />
        <link
          rel="preconnect"
          href="https://clob.polymarket.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://clob.polymarket.com" />
        <link
          rel="preconnect"
          href="https://data-api.polymarket.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://data-api.polymarket.com" />
        <link rel="dns-prefetch" href="https://user-pnl-api.polymarket.com" />
        <link rel="dns-prefetch" href="https://strapi-matic.poly.market" />
        <link
          rel="dns-prefetch"
          href="https://ws-subscriptions-clob.polymarket.com"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${plusJakartaSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <ContextProvider cookies={cookies}>
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
