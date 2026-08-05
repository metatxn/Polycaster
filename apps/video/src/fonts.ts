/**
 * Self-hosted brand fonts, bundled via @fontsource (never the Google Fonts
 * CDN). Importing the weight CSS registers the @font-face rules; the
 * delayRender gate below makes the renderer wait until the glyphs are actually
 * ready so frames never capture a fallback-font flash.
 */
import { cancelRender, continueRender, delayRender } from "remotion";

// Fraunces — italic only (the brand's scarce editorial accent).
import "@fontsource/fraunces/400-italic.css";
import "@fontsource/fraunces/500-italic.css";

// Plus Jakarta Sans — headings, kickers, UI labels.
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";

// JetBrains Mono — numbers, prices, odds, counts, timestamps.
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";

const FACES = [
  'italic 400 40px "Fraunces"',
  'italic 500 40px "Fraunces"',
  '400 40px "Plus Jakarta Sans"',
  '500 40px "Plus Jakarta Sans"',
  '600 40px "Plus Jakarta Sans"',
  '700 40px "Plus Jakarta Sans"',
  '400 40px "JetBrains Mono"',
  '500 40px "JetBrains Mono"',
  '700 40px "JetBrains Mono"',
];

const handle = delayRender("Loading Knoww brand fonts");

if (typeof document !== "undefined" && "fonts" in document) {
  Promise.all(FACES.map((face) => document.fonts.load(face)))
    .then(() => document.fonts.ready)
    .then(() => continueRender(handle))
    .catch((err) => cancelRender(err));
} else {
  continueRender(handle);
}
