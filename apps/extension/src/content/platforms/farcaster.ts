import type { PlatformAdapter } from "../../types/platform";
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

export const adapter: PlatformAdapter = FarcasterAdapter;

export { FarcasterAdapter };
