import { serializeJsonLd } from "@/lib/json-ld";
import { buildPageMetadata, canonicalUrl } from "@/lib/seo";

// The page itself is a client component and cannot export metadata, so the
// route segment's layout carries the title, description, and canonical.
export const metadata = buildPageMetadata({
  title: "Live Sports Prediction Markets",
  description:
    "Follow live sports prediction markets with real-time odds, scores, and game lines across NFL, NBA, MLB, soccer, and more on Knoww.",
  path: "/events/sports/live",
});

// Mirrors the visible ProductHero trail on the live page (Markets → Live)
// so structured data matches rendered content (SEO §12.3/§12.5).
const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Markets",
      item: canonicalUrl("/markets"),
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Live",
      item: canonicalUrl("/events/sports/live"),
    },
  ],
};

export default function LiveSportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      {children}
    </>
  );
}
