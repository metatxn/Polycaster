import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { extractPostIdFromAttributes } from "./helpers";

const DiscordAdapter = createBasicAdapter({
  name: "discord",
  hostPatterns: [
    /^discord\.com$/,
    /^ptb\.discord\.com$/,
    /^canary\.discord\.com$/,
  ],
  itemSelectors: ["[id^='chat-messages-']", "li[class*='messageListItem']"],
  containerSelectors: [
    "[data-list-id='chat-messages']",
    "main",
    '[role="main"]',
    "body",
  ],
  textSelectors: ["[id^='message-content-']", "[class*='messageContent']"],
  referenceSelectors: ["[id^='message-content-']", "[class*='messageContent']"],
  accentColor: "#5865f2",
  fontFamily:
    '"gg sans", "Whitney", "Helvetica Neue", Helvetica, Arial, sans-serif',
  getPostId(postElement: Element): string | null {
    return extractPostIdFromAttributes(postElement, [
      "id",
      "data-list-item-id",
    ]);
  },
});

registerAdapterWithRetry(DiscordAdapter, 100, 50);

export { DiscordAdapter };
