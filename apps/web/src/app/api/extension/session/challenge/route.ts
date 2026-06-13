import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { POLYMARKET_CHAIN_ID } from "@/constants/polymarket";
import { jsonError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { issueExtensionChallengeToken } from "@/lib/auth/extension-session";
import { createSiwxChallenge } from "@/lib/siwx/message";
import { isValidAddress } from "@/lib/validation";

const log = createLogger("api.extension.session.challenge");

const challengeInputSchema = z.object({
  chainId: z
    .number()
    .int()
    .refine((val) => val === POLYMARKET_CHAIN_ID, {
      message: `Unsupported chain ID. Only chain ID ${POLYMARKET_CHAIN_ID} is supported.`,
    }),
  walletAddress: z
    .string()
    .min(1, "walletAddress is required")
    .refine(isValidAddress, {
      message: "Invalid Ethereum address format",
    }),
});

/**
 * @openapi
 * /api/extension/session/challenge:
 *   post:
 *     summary: Request a session challenge for EOA authentication.
 *     description: Returns a custom SIWX challenge string that the caller must sign with their Ethereum private key, along with a short-lived cryptographically signed challenge token that matches the challenge payload.
 *     tags:
 *       - Extension
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: The user's Ethereum wallet address.
 *               chainId:
 *                 type: number
 *                 description: chain ID like ethereum chain id or polygon chain id.
 *             required:
 *               - walletAddress
 *               - chainId
 *     responses:
 *       200:
 *         description: Successfully generated challenge.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 nonce:
 *                   type: string
 *                 issuedAt:
 *                   type: string
 *                 expiresAt:
 *                   type: string
 *                 challengeToken:
 *                   type: string
 *       400:
 *         description: Invalid parameters or malformed request payload.
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
    const parsed = challengeInputSchema.safeParse(body);

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

    const { walletAddress: rawAddress, chainId } = parsed.data;
    const walletAddress = getAddress(rawAddress);

    const challenge = createSiwxChallenge({
      address: walletAddress,
      chainId,
    });
    const signedChallenge = await issueExtensionChallengeToken({
      address: walletAddress,
      chainId,
      message: challenge.message,
    });

    return NextResponse.json(
      {
        message: challenge.message,
        nonce: challenge.nonce,
        issuedAt: challenge.issuedAt,
        expiresAt: new Date(signedChallenge.claims.exp).toISOString(),
        challengeToken: signedChallenge.token,
      },
      { status: 200 }
    );
  } catch (error) {
    log.error("challenge.failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    if (
      error instanceof Error &&
      error.message.includes("EXTENSION_SESSION_SECRET")
    ) {
      return jsonError("Extension session secret is not configured", 503);
    }

    return jsonError("Invalid request payload", 400);
  }
}
