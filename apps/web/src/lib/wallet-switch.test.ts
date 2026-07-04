import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { requestEoaWalletSwitch } from "./wallet-switch";

declare const process: { cwd(): string };

describe("requestEoaWalletSwitch", () => {
  it("uses the shared EIP-1193 wallet error classifiers", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/wallet-switch.ts"),
      {
        encoding: "utf8",
      }
    );

    expect(source).toContain("@knoww/shared-types/trading-errors");
    expect(source).not.toMatch(/function getErrorCode/);
    expect(source).not.toMatch(/function isUnsupportedWalletPermissionError/);
    expect(source).not.toMatch(/function isUserRejectedWalletPermission/);
  });

  it("opens the injected wallet account picker via wallet_requestPermissions", async () => {
    const request = vi.fn(async (_args: unknown) => [
      { parentCapability: "eth_accounts" },
    ]);

    await expect(requestEoaWalletSwitch({ request } as never)).resolves.toBe(
      true
    );

    expect(request.mock.calls[0]?.[0]).toEqual({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  });

  it("returns false when no EOA wallet client is available", async () => {
    await expect(requestEoaWalletSwitch(null)).resolves.toBe(false);
  });

  it("falls back when the connected wallet does not support permissions", async () => {
    const error = Object.assign(new Error("Unsupported method"), {
      code: 4200,
    });
    const request = vi.fn(async (_args: unknown) => {
      throw error;
    });

    await expect(requestEoaWalletSwitch({ request } as never)).resolves.toBe(
      false
    );
  });

  it("does not fall back when the user rejects the EOA account picker", async () => {
    const error = Object.assign(new Error("User rejected the request"), {
      code: 4001,
    });
    const request = vi.fn(async (_args: unknown) => {
      throw error;
    });

    await expect(requestEoaWalletSwitch({ request } as never)).resolves.toBe(
      true
    );
  });

  it("treats a pending permissions prompt (-32002) as an opened wallet switcher", async () => {
    // viem rewrites -32002 to "Requested resource not available." — the
    // MetaMask popup is already open, so the generic modal must not stack
    // on top of it.
    const error = Object.assign(
      new Error("Requested resource not available."),
      { code: -32002 }
    );
    const request = vi.fn(async (_args: unknown) => {
      throw error;
    });

    await expect(requestEoaWalletSwitch({ request } as never)).resolves.toBe(
      true
    );
  });
});
