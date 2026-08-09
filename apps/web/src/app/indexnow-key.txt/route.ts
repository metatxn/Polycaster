import { createLogger } from "@knoww/logger";
import { createIndexNowKeyResponse } from "@/lib/indexnow";

const log = createLogger("indexnow");

// Keep verification at request time so the Cloudflare runtime value is never
// captured in a build artifact. Next.js route handlers use the Web Response API.
// Source: https://nextjs.org/docs/15/app/getting-started/route-handlers-and-middleware
export const dynamic = "force-dynamic";

/**
 * IndexNow ownership verification file at a stable root-level location.
 * Source: https://www.indexnow.org/documentation#verifying-ownership-via-the-key
 */
export function GET(): Response {
  const response = createIndexNowKeyResponse(process.env.INDEXNOW_KEY);
  if (response.status !== 200) {
    log.warn("verification_key_unavailable");
  }
  return response;
}
