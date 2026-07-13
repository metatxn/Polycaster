import assert from "node:assert/strict";
import { describe, test } from "vitest";

// @ts-expect-error Task 4 intentionally introduces this plain-ESM helper.
import { collectEntryModules } from "../../scripts/lib/stats-graph.mjs";

describe("collectEntryModules", () => {
  test("rejects an unknown entrypoint", () => {
    assert.throws(
      () =>
        collectEntryModules(
          { entrypoints: {}, modules: [], chunks: [] },
          "missing"
        ),
      /missing entrypoint "missing"/i
    );
  });

  test("requires a non-empty entrypoint chunk list", () => {
    assert.throws(
      () =>
        collectEntryModules(
          {
            entrypoints: { content: {} },
            modules: [],
            chunks: [],
          },
          "content"
        ),
      /entrypoint "content" chunks must be a non-empty array/i
    );
    assert.throws(
      () =>
        collectEntryModules(
          {
            entrypoints: { content: { chunks: [] } },
            modules: [],
            chunks: [],
          },
          "content"
        ),
      /entrypoint "content" chunks must be a non-empty array/i
    );
  });

  test("requires top-level module and chunk arrays", () => {
    assert.throws(
      () =>
        collectEntryModules(
          {
            entrypoints: { content: { chunks: ["content"] } },
            chunks: [],
          },
          "content"
        ),
      /stats modules must be an array/i
    );
    assert.throws(
      () =>
        collectEntryModules(
          {
            entrypoints: { content: { chunks: ["content"] } },
            modules: [],
          },
          "content"
        ),
      /stats chunks must be an array/i
    );
  });

  test("rejects an entrypoint whose selected chunk is absent", () => {
    assert.throws(
      () =>
        collectEntryModules(
          {
            entrypoints: { content: { chunks: ["content"] } },
            modules: [],
            chunks: [{ id: "other", modules: [] }],
          },
          "content"
        ),
      /selected chunk "content" is missing/i
    );
  });

  test("rejects an empty selected entrypoint graph", () => {
    assert.throws(
      () =>
        collectEntryModules(
          {
            entrypoints: { content: { chunks: ["content"] } },
            modules: [],
            chunks: [{ id: "content", modules: [] }],
          },
          "content"
        ),
      /entrypoint "content" module graph is empty/i
    );
  });

  test("rejects malformed module chunk and nested-module collections", () => {
    assert.throws(
      () =>
        collectEntryModules(
          {
            entrypoints: { content: { chunks: ["content"] } },
            modules: [{ name: "bad-chunks", chunks: "content" }],
            chunks: [{ id: "content", modules: [] }],
          },
          "content"
        ),
      /module chunks must be an array/i
    );
    assert.throws(
      () =>
        collectEntryModules(
          {
            entrypoints: { content: { chunks: ["content"] } },
            modules: [
              {
                name: "bad-nested-modules",
                chunks: ["content"],
                modules: {},
              },
            ],
            chunks: [{ id: "content", modules: [] }],
          },
          "content"
        ),
      /module nested modules must be an array/i
    );
    assert.throws(
      () =>
        collectEntryModules(
          {
            entrypoints: { content: { chunks: ["content"] } },
            modules: [],
            chunks: [{ id: "content", modules: {} }],
          },
          "content"
        ),
      /selected chunk "content" modules must be an array/i
    );
  });

  test("normalizes numeric and string chunk ids", () => {
    const modules = collectEntryModules(
      {
        entrypoints: { content: { chunks: [7] } },
        modules: [
          {
            name: "./src/content/from-top-level.ts",
            chunks: ["7"],
          },
        ],
        chunks: [
          {
            id: "7",
            modules: [{ name: "./src/content/from-chunk.ts" }],
          },
        ],
      },
      "content"
    );

    assert.deepEqual([...modules].sort(), [
      "./src/content/from-chunk.ts",
      "./src/content/from-top-level.ts",
    ]);
  });

  test("collects only modules associated with the requested entrypoint chunks", () => {
    const stats = {
      entrypoints: {
        content: { chunks: ["content", "shared"] },
        options: { chunks: ["options", "shared"] },
      },
      modules: [
        {
          identifier: "ts-loader!/repo/apps/extension/src/content/index.ts",
          name: "./src/content/index.ts",
          nameForCondition: "/repo/apps/extension/src/content/index.ts",
          chunks: ["content"],
        },
        {
          identifier: "ts-loader!/repo/apps/extension/src/shared.ts",
          name: "./src/shared.ts",
          nameForCondition: "/repo/apps/extension/src/shared.ts",
          chunks: ["shared"],
        },
        {
          identifier: "ts-loader!/repo/apps/extension/src/options.ts",
          name: "./src/options.ts",
          nameForCondition: "/repo/apps/extension/src/options.ts",
          chunks: ["options"],
        },
      ],
      chunks: [
        { id: "content", modules: [] },
        { id: "shared", modules: [] },
        { id: "options", modules: [] },
      ],
    };

    const modules = collectEntryModules(stats, "content");

    assert.ok(modules instanceof Set);
    assert.deepEqual([...modules].sort(), [
      "/repo/apps/extension/src/content/index.ts",
      "/repo/apps/extension/src/shared.ts",
    ]);
  });

  test("recursively flattens selected top-level and chunk-local module trees", () => {
    const stats = {
      entrypoints: {
        content: { chunks: ["content"] },
        options: { chunks: ["options"] },
      },
      modules: [
        {
          identifier: "concatenated-content-module",
          name: "./src/content/main.ts + 2 modules",
          nameForCondition: "/repo/apps/extension/src/content/main.ts",
          chunks: ["content"],
          modules: [
            {
              identifier:
                "ts-loader!/repo/apps/extension/src/content/platform-loader.ts",
              name: "./src/content/platform-loader.ts",
              nameForCondition:
                "/repo/apps/extension/src/content/platform-loader.ts",
            },
            {
              identifier: "./src/content/nested-by-identifier.ts",
              name: "./src/content/nested-by-name.ts",
            },
          ],
        },
        {
          identifier: "options-only-module",
          nameForCondition: "/repo/apps/extension/src/options.ts",
          chunks: ["options"],
          modules: [
            {
              identifier: "options-only-child",
              nameForCondition:
                "/repo/apps/extension/src/content/platforms/twitter.ts",
            },
          ],
        },
      ],
      chunks: [
        {
          id: "content",
          modules: [
            {
              name: "./src/content/chunk-only.ts",
              modules: [
                {
                  identifier: "chunk-nested-identifier",
                  nameForCondition:
                    "/repo/apps/extension/src/content/chunk-nested.ts",
                },
              ],
            },
          ],
        },
        {
          id: "options",
          modules: [
            {
              name: "./src/content/platforms/reddit.ts",
            },
          ],
        },
      ],
    };

    const modules = collectEntryModules(stats, "content");

    assert.deepEqual([...modules].sort(), [
      "./src/content/chunk-only.ts",
      "./src/content/nested-by-identifier.ts",
      "/repo/apps/extension/src/content/chunk-nested.ts",
      "/repo/apps/extension/src/content/main.ts",
      "/repo/apps/extension/src/content/platform-loader.ts",
    ]);
    assert.equal(
      modules.has("/repo/apps/extension/src/content/platforms/twitter.ts"),
      false
    );
    assert.equal(modules.has("./src/content/platforms/reddit.ts"), false);
  });
});
