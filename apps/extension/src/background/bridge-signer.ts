/**
 * BridgeSigner — an ethers v5 Signer that delegates signing to MetaMask
 * via the extension's content script -> page bridge message chain.
 *
 * Flow: BridgeSigner -> chrome.tabs.sendMessage -> content script
 *       -> window.postMessage -> page-bridge.ts -> MetaMask -> back
 *
 * The pending-request state and response listener live in signing-state.ts
 * so the lightweight listener can be loaded eagerly while BridgeSigner
 * (which pulls in ethers) is lazy-loaded.
 */
import { ethers } from "ethers";
import { sendSigningRequest } from "./signing-state";

export class BridgeSigner extends ethers.Signer {
  private _address: string;
  private _tabId: number;

  constructor(
    address: string,
    tabId: number,
    provider?: ethers.providers.Provider
  ) {
    super();
    this._address = address;
    this._tabId = tabId;
    ethers.utils.defineReadOnly(this, "provider", provider || undefined);
  }

  async getAddress(): Promise<string> {
    return this._address;
  }

  async signTransaction(
    _transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>
  ): Promise<string> {
    throw new Error(
      "signTransaction is not supported by BridgeSigner; use sendTransaction instead"
    );
  }

  async signMessage(message: string | ethers.utils.Bytes): Promise<string> {
    const msgHex =
      typeof message === "string"
        ? ethers.utils.hexlify(ethers.utils.toUtf8Bytes(message))
        : ethers.utils.hexlify(message);
    const result = await sendSigningRequest(this._tabId, "personal_sign", [
      msgHex,
      this._address,
    ]);
    return result as string;
  }

  async _signTypedData(
    domain: ethers.TypedDataDomain,
    types: Record<string, ethers.TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string> {
    const payload = JSON.stringify(
      ethers.utils._TypedDataEncoder.getPayload(domain, types, value)
    );
    const result = await sendSigningRequest(
      this._tabId,
      "eth_signTypedData_v4",
      [this._address, payload]
    );
    return result as string;
  }

  async sendTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>
  ): Promise<ethers.providers.TransactionResponse> {
    const tx = await ethers.utils.resolveProperties(transaction);
    const txParams: Record<string, unknown> = {
      from: this._address,
      to: tx.to,
    };
    if (tx.value)
      txParams.value = ethers.BigNumber.from(tx.value).toHexString();
    if (tx.data) txParams.data = ethers.utils.hexlify(tx.data);
    if (tx.gasLimit)
      txParams.gas = ethers.BigNumber.from(tx.gasLimit).toHexString();

    const hash = (await sendSigningRequest(this._tabId, "eth_sendTransaction", [
      txParams,
    ])) as string;

    const provider = this.provider;
    if (!provider) throw new Error("No provider to fetch tx receipt");
    const response = await provider.getTransaction(hash);
    if (response) return response;

    return {
      hash,
      from: this._address,
      confirmations: 0,
      wait: (confirmations?: number) =>
        provider.waitForTransaction(hash, confirmations),
    } as ethers.providers.TransactionResponse;
  }

  connect(provider: ethers.providers.Provider): BridgeSigner {
    return new BridgeSigner(this._address, this._tabId, provider);
  }
}
