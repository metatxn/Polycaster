import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/portfolio", "/profile/"],
    },
    sitemap: "https://knoww.app/sitemap.xml",
  };
}
