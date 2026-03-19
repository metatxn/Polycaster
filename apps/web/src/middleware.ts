import { type NextRequest, NextResponse } from "next/server";

/**
 * Next.js Middleware
 *
 * Adds security headers to all responses and provides
 * global request-level protections.
 *
 * Runs on Cloudflare Workers edge via OpenNext.
 */

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

  // Opt out of FLoC / Topics API tracking
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",

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
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    // Styles: self + inline (required for Tailwind CSS-in-JS and Radix UI)
    "style-src 'self' 'unsafe-inline'",
    // Images: self + Polymarket S3 + data URIs + blob URIs + crypto logos
    "img-src 'self' data: blob: https://polymarket-upload.s3.us-east-2.amazonaws.com https://*.polymarket.com https://cryptologos.cc",
    // Fonts: self + data URIs + Reown-hosted wallet fonts
    "font-src 'self' data: https://fonts.reown.com",
    // Connect: self + knoww.app subdomains + Polymarket APIs + Alchemy + WalletConnect/Web3Modal + Polygon RPC
    "connect-src 'self' https://*.knoww.app https://clob.polymarket.com https://gamma-api.polymarket.com https://data-api.polymarket.com https://user-pnl-api.polymarket.com https://bridge.polymarket.com https://relayer-v2.polymarket.com https://*.alchemy.com https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.web3modal.org https://*.web3modal.com https://polygon-rpc.com https://polygon-mainnet.g.alchemy.com wss://ws-subscriptions-clob.polymarket.com wss://sports-api.polymarket.com https://openrouter.ai https://*.reown.com wss://*.reown.com",
    // Frames: none (we don't embed iframes)
    "frame-src 'self' https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com",
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

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Apply security headers to all responses
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  // Add request ID for tracing (uses Cloudflare's ray ID if available)
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  response.headers.set("X-Request-Id", requestId);

  return response;
}

/**
 * Matcher configuration.
 *
 * Apply middleware to all routes EXCEPT:
 * - Static files (_next/static)
 * - Image optimization (_next/image)
 * - Favicon and other static assets
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, logo-*, manifest.json, robots.txt, sitemap.xml
     * - Public assets (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon|logo-|manifest\\.json|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
