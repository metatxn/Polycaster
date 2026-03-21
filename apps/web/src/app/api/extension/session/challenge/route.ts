import { type NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { issueExtensionChallengeToken } from "@/lib/auth/extension-session";
import { createSiwxChallenge } from "@/lib/siwx/message";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      chainId?: number;
      walletAddress?: string;
    };

    if (
      !body.walletAddress ||
      typeof body.walletAddress !== "string" ||
      !body.chainId ||
      typeof body.chainId !== "number"
    ) {
      return NextResponse.json(
        { error: "Missing walletAddress or chainId" },
        { status: 400 }
      );
    }

    const walletAddress = getAddress(body.walletAddress);
    const challenge = createSiwxChallenge({
      address: walletAddress,
      chainId: body.chainId,
    });
    const signedChallenge = await issueExtensionChallengeToken({
      address: walletAddress,
      chainId: body.chainId,
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
    if (
      error instanceof Error &&
      error.message.includes("EXTENSION_SESSION_SECRET")
    ) {
      return NextResponse.json(
        { error: "Extension session secret is not configured" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Invalid request payload" },
      { status: 400 }
    );
  }
}
