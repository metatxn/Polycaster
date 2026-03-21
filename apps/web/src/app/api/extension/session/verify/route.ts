import { type NextRequest, NextResponse } from "next/server";
import { getAddress, verifyMessage } from "viem";
import {
  issueExtensionSessionToken,
  verifyExtensionChallengeToken,
} from "@/lib/auth/extension-session";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      challengeToken?: string;
      chainId?: number;
      message?: string;
      signature?: string;
      walletAddress?: string;
    };

    if (
      !body.message ||
      !body.signature ||
      !body.challengeToken ||
      !body.walletAddress ||
      !body.chainId
    ) {
      return NextResponse.json(
        {
          error:
            "Missing message, signature, challengeToken, walletAddress, or chainId",
        },
        { status: 400 }
      );
    }

    const walletAddress = getAddress(body.walletAddress);
    const challenge = await verifyExtensionChallengeToken(body.challengeToken);
    if (
      !challenge ||
      challenge.message !== body.message ||
      challenge.address !== walletAddress.toLowerCase() ||
      challenge.chainId !== body.chainId
    ) {
      return NextResponse.json(
        { error: "Invalid or expired challenge" },
        { status: 401 }
      );
    }

    const isValid = await verifyMessage({
      address: walletAddress,
      message: body.message,
      signature: body.signature as `0x${string}`,
    });

    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const { token, claims } = await issueExtensionSessionToken({
      address: walletAddress,
      chainId: body.chainId,
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
