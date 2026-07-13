import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, test } from "vitest";

declare const process: { cwd(): string };

interface RawManifestPattern {
  source: string;
  flags: string;
}

interface RawManifestEntry {
  file: string;
  name: string;
  hostPatterns: RawManifestPattern[];
}

interface CanonicalAdapter {
  name: string;
  hostPatterns: RegExp[];
}

type PlatformModule = Record<string, unknown> & {
  adapter?: CanonicalAdapter;
};

const PLATFORM_DIRECTORY = join(process.cwd(), "src/content/platforms");
const MANIFEST_PATH = join(PLATFORM_DIRECTORY, "manifest.json");
const HELPER_MODULES = [
  "basic-adapter",
  "editorial-adapter",
  "helpers",
  "story-adapter-helpers",
] as const;

const EXPECTED_ADAPTER_FILE_ORDER = [
  "twitter",
  "linkedin",
  "reddit",
  "quora",
  "hackernews",
  "stackoverflow",
  "producthunt",
  "slashdot",
  "lemmy",
  "threads",
  "bluesky",
  "mastodon",
  "discord",
  "farcaster",
  "twitch",
  "coinmarketcap",
  "paragraph",
  "coindesk",
  "cointelegraph",
  "decrypt",
  "theblock",
  "blockworks",
  "bankless",
  "bitcoinmagazine",
  "beincrypto",
  "unchained",
  "cryptopanic",
  "extended-editorial",
  "extended-community",
  "kalshi-website",
  "manifold-markets",
  "extended-markets",
  "cnn",
  "yahoo-finance",
  "dlnews",
  "nytimes",
  "wsj",
  "washington-post",
  "thehindu",
  "hindustan-times",
  "cnbc",
  "forbes",
  "espncricinfo",
  "skysports",
  "sporting-news",
  "fox-sports",
  "cnet",
  "zdnet",
  "tomshardware",
] as const;

function readPlatformSideEffectImports(): string[] {
  const source = readFileSync(
    join(process.cwd(), "src/content/index.ts"),
    "utf8"
  );

  return Array.from(
    source.matchAll(/^\s*import\s+["']\.\/platforms\/([^"']+)["'];?\s*$/gm),
    (match) => match[1]
  );
}

function readManifest(): RawManifestEntry[] {
  assert.ok(
    existsSync(MANIFEST_PATH),
    "expected platforms/manifest.json to exist"
  );
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  assert.ok(Array.isArray(parsed), "expected platform manifest to be an array");
  return parsed as RawManifestEntry[];
}

async function importPlatformModule(fileName: string): Promise<PlatformModule> {
  return import(
    `../../src/content/platforms/${fileName}.ts`
  ) as Promise<PlatformModule>;
}

const manifestAdapterFiles = readManifest().map((entry) => entry.file);
const platformSourceFiles = readdirSync(PLATFORM_DIRECTORY)
  .filter((fileName) => fileName.endsWith(".ts"))
  .map((fileName) => fileName.slice(0, -3))
  .sort();

beforeAll(() => {
  globalThis.window = {
    location: { hostname: "unsupported.example" },
  } as unknown as Window & typeof globalThis;
});

describe("canonical adapter exports", () => {
  test.each(
    manifestAdapterFiles
  )("%s exports its adapter through the canonical export", async (fileName) => {
    const module = await importPlatformModule(fileName);
    assert.ok(
      Object.hasOwn(module, "adapter"),
      `expected src/content/platforms/${fileName}.ts to export adapter`
    );
    assert.equal(typeof module.adapter?.name, "string");
    assert.ok(Array.isArray(module.adapter?.hostPatterns));
  });

  test.each(
    HELPER_MODULES
  )("%s remains a helper rather than an adapter entry", async (fileName) => {
    const module = await importPlatformModule(fileName);
    assert.equal(
      Object.hasOwn(module, "adapter"),
      false,
      `expected ${fileName}.ts not to export adapter`
    );
    assert.equal(
      readManifest().some((entry) => entry.file === fileName),
      false,
      `expected ${fileName} not to appear in the platform manifest`
    );
  });
});

