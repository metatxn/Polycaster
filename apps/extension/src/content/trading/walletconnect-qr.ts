/**
 * Render a WalletConnect pairing URI into a static QR-code SVG string.
 *
 * The side panel (a separate, non-React extension surface) can't run
 * react-qr-code itself, so the content script — where React and react-qr-code
 * already live — renders the QR to markup and ships the SVG string across.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "react-qr-code";

export function renderWalletConnectQrSvg(uri: string): string {
  return renderToStaticMarkup(
    React.createElement(QRCode, {
      value: uri,
      size: 200,
      bgColor: "#ffffff",
      fgColor: "#0a0a0a",
      level: "Q",
      title: "WalletConnect QR code",
    })
  );
}
