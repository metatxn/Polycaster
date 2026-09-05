import { RELAYER_API_ORIGIN } from "@knoww/shared-types/polymarket";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Next.js Middleware
 *
 * Adds security headers to all responses and provides
 * global request-level protections.
 *
 * Runs on Cloudflare Workers edge via OpenNext.
 */

// Derive the image optimizer origin for the CSP img-src. When the env var
// points at a different host (e.g. staging), the CSP follows automatically
// instead of silently blocking images.
const IMAGE_OPTIMIZER_ORIGIN = (() => {
  const raw =
    process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_URL || "https://images.knoww.app/";
  try {
    return new URL(raw).origin;
  } catch {
    return "https://images.knoww.app";
  }
})();

const CANONICAL_HOST = "knoww.app";
const WWW_HOST = "www.knoww.app";
const LOCAL_MCP_CONNECT_SOURCES = [
  "http://127.0.0.1:8787",
  "http://localhost:8787",
] as const;

/**
 * Security headers applied to all responses.
 */
const SECURITY_HEADERS: Record<string, string> = {
  // Prevent clickjacking
  "X-Frame-Options": "DENY",

  // Prevent MIME type sniffing
  "X-Content-Type-Options": "nosniff",

  // Control referrer information
  "Referrer-Policy": "strict-origin-when-cross-origin",

  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",

  // DNS prefetch control
  "X-DNS-Prefetch-Control": "on",

  // Strict Transport Security (1 year, include subdomains, preload)
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",

  // Content Security Policy
  // Allows self, inline styles (for Tailwind/Radix), and specific external sources
  // NOTE: unsafe-eval is only needed in development (HMR / React DevTools).
  // In production, it is removed to harden XSS protection.
  "Content-Security-Policy": [
    "default-src 'self'",
    // Scripts: self + inline (Next.js hydration requires inline scripts).
    // unsafe-eval is conditionally added only in dev (see below).
    // PostHog assets use Knoww's managed proxy; retain the direct asset origin.
    // Cloudflare Insights beacon is served from static.cloudflareinsights.com.
    `script-src 'self' 'unsafe-inline' https://a.knoww.app https://us-assets.i.posthog.com https://static.cloudflareinsights.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    // Block inline event-handler attributes such as onclick= even though Next.js
    // still requires inline script tags for hydration.
    "script-src-attr 'none'",
    // Styles: self + inline (required for Tailwind CSS-in-JS and Radix UI)
    "style-src 'self' 'unsafe-inline'",
    // Images: self + shared optimizer + Polymarket S3 + data URIs + blob URIs + crypto logos
    `img-src 'self' data: blob: ${IMAGE_OPTIMIZER_ORIGIN} https://polymarket-upload.s3.us-east-2.amazonaws.com https://*.polymarket.com https://cryptologos.cc`,
    // Fonts: self + data URIs + Reown-hosted wallet fonts
    "font-src 'self' data: https://fonts.reown.com",
    // Workers: only same-origin workers plus blob workers used by wallet stacks.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Connect: self + PostHog + Cloudflare Insights beacon + knoww.app subdomains
    // + Polymarket APIs + Alchemy + WalletConnect/Web3Modal + Polygon RPC
    // + Coinbase Wallet SDK analytics (cca-lite.coinbase.com)
    `connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com https://cloudflareinsights.com https://*.knoww.app https://clob.polymarket.com https://clob-v2.polymarket.com https://gamma-api.polymarket.com https://data-api.polymarket.com https://user-pnl-api.polymarket.com https://bridge.polymarket.com ${RELAYER_API_ORIGIN} https://*.alchemy.com https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.web3modal.org https://*.web3modal.com https://polygon-rpc.com https://polygon-mainnet.g.alchemy.com wss://ws-subscriptions-clob.polymarket.com wss://ws-subscriptions-clob-v2.polymarket.com wss://sports-api.polymarket.com https://openrouter.ai https://*.reown.com wss://*.reown.com https://cca-lite.coinbase.com${process.env.NODE_ENV === "development" ? " http://127.0.0.1:7503" : ""}`,
    // Frames: wallet providers only; this origin must not be framed by others.
    "frame-src 'self' https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com",
    "frame-ancestors 'none'",
    // Object/base/form restrictions
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Upgrade insecure requests in production only – the directive forces
    // the browser to rewrite HTTP → HTTPS for every sub-resource load,
    // which breaks local HTTP dev servers.
    ...(process.env.NODE_ENV === "production"
      ? ["upgrade-insecure-requests"]
      : []),
  ].join("; "),
};

/**
 * Paths that expose internal-only agent tooling (admin dashboard at /agent
 * and its supporting /api/agent/* routes). These are gated to non-production
 * builds — a single check here keeps the surface dark in production without
 * needing per-route guards in each handler.
 */
function isAgentOnlyPath(pathname: string): boolean {
  if (pathname === "/agent" || pathname.startsWith("/agent/")) return true;
  if (pathname.startsWith("/api/agent/")) return true;
  return false;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function securityHeaderValue(
  key: string,
  value: string,
  pathname: string
): string {
  const isLocalMcpConsole =
    pathname === "/mcp-test" || pathname.startsWith("/mcp-test/");
  if (
    key !== "Content-Security-Policy" ||
    process.env.NODE_ENV !== "development" ||
    !isLocalMcpConsole
  ) {
    return value;
  }

  return value.replace(
    "connect-src 'self'",
    `connect-src 'self' ${LOCAL_MCP_CONNECT_SOURCES.join(" ")}`
  );
}

export function middleware(request: NextRequest) {
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();

  if (host === WWW_HOST) {
    const url = request.nextUrl.clone();
    url.hostname = CANONICAL_HOST;
    url.protocol = "https:";
    url.port = "";

    return applyGlobalHeaders(
      NextResponse.redirect(url, 301),
      requestId,
      request.nextUrl.pathname
    );
  }

  // Block agent tooling in production. Returns a 404 so the surface is
  // indistinguishable from a non-existent route.
  if (
    process.env.NODE_ENV === "production" &&
    isAgentOnlyPath(request.nextUrl.pathname)
  ) {
    return applyGlobalHeaders(
      new NextResponse("Not Found", { status: 404 }),
      requestId,
      request.nextUrl.pathname
    );
  }

  return applyGlobalHeaders(
    NextResponse.next(),
    requestId,
    request.nextUrl.pathname
  );
}

function applyGlobalHeaders(
  response: NextResponse,
  requestId: string,
  pathname: string
) {
  // Apply security headers to all responses
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, securityHeaderValue(key, value, pathname));
  }

  if (isApiPath(pathname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  // Add request ID for tracing
  response.headers.set("X-Request-Id", requestId);

  return response;
}

/**
 * Matcher configuration.
 *
 * Covers all routes EXCEPT Next.js build assets (`/_next/static`,
 * `/_next/image`) and the favicon — those are immutable static files that
 * don't need per-request security headers or host canonicalization, and
 * skipping them avoids running the middleware on every chunk request.
 * robots.txt and sitemap.xml are still matched for host canonicalization.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
