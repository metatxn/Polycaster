import rawManifest from "./platforms/manifest.json";

export interface PlatformManifestEntry {
  file: string;
  name: string;
  matchers: RegExp[];
}

export const PLATFORM_MANIFEST: PlatformManifestEntry[] = rawManifest.map(
  (entry) => ({
    file: entry.file,
    name: entry.name,
    matchers: entry.hostPatterns.map(
      (pattern) => new RegExp(pattern.source, pattern.flags)
    ),
  })
);

function matchesHostname(matcher: RegExp, hostname: string): boolean {
  matcher.lastIndex = 0;
  const matches = matcher.test(hostname);
  matcher.lastIndex = 0;
  return matches;
}

export function findMatchingPlatforms(
  hostname: string
): PlatformManifestEntry[] {
  return PLATFORM_MANIFEST.filter((entry) =>
    entry.matchers.some((matcher) => matchesHostname(matcher, hostname))
  );
}
