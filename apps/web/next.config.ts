import path from "node:path";
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
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@wagmi/core/chains": path.resolve(__dirname, "src/lib/chains.ts"),
      "@wagmi/core/tempo": path.resolve(__dirname, "src/lib/wagmi-tempo.ts"),
      "@wagmi/connectors$": path.resolve(
        __dirname,
        "src/lib/wagmi-connectors.ts"
      ),
      porto$: path.resolve(__dirname, "src/lib/porto-unsupported.ts"),
      "porto/internal$": path.resolve(
        __dirname,
        "src/lib/porto-internal-unsupported.ts"
      ),
    };
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
  // Required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  // Image optimization is delegated to the shared optimizer at
  // `NEXT_PUBLIC_IMAGE_OPTIMIZER_URL` (default: https://images.knoww.app).
  // With a custom loader, Next's built-in `/_next/image` isn't used — so
  // `formats`, `minimumCacheTTL`, and `remotePatterns` would all be no-ops
  // and are intentionally omitted. Format negotiation + long-lived caching
  // are handled by the optimizer itself.
  images: {
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
  },
};

export default nextConfig;

// added by create cloudflare to enable calling `getCloudflareContext()` in `next dev`
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();
