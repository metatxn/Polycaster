import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { getAddress, verifyMessage } from "viem";
import { z } from "zod";
import { POLYMARKET_CHAIN_ID } from "@/constants/polymarket";
import { jsonError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/api-rate-limit";
import {
  issueExtensionSessionToken,
  verifyExtensionChallengeToken,
} from "@/lib/auth/extension-session";
import { isValidAddress } from "@/lib/validation";

const log = createLogger("api.extension.session.verify");

const verifyInputSchema = z.object({
  challengeToken: z.string().min(1, "challengeToken is required"),
  chainId: z
    .number()
    .int()
    .refine((val) => val === POLYMARKET_CHAIN_ID, {
      message: `Unsupported chain ID. Only chain ID ${POLYMARKET_CHAIN_ID} is supported.`,
    }),
  message: z.string().min(1, "message is required"),
  signature: z
    .string()
    .refine(
      (sig) => typeof sig === "string" && /^0x[0-9a-fA-F]{130}$/.test(sig),
      {
        message:
          "Malformed signature format. Must be a 65-byte hex string (0x-prefixed + 130 hex characters).",
      }
    ),
  walletAddress: z
    .string()
    .min(1, "walletAddress is required")
    .refine(isValidAddress, {
      message: "Invalid Ethereum address format",
    }),
});

/**
 * @openapi
 * /api/extension/session/verify:
 *   post:
 *     summary: Verify the signed challenge and issue a session JWT.
 *     description: Verifies the EOA signature against the custom SIWX challenge and the signed challenge token. If valid, issues a long-lived session JWT token to authorize extension operations.
 *     tags:
 *       - Extension
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               challengeToken:
 *                 type: string
 *               chainId:
 *                 type: number
 *               message:
 *                 type: string
 *               signature:
 *                 type: string
 *               walletAddress:
 *                 type: string
 *             required:
 *               - challengeToken
 *               - chainId
 *               - message
 *               - signature
 *               - walletAddress
 *     responses:
 *       200:
 *         description: Challenge successfully verified. Returns the session JWT token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 expiresAt:
 *                   type: string
 *       400:
 *         description: Malformed request, signature, or invalid payload parameters.
 *       401:
 *         description: Unauthorized (invalid signature or expired challenge).
 *       429:
 *         description: Rate limit exceeded.
 *       503:
 *         description: Service unavailable (e.g. extension session secret not configured).
 */
export async function POST(request: NextRequest) {
  // Rate limit: 30 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const parsed = verifyInputSchema.safeParse(body);

    if (!parsed.success) {
      // Extra field `details` preserved; success: false added
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request payload",
          details: parsed.error.format(),
        },
        { status: 400 }
      );
    }

    const {
      challengeToken,
      chainId,
      message,
      signature,
      walletAddress: rawAddress,
    } = parsed.data;

    const walletAddress = getAddress(rawAddress);

    try {
      const challenge = await verifyExtensionChallengeToken(challengeToken);
      if (
        !challenge ||
        challenge.message !== message ||
        challenge.address !== walletAddress.toLowerCase() ||
        challenge.chainId !== chainId
      ) {
        return jsonError("Invalid or expired challenge", 401);
      }

      const isValid = await verifyMessage({
        address: walletAddress,
        message,
        signature: signature as `0x${string}`,
      });

      if (!isValid) {
        return jsonError("Invalid signature", 401);
      }

      const { token, claims } = await issueExtensionSessionToken({
        address: walletAddress,
        chainId,
      });

      return NextResponse.json(
        {
          success: true,
          token,
          expiresAt: new Date(claims.exp).toISOString(),
        },
        { status: 200 }
      );
    } catch (error) {
      log.error("verify.failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      if (
        error instanceof Error &&
        error.message.includes("EXTENSION_SESSION_SECRET")
      ) {
        return jsonError("Extension session secret is not configured", 503);
      }

      // If it's a signature validation error, key recovery error, or challenge token validation error
      const isClientError =
        error instanceof Error &&
        (error.message.includes("signature") ||
          error.message.includes("Signature") ||
          error.message.includes("JWT") ||
          error.message.includes("jwt") ||
          error.message.includes("expired") ||
          error.message.includes("claim") ||
          error.message.includes("verification"));

      if (isClientError) {
        return jsonError("Invalid signature or expired challenge", 401);
      }

      return jsonError("Failed to establish extension session", 503);
    }
  } catch (error) {
    log.error("verify.payload_parse_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Invalid request payload", 400);
  }
}
