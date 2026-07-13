import assert from "node:assert/strict";
import { test } from "vitest";
import { renderWalletConnectQrSvg } from "../../src/content/trading/walletconnect-qr";

test("render-local React requires preserve synchronous WalletConnect SVG output", () => {
  const svg = renderWalletConnectQrSvg("wc:test");

  assert.match(
    svg,
    /^<svg height="200" viewBox="0 0 \d+ \d+" width="200" xmlns="http:\/\/www\.w3\.org\/2000\/svg">/
  );
  assert.match(svg, /<title>WalletConnect QR code<\/title>/);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /fill="#0a0a0a"/);
  assert.match(svg, /<\/svg>$/);
});
