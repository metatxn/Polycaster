import { NextResponse } from "next/server";

/**
 * GET /api/wallet/balances
 *
 * This endpoint has been deprecated.
 * Wallet balance queries now happen on the frontend using the useClobClient hook
 * which uses the real user signer for authentication.
 *
 * For balance information, use wagmi's useBalance hook or query the blockchain directly.
 */
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error:
        "This endpoint has been deprecated. Use wagmi's useBalance hook or the frontend useClobClient hook instead.",
      hint: "Wallet operations require user wallet authentication which is now handled on the frontend.",
    },
    { status: 410 } // 410 Gone
  );
}
