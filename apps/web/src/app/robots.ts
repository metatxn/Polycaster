import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        // Googlebot needs these same-origin resources to render indexable pages.
        // API responses are still protected from indexing by X-Robots-Tag.
        "/api/image",
        "/api/events/",
        "/api/comments",
        "/api/markets/price-history/",
        "/api/markets/price-history/batch",
      ],
      disallow: ["/api/"],
    },
    sitemap: "https://knoww.app/sitemap.xml",
  };
}
