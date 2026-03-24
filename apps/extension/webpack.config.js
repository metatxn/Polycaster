const path = require("node:path");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");

require("dotenv").config();

module.exports = (_env, argv) => {
  const isProduction = argv.mode === "production";
  const devMode = isProduction ? false : process.env.DEV_MODE === "true";

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
      clean: true,
    },
    devtool: isProduction ? false : "cheap-module-source-map",
    module: {
      rules: [
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
      new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      new CopyPlugin({
        patterns: [
          { from: "manifest.json", to: "manifest.json" },
          { from: "options.html", to: "options.html" },
          { from: "styles.css", to: "styles.css" },
          { from: "icons", to: "icons" },
          { from: "src/content/knoww-inline.css", to: "knoww-inline.css" },
          { from: "src/offscreen/offscreen.html", to: "offscreen.html" },
        ],
      }),
    ],
    optimization: {
      minimize: true,
      usedExports: true,
      splitChunks: false,
    },
  };
};
