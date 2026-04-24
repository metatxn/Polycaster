import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    reactCompiler: true,
  },
  poweredByHeader: false,
  // Turbopack configuration for development
  turbopack: {
    resolveExtensions: [".mdx", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
    // external: ["pino-pretty", "lokijs", "encoding"],
  },
  serverExternalPackages: ["pino-pretty", "lokijs", "encoding"],
  webpack: (config, { webpack }) => {
    // @polymarket/clob-client-v2 uses `node:crypto` (createHash) in an
    // optional orderbook-hash helper. Rewrite the prefixed import to the
    // bare `crypto` specifier so webpack's polyfill resolution applies for
    // browser bundles.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, "crypto")
    );
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  async headers() {
    // OpenNext on Cloudflare Workers does not propagate images.minimumCacheTTL
    // to the optimized image response, so the browser refetches every visit.
    // Emitting Cache-Control here makes repeat visits hit the HTTP cache.
    return [
      {
        source: "/_next/image",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  // Required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31_536_000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "polymarket-upload.s3.us-east-2.amazonaws.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.polymarket.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;

// added by create cloudflare to enable calling `getCloudflareContext()` in `next dev`
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();
