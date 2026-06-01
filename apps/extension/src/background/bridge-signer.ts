/**
 * Bridge wallet client — a viem WalletClient-compatible adapter that delegates
 * signing and transaction submission to MetaMask through the content script.
 *
 * Flow: BridgeWalletClient -> chrome.tabs.sendMessage -> content script
 *       -> window.postMessage -> page-bridge.ts -> MetaMask -> back.
 */
import { POLYGON_CHAIN } from "@knoww/shared-types/chains";
import type {
  Address,
  Hex,
  SignMessageParameters,
  SignTypedDataParameters,
} from "viem";
import {
  bytesToHex,
  isHex,
  numberToHex,
  serializeTypedData,
  stringToHex,
} from "viem";
import { sendSigningRequest } from "./signing-state";

type BridgeTransaction = {
  to?: Address | null;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
};

type Eip712DomainField = { name: string; type: string };

export type BridgeWalletClient = {
  account: { address: Address; type: "json-rpc" };
  chain: typeof POLYGON_CHAIN;
  getAddresses: () => Promise<Address[]>;
  requestAddresses: () => Promise<Address[]>;
  signMessage: (params: SignMessageParameters) => Promise<Hex>;
  signTypedData: (params: SignTypedDataParameters) => Promise<Hex>;
  sendTransaction: (transaction: BridgeTransaction) => Promise<Hex>;
  /** Ask the wallet to switch to a chain (used for cross-chain deposits). */
  switchChain: (chainId: number) => Promise<void>;
};

function rawMessageToHex(message: SignMessageParameters["message"]): Hex {
  if (typeof message === "string") {
    return stringToHex(message);
  }
  const raw = message.raw;
  if (typeof raw === "string") {
    return isHex(raw) ? raw : stringToHex(raw);
  }
  return bytesToHex(raw);
}

function valueToHex(value: bigint | undefined): Hex | undefined {
  if (value === undefined) return undefined;
  return numberToHex(value);
}

function getSerializableTypedDataTypes(
  params: SignTypedDataParameters
): SignTypedDataParameters["types"] & {
  EIP712Domain?: Eip712DomainField[];
} {
  const types = { ...params.types } as SignTypedDataParameters["types"] & {
    EIP712Domain?: Eip712DomainField[];
  };
  if (types.EIP712Domain) return types;

  const domain = params.domain ?? {};
  const domainFields: Eip712DomainField[] = [];
  if (domain.name !== undefined) {
    domainFields.push({ name: "name", type: "string" });
  }
  if (domain.version !== undefined) {
    domainFields.push({ name: "version", type: "string" });
  }
  if (domain.chainId !== undefined) {
    domainFields.push({ name: "chainId", type: "uint256" });
  }
  if (domain.verifyingContract !== undefined) {
    domainFields.push({ name: "verifyingContract", type: "address" });
  }
  if (domain.salt !== undefined) {
    domainFields.push({ name: "salt", type: "bytes32" });
  }

  if (domainFields.length > 0) {
    types.EIP712Domain = domainFields;
  }

  return types;
}

export function createBridgeWalletClient(
  address: Address,
  tabId: number
): BridgeWalletClient {
  const account = { address, type: "json-rpc" as const };
  const walletClient = {
    account,
    chain: POLYGON_CHAIN,
    async getAddresses() {
      return [address];
    },
    async requestAddresses() {
      return [address];
    },
    async signMessage(params: SignMessageParameters) {
      return (await sendSigningRequest(tabId, "personal_sign", [
        rawMessageToHex(params.message),
        address,
      ])) as Hex;
    },
    async signTypedData(params: SignTypedDataParameters) {
      const payload = serializeTypedData({
        domain: params.domain,
        types: getSerializableTypedDataTypes(params),
        primaryType: params.primaryType,
        message: params.message,
      } as Parameters<typeof serializeTypedData>[0]);
      return (await sendSigningRequest(tabId, "eth_signTypedData_v4", [
        address,
        payload,
      ])) as Hex;
    },
    async sendTransaction(params: BridgeTransaction) {
      const txParams: Record<string, unknown> = {
        from: address,
        to: params.to,
      };
      const value = valueToHex(params.value);
      if (value) txParams.value = value;
      if (params.data) txParams.data = params.data;
      if (params.gas) txParams.gas = numberToHex(params.gas);

      return (await sendSigningRequest(tabId, "eth_sendTransaction", [
        txParams,
      ])) as Hex;
    },
    async switchChain(chainId: number) {
      await sendSigningRequest(tabId, "wallet_switchEthereumChain", [
        { chainId: numberToHex(chainId) },
      ]);
    },
  };

  return walletClient as BridgeWalletClient;
}
