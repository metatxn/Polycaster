import { registerAdapterWithRetry } from "../platform-registry";
import { createEditorialPlatformAdapter } from "./editorial-adapter";

const FarcasterAdapter = createEditorialPlatformAdapter({
  name: "farcaster",
  hostPatterns: [/^(?:www\.)?farcaster\.xyz$/],
  itemSelectors: [
    "[data-testid*='cast']",
    "[data-testid*='feedItem']",
    "[data-testid*='post']",
    "article",
  ],
  textSelectors: [
    "[data-testid*='cast-text']",
    "[data-testid*='text']",
    "div[dir='auto']",
    "p",
  ],
  accentColor: "#8e6cff",
  linkPattern: /\/[^/]+\/(0x[0-9a-f]+)/i,
});

registerAdapterWithRetry(FarcasterAdapter, 100, 50);

export { FarcasterAdapter };
