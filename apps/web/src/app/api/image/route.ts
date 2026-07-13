import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { imageOptimizerBaseUrl } from "@/lib/image-optimizer";
import { signImageUrl } from "@/lib/image-signing";

const IMAGE_PROXY_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=86400";
const DEFAULT_IMAGE_ACCEPT_HEADER = "image/avif,image/webp,image/*,*/*";
const PROXIED_IMAGE_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-type",
  "etag",
  "expires",
  "last-modified",
] as const;

const ALLOWED_IMAGE_SOURCE_HOSTS = new Set([
  "cryptologos.cc",
  "polymarket-upload.s3.us-east-2.amazonaws.com",
  "polymarket.com",
]);

const ALLOWED_IMAGE_SOURCE_HOST_SUFFIXES = [".polymarket.com"];

function isAllowedImageSource(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;

    const hostname = url.hostname.toLowerCase();
    return (
      ALLOWED_IMAGE_SOURCE_HOSTS.has(hostname) ||
      ALLOWED_IMAGE_SOURCE_HOST_SUFFIXES.some((suffix) =>
        hostname.endsWith(suffix)
      )
    );
  } catch {
    return false;
  }
}

const imageQuerySchema = z.object({
  url: z.string().url().refine(isAllowedImageSource),
  w: z.coerce.number().int().min(1).max(4096),
  q: z.coerce.number().int().min(1).max(100).default(75),
  type: z
    .string()
    .trim()
    .regex(/^[a-z0-9.+-]{1,32}$/)
    .optional(),
  v: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/)
    .optional(),
});

type ImageQuery = z.infer<typeof imageQuerySchema>;

function buildSignedImageOptimizerUrl(
  query: ImageQuery,
  signingKey: string
): URL {
  const optimizerUrl = new URL(imageOptimizerBaseUrl);
  optimizerUrl.searchParams.set("url", query.url);
  optimizerUrl.searchParams.set("q", String(query.q));
  optimizerUrl.searchParams.set("w", String(query.w));
  if (query.type) {
    optimizerUrl.searchParams.set("type", query.type);
  }
  optimizerUrl.searchParams.set(
    "s",
    signImageUrl(query.url, query.w, query.q, signingKey, query.type || "")
  );

  return optimizerUrl;
}

/**
 * @openapi
 * /api/image:
 *   get:
 *     summary: Sign and proxy image optimizer requests.
 *     description: Validates an allowlisted source image URL, signs it with the server-only image optimizer key, and streams the shared image processing service response. The route is used by the custom Next.js image loader so SSR and client hydration see the same-origin URL while the upstream processor still receives an authenticated request.
 *     tags:
 *       - Images
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *         description: HTTPS source image URL from an allowlisted image host.
 *       - in: query
 *         name: w
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 4096
 *         description: Target image width in pixels.
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 75
 *         description: Target image quality.
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           pattern: "^[a-z0-9.+-]{1,32}$"
 *         description: Optional explicit output type understood by the image optimizer.
 *       - in: query
 *         name: v
 *         required: false
 *         schema:
 *           type: string
 *           pattern: "^\\d{1,3}$"
 *         description: Client-side cache key version for proxy URL behavior. It is not sent to the upstream optimizer signature.
 *     responses:
 *       200:
 *         description: Optimized image response from the shared image optimizer.
 *       400:
 *         description: Missing, invalid, or non-allowlisted image query parameters.
 *       429:
 *         description: Rate limit exceeded.
 *       502:
 *         description: Image optimizer request failed.
 *       503:
 *         description: Image optimizer signing is not configured.
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 600,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const parsed = imageQuerySchema.safeParse({
    url: request.nextUrl.searchParams.get("url"),
    w: request.nextUrl.searchParams.get("w"),
    q: request.nextUrl.searchParams.get("q") ?? undefined,
    type: request.nextUrl.searchParams.get("type") ?? undefined,
    v: request.nextUrl.searchParams.get("v") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid image query parameters" },
      { status: 400 }
    );
  }

  const signingKey = process.env.IMAGE_OPTIMIZER_SIGNING_KEY?.trim();
  if (!signingKey) {
    return NextResponse.json(
      { success: false, error: "Image optimizer signing is not configured" },
      { status: 503 }
    );
  }

  let signedUrl: URL;
  try {
    signedUrl = buildSignedImageOptimizerUrl(parsed.data, signingKey);
  } catch {
    return NextResponse.json(
      { success: false, error: "Image optimizer is not configured" },
      { status: 503 }
    );
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(signedUrl, {
      headers: {
        Accept:
          request.headers.get("accept")?.trim() || DEFAULT_IMAGE_ACCEPT_HEADER,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Image optimizer request failed" },
      { status: 502 }
    );
  }

  if (!upstreamResponse.ok) {
    return NextResponse.json(
      { success: false, error: "Image optimizer request failed" },
      { status: upstreamResponse.status || 502 }
    );
  }

  const headers = new Headers();
  for (const headerName of PROXIED_IMAGE_RESPONSE_HEADERS) {
    const value = upstreamResponse.headers.get(headerName);
    if (value) headers.set(headerName, value);
  }
  if (!headers.has("cache-control")) {
    headers.set("Cache-Control", IMAGE_PROXY_CACHE_CONTROL);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
}
