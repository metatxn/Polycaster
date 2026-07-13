/**
 * Render a WalletConnect pairing URI into a static QR-code SVG string.
 *
 * React's module factories are required only when QR markup is explicitly
 * requested. Keeping these literal requires inside the renderer preserves the
 * synchronous response contract without evaluating React DOM at bundle import.
 */

declare const require: (request: string) => unknown;

export function renderWalletConnectQrSvg(uri: string): string {
  const React = require("react") as typeof import("react");
  const { renderToStaticMarkup } =
    require("react-dom/server") as typeof import("react-dom/server");
  const { default: QRCode } =
    require("react-qr-code") as typeof import("react-qr-code");
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
