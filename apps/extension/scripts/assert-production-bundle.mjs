#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");

const forbiddenPathParts = new Set([
  "perf-fixtures",
  "embedding-ab.json",
  "embedding-ab-extra.jsonl",
  "benchmark-embeddings.mjs",
  "benchmark-rerank",
]);

// Local-only artifacts that must never be copied into the shipped bundle.
// Matched against the dist-relative path (forward-slash separated).
const forbiddenPathPatterns = [
  // Anything sourced from the dev/ design-preview folder.
  /(^|\/)dev\//,
  // *preview*.html design previews, wherever they land.
  /[^/]*preview[^/]*\.html$/i,
];

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".txt",
]);

const forbiddenContent = [
  "perf-fixtures/embedding-ab",
  "benchmark:embeddings",
  "bge-small-cls-q8",
  "snowflake-arctic-s-cls-q8",
  "bge-mean-xencoder-top5-int8",
  "snowflake-q8-xencoder-top5-int8",
  "Knoww:extension.content.log",
];

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function relativeDistPath(filePath) {
  return path.relative(distDir, filePath).split(path.sep).join("/");
}

async function fileContainsForbiddenContent(filePath) {
  if (!textExtensions.has(path.extname(filePath))) return [];
  const size = (await stat(filePath)).size;
  if (size > 8 * 1024 * 1024) return [];

  const text = await readFile(filePath, "utf8");
  return forbiddenContent.filter((marker) => text.includes(marker));
}

async function main() {
  const files = await listFiles(distDir);
  const failures = [];

  for (const filePath of files) {
    const relativePath = relativeDistPath(filePath);
    const pathParts = relativePath.split("/");
    for (const part of pathParts) {
      if (forbiddenPathParts.has(part)) {
        failures.push(`${relativePath} matches forbidden path part "${part}"`);
      }
    }

    for (const pattern of forbiddenPathPatterns) {
      if (pattern.test(relativePath)) {
        failures.push(
          `${relativePath} matches forbidden path pattern ${pattern}`
        );
      }
    }

    const markers = await fileContainsForbiddenContent(filePath);
    for (const marker of markers) {
      failures.push(`${relativePath} contains forbidden marker "${marker}"`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `Production extension bundle contains files that must not ship:\n${failures
        .map((failure) => `- ${failure}`)
        .join("\n")}\n`
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write("Production bundle check passed.\n");
}

main().catch((error) => {
  process.stderr.write(
    error instanceof Error ? error.stack || error.message : String(error)
  );
  process.stderr.write("\n");
  process.exitCode = 1;
});
