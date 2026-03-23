import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";

export default defineCloudflareConfig({
  // Enable R2 cache with regional caching for better performance
  // Regional cache reduces latency by caching at edge locations
  // "long-lived" mode provides the best performance for most apps
  incrementalCache: withRegionalCache(r2IncrementalCache, {
    mode: "long-lived",
  }),
});
