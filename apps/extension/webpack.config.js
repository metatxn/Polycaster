const path = require("node:path");
const fs = require("node:fs");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");

require("dotenv").config();

/**
 * Extract a named `export const NAME: string[] = [...]` array from the
 * supported-hosts.ts source without requiring a full TS compiler.
 * Skips lines that are commented out (// prefix).
 */
function extractStringArray(tsSource, exportName) {
  const pattern = new RegExp(
    `export\\s+const\\s+${exportName}\\s*(?::\\s*string\\[\\])?\\s*=\\s*\\[([\\s\\S]*?)\\];`
  );
  const match = tsSource.match(pattern);
  if (!match) {
    throw new Error(`Could not extract ${exportName} from supported-hosts.ts`);
  }
  const items = [];
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) continue;
    const strMatch = trimmed.match(/"([^"]+)"/);
    if (strMatch) items.push(strMatch[1]);
  }
  return items;
}

function readHostsFile() {
  return fs.readFileSync(
    path.resolve(__dirname, "src/supported-hosts.ts"),
    "utf-8"
  );
}

function buildHostPermissions(hostsSource, devMode) {
  const sitePatterns = extractStringArray(
    hostsSource,
    "SUPPORTED_MATCH_PATTERNS"
  );
  const apiPatterns = extractStringArray(hostsSource, "API_HOST_PERMISSIONS");
  const extra = devMode ? ["http://localhost/*"] : [];
  const unique = [...new Set([...sitePatterns, ...apiPatterns, ...extra])];
  unique.sort();
  return unique;
}

function buildWarMatches(hostsSource) {
  const sitePatterns = extractStringArray(
    hostsSource,
    "SUPPORTED_MATCH_PATTERNS"
  );

  // Chrome is stricter for web_accessible_resources.matches than for
  // host_permissions/content-script matches: path-scoped patterns like
  // `https://www.bbc.com/news/*` are rejected there. Normalize every site
  // pattern to an origin-wide form (`scheme://host/*`) before injecting it
  // into the manifest.
  const normalizedPatterns = sitePatterns.map((pattern) => {
    const match = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]+)(?:\/.*)?$/);
    if (!match) {
      throw new Error(
        `Unsupported web_accessible_resources match pattern: ${pattern}`
      );
    }

    const [, scheme, host] = match;
    return `${scheme}://${host}/*`;
  });

  const unique = [...new Set(normalizedPatterns)];
  unique.sort();
  return unique;
}

const transformersEntry = require.resolve("@huggingface/transformers");

function findTransformersPackageRoot(startPath) {
  let current = path.dirname(startPath);
  while (current !== path.dirname(current)) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (pkg.name === "@huggingface/transformers") {
          return current;
        }
      } catch {
        // Keep searching upward.
      }
    }
    current = path.dirname(current);
  }
  throw new Error(
    `Unable to locate @huggingface/transformers package root from ${startPath}`
  );
}

const transformersPackageRoot = findTransformersPackageRoot(transformersEntry);
const onnxRuntimeDistPath = path.resolve(
  transformersPackageRoot,
  "../../onnxruntime-web/dist"
);
if (!fs.existsSync(onnxRuntimeDistPath)) {
  throw new Error(
    `Unable to locate onnxruntime-web dist folder at ${onnxRuntimeDistPath}`
  );
}

