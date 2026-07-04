import assert from "node:assert/strict";
import test from "node:test";
import {
  isEip1193PendingRequestError,
  isEip1193UnsupportedMethodError,
  isEip1193UserRejectedError,
} from "./trading-errors.ts";

test("EIP-1193 wallet user rejection classifier handles codes and wallet text", () => {
  assert.equal(
    isEip1193UserRejectedError(
      Object.assign(new Error("User rejected the request"), { code: 4001 })
    ),
    true
  );
  assert.equal(
    isEip1193UserRejectedError({ cause: { code: 4001 }, message: "Denied" }),
    true
  );
  assert.equal(isEip1193UserRejectedError(new Error("method missing")), false);
});

test("EIP-1193 unsupported method classifier handles wallet codes and text", () => {
  assert.equal(
    isEip1193UnsupportedMethodError(
      Object.assign(new Error("Unsupported method"), { code: 4200 })
    ),
    true
  );
  assert.equal(
    isEip1193UnsupportedMethodError({
      cause: { code: -32601 },
      details: "Method not found",
    }),
    true
  );
  assert.equal(
    isEip1193UnsupportedMethodError(new Error("User rejected the request")),
    false
  );
});

test("a pending wallet prompt (-32002) is not an unsupported method", () => {
  // viem rewrites -32002 to "Requested resource not available." — treating
  // that as method-unsupported hides the already-open MetaMask popup behind
  // a generic fallback modal.
  const viemPending = Object.assign(
    new Error("Requested resource not available."),
    { code: -32002 }
  );
  assert.equal(isEip1193UnsupportedMethodError(viemPending), false);
  assert.equal(isEip1193PendingRequestError(viemPending), true);
  // Message-only variants (raw MetaMask / viem without a surviving code).
  assert.equal(
    isEip1193UnsupportedMethodError(
      new Error("Requested resource not available.")
    ),
    false
  );
  assert.equal(
    isEip1193PendingRequestError(
      new Error("Request of type 'wallet_requestPermissions' already pending")
    ),
    true
  );
  assert.equal(
    isEip1193PendingRequestError(new Error("User rejected the request")),
    false
  );
});

test("bridge allowlist rejections classify as unsupported method, not user rejection", () => {
  // Both the page bridge and the WalletConnect shim reject methods outside
  // their allowlists with "Method not allowed: <method>". A stale pre-nonce
  // page bridge answers wallet_requestPermissions this way; switchWallet must
  // take its connect fallback instead of rethrowing.
  const bridgeRejection = new Error(
    "Method not allowed: wallet_requestPermissions"
  );
  assert.equal(isEip1193UnsupportedMethodError(bridgeRejection), true);
  assert.equal(isEip1193UserRejectedError(bridgeRejection), false);
});

test("infrastructure errors are not classified as user rejections", () => {
  // The relayer proxy's own create-failure body ("request rejected"), WAF
  // denials (bare "denied"), and node/CLOB signature errors must reach their
  // real error branches — not render as "you declined the wallet prompt".
  assert.equal(
    isEip1193UserRejectedError(
      new Error(
        'Relayer 400: {"success":false,"error":"Relayer create request rejected"}'
      )
    ),
    false
  );
  assert.equal(isEip1193UserRejectedError(new Error("Access denied")), false);
  assert.equal(
    isEip1193UserRejectedError(
      new Error("clob rejected order: invalid transaction signature")
    ),
    false
  );
  // MetaMask's classic rejection text (no EIP-1193 code) must still classify.
  assert.equal(
    isEip1193UserRejectedError(
      new Error("MetaMask Tx Signature: User denied transaction signature.")
    ),
    true
  );
});
