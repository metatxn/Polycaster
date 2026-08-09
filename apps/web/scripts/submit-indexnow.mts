import { createLogger } from "@knoww/logger";
import { parseIndexNowCliUrls, submitIndexNow } from "../src/lib/indexnow.ts";

const log = createLogger("indexnow.cli");
const urls = parseIndexNowCliUrls(process.argv.slice(2));
const key = process.env.INDEXNOW_KEY;

async function main(): Promise<void> {
  if (!key) {
    throw new Error("INDEXNOW_KEY is not configured");
  }

  const result = await submitIndexNow(urls, key);
  log.info("submission_accepted", result);
}

main().catch((error: unknown) => {
  log.error("submission_failed", {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
