const path = require("node:path");
const fs = require("node:fs");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");

require("dotenv").config();

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
      new webpack.DefinePlugin({
        __DEV_MODE__: JSON.stringify(devMode),
        "process.env.NODE_DEBUG": JSON.stringify(""),
        "process.env.NODE_ENV": JSON.stringify(
          isProduction ? "production" : "development"
        ),
      }),
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
        process: "process/browser",
      }),
      new CopyPlugin({
        patterns: [
          { from: "manifest.json", to: "manifest.json" },
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
