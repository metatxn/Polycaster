import {
  isEip1193PendingRequestError,
  isEip1193UnsupportedMethodError,
  isEip1193UserRejectedError,
} from "@knoww/shared-types/trading-errors";
import type { WalletClient } from "viem";
import { requestPermissions } from "viem/actions";

export async function requestEoaWalletSwitch(
  walletClient?: WalletClient | null
): Promise<boolean> {
  if (!walletClient) return false;

  try {
    await requestPermissions(walletClient, { eth_accounts: {} });
    return true;
  } catch (error) {
    // -32002: the wallet is already showing this prompt — the switcher IS
    // open, so don't stack the generic modal on top of it.
    if (isEip1193PendingRequestError(error)) return true;
    if (isEip1193UnsupportedMethodError(error)) return false;
    if (isEip1193UserRejectedError(error)) return true;
    throw error;
  }
}
