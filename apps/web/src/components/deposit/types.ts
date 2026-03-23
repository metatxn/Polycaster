import type { SupportedAsset } from "@/hooks/use-bridge";
import type { TokenBalance } from "@/hooks/use-wallet-tokens";

export type DepositStep =
  | "method"
  | "token"
  | "amount"
  | "confirm"
  | "bridge-select";
export type DepositMethod =
  | "wallet"
  | "bridge"
  | "card"
  | "exchange"
  | "paypal";

export interface DepositModalState {
  step: DepositStep;
  selectedMethod: DepositMethod | null;
  selectedToken: TokenBalance | null;
  selectedBridgeAsset: SupportedAsset | null;
  amount: string;
  bridgeAddress: string;
  isProcessing: boolean;
  depositError: string | null;
}