test("manifest entries exactly mirror adapter names and regexes", async () => {
  const manifest = readManifest();
  const modules = await Promise.all(
    manifest.map((entry) => importPlatformModule(entry.file))
  );

  assert.equal(
    manifest.length,
    EXPECTED_ADAPTER_FILE_ORDER.length,
    "expected the manifest to retain all established platform adapters"
  );

  for (const [index, entry] of manifest.entries()) {
    const fileName = entry.file;
    const adapter = modules[index].adapter;
    assert.ok(adapter, `expected ${fileName}.ts to export adapter`);
    assert.equal(
      entry.file,
      fileName,
      `expected manifest entry ${index} to reference ${fileName}.ts`
    );
    assert.equal(
      entry.name,
      adapter.name,
      `expected manifest entry ${index} to use ${fileName}.ts adapter.name`
    );
    assert.deepEqual(
      entry.hostPatterns,
      adapter.hostPatterns.map((matcher) => ({
        source: matcher.source,
        flags: matcher.flags,
      })),
      `expected ${entry.name} manifest regex source, flags, count, and order to match its adapter`
    );
  }
});

test("manifest preserves the established adapter order", async () => {
  const manifest = readManifest();
  const modules = await Promise.all(
    manifest.map((entry) => importPlatformModule(entry.file))
  );
  const importedAdapterNames = modules.map((module, index) => {
    assert.ok(
      module.adapter,
      `expected ${manifest[index].file}.ts to export adapter`
    );
    return module.adapter.name;
  });

  assert.deepEqual(
    manifest.map((entry) => entry.file),
    EXPECTED_ADAPTER_FILE_ORDER
  );
  assert.deepEqual(
    manifest.map((entry) => entry.name),
    importedAdapterNames
  );
});

test("content/index.ts has no platform side-effect imports", () => {
  assert.deepEqual(readPlatformSideEffectImports(), []);
});

test("every platform source exporting adapter is represented exactly once", async () => {
  const manifest = readManifest();
  const manifestNames = manifest.map((entry) => entry.name);
  const manifestFiles = manifest.map((entry) => entry.file);
  assert.equal(
    new Set(manifestNames).size,
    manifestNames.length,
    "expected unique platform manifest names"
  );
  assert.equal(
    new Set(manifestFiles).size,
    manifestFiles.length,
    "expected unique platform manifest files"
  );

  const exportingFiles: string[] = [];

  for (const fileName of platformSourceFiles) {
    const module = await importPlatformModule(fileName);
    if (!Object.hasOwn(module, "adapter")) continue;

    exportingFiles.push(fileName);
    assert.ok(
      module.adapter,
      `expected ${fileName}.ts adapter export to be defined`
    );
    assert.equal(
      manifest.filter(
        (entry) =>
          entry.file === fileName && entry.name === module.adapter?.name
      ).length,
      1,
      `expected ${fileName}.ts adapter to appear exactly once in the manifest`
    );
  }

  assert.deepEqual(
    [...manifestFiles].sort(),
    exportingFiles.sort(),
    "expected manifest files to exactly cover adapter-exporting platform sources"
  );
});

describe("findMatchingPlatforms", () => {
  test.each([
    ["twitter.com", ["twitter"]],
    ["meta.stackoverflow.com", ["stackoverflow"]],
    ["sub.stackoverflow.com", []],
    ["unsupported.example", []],
  ] as const)("matches %s", async (hostname, expectedNames) => {
    const { findMatchingPlatforms } = await import(
      "../../src/content/platform-manifest.ts"
    );
    assert.deepEqual(
      findMatchingPlatforms(hostname).map((entry) => entry.name),
      expectedNames
    );
  });
});