module.exports = (_env, argv) => {
  const isProduction = argv.mode === "production";
  const devMode = isProduction ? false : process.env.DEV_MODE !== "false";

  return {
    entry: {
      background: "./src/background.ts",
      offscreen: "./src/offscreen/offscreen.ts",
      content: "./src/content/index.ts",
      options: "./src/options.tsx",
      "page-bridge": "./src/page-bridge.ts",
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      chunkFilename: "chunks/[name].[contenthash:8].js",
      // Keep webpack's runtime URL detection explicit; this works for
      // extension pages, offscreen docs, and service workers.
      publicPath: "auto",
      clean: true,
    },
    devtool: isProduction ? false : "cheap-module-source-map",
    module: {
      parser: {
        javascript: {
          importMeta: false,
        },
      },
      rules: [
        {
          test: /ort-wasm-simd-threaded\.asyncify\.wasm$/i,
          type: "asset/resource",
          generator: {
            filename: "ort/[name][ext]",
          },
        },
        {
          test: /\.tsx?$/,
          use: {
            loader: "ts-loader",
            options: {
              allowTsInNodeModules: false,
              configFile: path.resolve(__dirname, "tsconfig.json"),
              transpileOnly: true,
            },
          },
          exclude: [/node_modules/, /__tests__/, /\.test\.ts$/, /\.spec\.ts$/],
        },
        {
          test: /\.m?js$/,
          resolve: { fullySpecified: false },
        },
      ],
    },
    resolve: {
      extensions: [".tsx", ".ts", ".js"],
      alias: {
        "@knoww/shared-types": path.resolve(
          __dirname,
          "../../packages/shared-types/src"
        ),
        // ProvidePlugin injects `process`; resolve from this package so
        // workspace sources (e.g. @knoww/logger) don't look under packages/*.
        "process/browser": require.resolve("process/browser"),
      },
      fallback: {
        stream: false,
        http: false,
        https: false,
        zlib: false,
        url: false,
        assert: false,
        crypto: false,
      },
    },
    plugins: [
      // @polymarket/clob-client-v2 imports `node:crypto` (createHash) for an
      // optional orderbook-hash helper; rewrite the prefixed import to the
      // bare specifier so the existing `crypto: false` fallback applies.
      new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, "crypto"),
      {
        apply(compiler) {
          const pluginName = "ReplaceImportMetaPlugin";
          compiler.hooks.compilation.tap(pluginName, (compilation) => {
            compilation.hooks.processAssets.tap(
              {
                name: pluginName,
                stage:
                  compiler.webpack.Compilation
                    .PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
              },
              (assets) => {
                for (const [name, asset] of Object.entries(assets)) {
                  if (!name.endsWith(".js")) continue;
                  const source = asset.source().toString();
                  if (!source.includes("import.meta")) continue;
                  const replaced = source.replace(
                    /\bimport\.meta/g,
                    '({url:self.location?.href||""})'
                  );
                  compilation.updateAsset(
                    name,
                    new compiler.webpack.sources.RawSource(replaced)
                  );
                }
              }
            );
          });
        },
      },
      new webpack.DefinePlugin({
        __DEV_MODE__: JSON.stringify(devMode),
        "process.env.NODE_DEBUG": JSON.stringify(""),
        "process.env.NODE_ENV": JSON.stringify(
          isProduction ? "production" : "development"
        ),
        "process.env.POLY_BUILDER_CODE": JSON.stringify(
          process.env.POLY_BUILDER_CODE || ""
        ),
      }),
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
        process: "process/browser",
      }),
      new CopyPlugin({
        patterns: [
          {
            from: "manifest.json",
            to: "manifest.json",
            transform: {
              // This transform depends on supported-hosts.ts in addition to
              // manifest.json itself, so CopyPlugin's default caching can
              // otherwise serve stale host_permission/web_accessible_resources
              // output after hosts change.
              cache: false,
              transformer(content) {
                const manifest = JSON.parse(content.toString());
                const hostsSource = readHostsFile();
                manifest.host_permissions = buildHostPermissions(
                  hostsSource,
                  devMode
                );
                if (manifest.web_accessible_resources?.[0]?.matches) {
                  manifest.web_accessible_resources[0].matches =
                    buildWarMatches(hostsSource);
                }
                return `${JSON.stringify(manifest, null, 2)}\n`;
              },
            },
          },
          { from: "options.html", to: "options.html" },
          { from: "styles.css", to: "styles.css" },
          { from: "icons", to: "icons" },
          { from: "src/content/knoww-inline.css", to: "knoww-inline.css" },
          { from: "src/offscreen/offscreen.html", to: "offscreen.html" },
          {
            from: path.join(
              onnxRuntimeDistPath,
              "ort-wasm-simd-threaded.asyncify.mjs"
            ),
            to: "ort/ort-wasm-simd-threaded.asyncify.mjs",
          },
        ],
      }),
    ],
    ignoreWarnings: [
      {
        module:
          /@huggingface[\\/]transformers[\\/]dist[\\/]transformers\.web\.js/i,
        message:
          /Critical dependency: the request of a dependency is an expression/i,
      },
      {
        module:
          /@huggingface[\\/]transformers[\\/]dist[\\/]transformers\.web\.js/i,
        message: /import\.meta/i,
      },
    ],
    optimization: {
      minimize: true,
      usedExports: true,
      splitChunks: {
        chunks: "async",
        minSize: 40 * 1024,
        minChunks: 1,
        maxAsyncRequests: 30,
        maxInitialRequests: 10,
      },
    },
    performance: {
      hints: "warning",
      maxAssetSize: 2 * 1024 * 1024,
      maxEntrypointSize: 2 * 1024 * 1024,
      assetFilter: (assetFilename) => /\.(css|js|mjs)$/.test(assetFilename),
    },
  };
};
