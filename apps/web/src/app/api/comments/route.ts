import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isValidAddress } from "@/lib/validation";
import type { Comment } from "@/types/comments";

/**
 * Query parameter validation schema for GET
 */
const querySchema = z.object({
  parent_entity_type: z.enum(["Event", "Series", "market"]).optional(),
  parent_entity_id: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).default(40), // Match Polymarket's default
  offset: z.coerce.number().min(0).default(0),
  order: z.string().optional(),
  ascending: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  get_positions: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  get_reports: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  holders_only: z
    .string()
    .transform((val) => val === "true")
    .optional(),
});

/**
 * GET /api/comments
 *
 * Fetch comments from Polymarket Gamma API
 * Reference: https://docs.polymarket.com/api-reference/comments/list-comments
 *
 * Query Parameters:
 * - parent_entity_type: "Event" | "Series" | "market"
 * - parent_entity_id: number (the event/series/market ID)
 * - limit: number (1-100, default 20)
 * - offset: number (default 0)
 * - order: string (comma-separated fields)
 * - ascending: boolean
 * - get_positions: boolean (include user positions)
 * - get_reports: boolean (include report/flag data)
 * - holders_only: boolean (filter to position holders)
 */
export async function GET(request: NextRequest) {
  // Apply rate limiting: 100 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    interval: 60 * 1000,
    uniqueTokenPerInterval: 100,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse and validate query parameters
    const parsed = querySchema.safeParse({
      parent_entity_type: searchParams.get("parent_entity_type") || undefined,
      parent_entity_id: searchParams.get("parent_entity_id") || undefined,
      limit: searchParams.get("limit") || undefined,
      offset: searchParams.get("offset") || undefined,
      order: searchParams.get("order") || undefined,
      ascending: searchParams.get("ascending") || undefined,
      get_positions: searchParams.get("get_positions") || undefined,
      get_reports: searchParams.get("get_reports") || undefined,
      holders_only: searchParams.get("holders_only") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid query parameters",
          details: parsed.error.message,
        },
        { status: 400 }
      );
    }

    // Build query params for Polymarket API
    const params = new URLSearchParams();

    if (parsed.data.parent_entity_type) {
      params.set("parent_entity_type", parsed.data.parent_entity_type);
    }
    if (parsed.data.parent_entity_id !== undefined) {
      params.set("parent_entity_id", String(parsed.data.parent_entity_id));
    }
    params.set("limit", String(parsed.data.limit));
    params.set("offset", String(parsed.data.offset));

    if (parsed.data.order) {
      params.set("order", parsed.data.order);
    }
    if (parsed.data.ascending !== undefined) {
      params.set("ascending", String(parsed.data.ascending));
    }
    if (parsed.data.get_positions !== undefined) {
      params.set("get_positions", String(parsed.data.get_positions));
    }
    if (parsed.data.get_reports !== undefined) {
      params.set("get_reports", String(parsed.data.get_reports));
    }
    if (parsed.data.holders_only !== undefined) {
      params.set("holders_only", String(parsed.data.holders_only));
    }

    const apiUrl = `${POLYMARKET_API.GAMMA.COMMENTS}?${params.toString()}`;

    const response = await fetch(apiUrl, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      next: { revalidate: 30 }, // Cache for 30 seconds
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[comments] Gamma API error:", errorText);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch comments from Polymarket",
          details: response.status,
        },
        { status: response.status }
      );
    }

    const comments: Comment[] = await response.json();

    return NextResponse.json({
      success: true,
      comments,
      pagination: {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        hasMore: comments.length === parsed.data.limit,
      },
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Request body validation schema for POST
 */
const postCommentSchema = z.object({
  body: z
    .string()
    .min(1, "Comment body is required")
    .max(5000, "Comment too long"),
  parentEntityId: z.number(),
  parentEntityType: z.enum(["Event", "Series", "market"]),
  parentCommentId: z.string().optional(),
  // L1 Authentication fields
  auth: z.object({
    address: z
      .string()
      .refine(isValidAddress, { message: "Invalid Ethereum address format" }),
    signature: z.string(),
    timestamp: z.string(),
    nonce: z.string().optional().default("0"),
  }),
});

/**
 * POST /api/comments
 *
 * Create a new comment on Polymarket
 * Reference: https://gamma-api.polymarket.com/comments
 *
 * Request Body:
 * - body: string (the comment text)
 * - parentEntityId: number (the event/series/market ID)
 * - parentEntityType: "Event" | "Series" | "market"
 * - parentCommentId: string (optional, for replies)
 * - auth: { address, signature, timestamp, nonce } (L1 authentication)
 */
export async function POST(request: NextRequest) {
  // Apply rate limiting: 10 comments per minute
  const rateLimitResponse = checkRateLimit(request, {
    interval: 60 * 1000,
    uniqueTokenPerInterval: 10,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const json = await request.json();

    // Parse and validate request body
    const parsed = postCommentSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { body, parentEntityId, parentEntityType, parentCommentId, auth } =
      parsed.data;

    // Build the payload for Polymarket API
    const payload: Record<string, unknown> = {
      body,
      parentEntityId,
      parentEntityType,
    };

    // Add parentCommentId if this is a reply
    if (parentCommentId) {
      payload.parentCommentId = parentCommentId;
    }

    // Build L1 authentication headers
    const l1Headers = {
      POLY_ADDRESS: auth.address,
      POLY_SIGNATURE: auth.signature,
      POLY_TIMESTAMP: auth.timestamp,
      POLY_NONCE: auth.nonce,
    };

    const response = await fetch(POLYMARKET_API.GAMMA.COMMENTS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...l1Headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[comments] Gamma API POST error:", errorText);

      // Handle specific error cases
      if (response.status === 401) {
        return NextResponse.json(
          {
            success: false,
            error: "Authentication failed. Please sign in again.",
          },
          { status: 401 }
        );
      }

      if (response.status === 403) {
        return NextResponse.json(
          {
            success: false,
            error: "You don't have permission to post comments.",
          },
          { status: 403 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: "Failed to post comment to Polymarket",
          details: response.status,
        },
        { status: response.status }
      );
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      comment: result,
    });
  } catch (error) {
    console.error("Error posting comment:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
