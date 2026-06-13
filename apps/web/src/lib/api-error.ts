import { NextResponse } from "next/server";

/**
 * The one error envelope for /api/* routes: `{ success: false, error }`.
 * Superset of the legacy bare `{ error }` shape, so adopting it is
 * non-breaking for existing consumers. Errors are never cacheable.
 */
export function jsonError(
  error: string,
  status: number,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { success: false, error },
    { status, headers: { "Cache-Control": "no-store", ...headers } }
  );
}
