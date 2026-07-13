import { findMatchingPlatforms } from "./platform-manifest";
import { KNOWW_PLATFORM } from "./platform-registry";

type ImportPlatformModule = (name: string) => Promise<{ adapter?: unknown }>;

const defaultImport: ImportPlatformModule = (name) =>
  import(
    /* webpackIgnore: true */ chrome.runtime.getURL(`platforms/${name}.js`)
  );

export async function loadPlatformAdapter(
  url: URL,
  importModule: ImportPlatformModule = defaultImport
): Promise<boolean> {
  const candidates = findMatchingPlatforms(url.hostname);

  for (const entry of candidates) {
    const module = await importModule(entry.name).catch(() => null);
    const adapter = module?.adapter;
    if (!adapter) continue;

    KNOWW_PLATFORM.registerPlatform(adapter as never);
    if (KNOWW_PLATFORM.detectPlatform()) return true;
  }

  return false;
}
