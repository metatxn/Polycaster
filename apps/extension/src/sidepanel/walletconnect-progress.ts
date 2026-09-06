export function walletConnectProgress(status: string, hasQr: boolean): string {
  if (status === "connected") return "Waiting for wallet approval...";
  if (hasQr) return "Scan the QR code, then approve in your wallet...";
  if (status === "pairing") return "Generating QR code...";
  return "Preparing mobile-wallet connection...";
}

export async function withWalletConnectTimeout<T>(
  work: Promise<T>,
  milliseconds: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("WalletConnect request timed out. Please retry.")),
          Math.max(0, milliseconds)
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
