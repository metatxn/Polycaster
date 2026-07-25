import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
  dirname,
  join,
  sep as pathSeparator,
  relative,
  resolve,
} from "node:path";
import ts from "typescript";
import { test } from "vitest";

declare const process: { cwd(): string };

const CONTENT_ROOT = join(process.cwd(), "src/content");
const UI_ROOT = join(CONTENT_ROOT, "ui");
const EXPECTED_UI_FILES = [
  "cards.ts",
  "notifications.ts",
  "stream-bet-ui.ts",
  "index.ts",
] as const;
const EXPECTED_KNOWW_UI_MEMBERS = [
  "createInlineMarketCard",
  "getMarketEmoji",
  "buildMarketUrl",
  "buildKnowwUrl",
  "buildKnowwUrlForOutcome",
  "buildKalshiUrl",
  "createNotificationStack",
  "createNotificationItem",
  "updateNotificationStack",
  "setStreamMarkets",
  "updateNotificationStackTheme",
  "scrollToMarket",
  "initNotificationStack",
  "fetchAndCacheTrending",
  "cancelTrendingFetchTimer",
  "SOURCE_CONFIG",
] as const;

interface StaticImport {
  clause: string | null;
  specifier: string;
}

interface StaticDependency {
  kind: "dynamic-import" | "import" | "re-export" | "require";
  runtimeUrlContract?: "runtime-chunk" | "platform" | null;
  specifier: string;
  webpackIgnoreExact?: boolean;
  typeOnly: boolean;
  unresolved: boolean;
}

const FORBIDDEN_CORE_PACKAGES = [
  "react",
  "react-dom",
  "react-qr-code",
  "viem",
] as const;
const APPROVED_RUNTIME_URL_IMPORTS = new Map([
  [join(CONTENT_ROOT, "trading-loader.ts"), "runtime-chunk"],
  [join(CONTENT_ROOT, "platform-loader.ts"), "platform"],
]);

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function listTypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? listTypeScriptFiles(path)
      : entry.endsWith(".ts")
        ? [path]
        : [];
  });
}

function staticImports(source: string): StaticImport[] {
  const imports: StaticImport[] = [];
  const fromImport = /^\s*import\s+([^;]+?)\s+from\s+(["'])([^"']+)\2\s*;?/gm;
  const sideEffectImport = /^\s*import\s+(["'])([^"']+)\1\s*;?/gm;

  for (const match of source.matchAll(fromImport)) {
    imports.push({ clause: match[1].trim(), specifier: match[3] });
  }
  for (const match of source.matchAll(sideEffectImport)) {
    imports.push({ clause: null, specifier: match[2] });
  }
  return imports;
}

function isTypeOnlyImport(clause: string | null): boolean {
  if (clause === null) return false;
  if (/^type\b/.test(clause)) return true;

  const named = clause.match(/^\{([\s\S]*)\}$/);
  if (!named) return false;
  return named[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .every((part) => /^type\b/.test(part));
}

function staticDependencies(
  source: string,
  fileName = "dependency-scan.ts"
): StaticDependency[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    throw new Error(
      `Cannot statically scan ${fileName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`
    );
  }

  const dependencies: StaticDependency[] = [];
  const exactPlatformTemplate = ["`platforms/$", "{name}.js`"].join("");
  const isExactChunkLiteral = (
    expression: ts.Expression,
    chunk: string
  ): boolean => {
    if (!ts.isStringLiteralLike(expression) || expression.text !== chunk) {
      return false;
    }
    const raw = expression.getText(sourceFile);
    return raw === `"${chunk}"` || raw === `'${chunk}'`;
  };
  const runtimeAssetDeclarations: ts.VariableDeclaration[] = [];
  const collectRuntimeAssetDeclarations = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "RUNTIME_ASSET"
    ) {
      runtimeAssetDeclarations.push(node);
    }
    ts.forEachChild(node, collectRuntimeAssetDeclarations);
  };
  collectRuntimeAssetDeclarations(sourceFile);
  // The loader must declare RUNTIME_ASSET exactly once as the const
  // __STORE_BUILD__ ternary between the two approved runtime chunks; any
  // other shape (shadowing, extra declarations, different literals) keeps
  // the dynamic import unapproved.
  const runtimeAssetContractDeclared =
    runtimeAssetDeclarations.length === 1 &&
    (() => {
      const [declaration] = runtimeAssetDeclarations;
      const list = declaration.parent;
      const initializer = declaration.initializer;
      return (
        ts.isVariableDeclarationList(list) &&
        (list.flags & ts.NodeFlags.Const) !== 0 &&
        initializer !== undefined &&
        ts.isConditionalExpression(initializer) &&
        ts.isIdentifier(initializer.condition) &&
        initializer.condition.text === "__STORE_BUILD__" &&
        isExactChunkLiteral(initializer.whenTrue, "content-wallet.js") &&
        isExactChunkLiteral(initializer.whenFalse, "content-trading.js")
      );
    })();
  const runtimeUrlContract = (
    argument: ts.Expression | undefined
  ): StaticDependency["runtimeUrlContract"] => {
    if (!argument || !ts.isCallExpression(argument)) return null;
    const getUrl = argument.expression;
    if (
      !ts.isPropertyAccessExpression(getUrl) ||
      getUrl.name.text !== "getURL" ||
      !ts.isPropertyAccessExpression(getUrl.expression) ||
      getUrl.expression.name.text !== "runtime" ||
      !ts.isIdentifier(getUrl.expression.expression) ||
      getUrl.expression.expression.text !== "chrome" ||
      argument.arguments.length !== 1
    ) {
      return null;
    }
    const asset = argument.arguments[0];
    if (
      ts.isIdentifier(asset) &&
      asset.text === "RUNTIME_ASSET" &&
      runtimeAssetContractDeclared
    ) {
      return "runtime-chunk";
    }
    if (
      ts.isTemplateExpression(asset) &&
      asset.getText(sourceFile) === exactPlatformTemplate &&
      asset.head.text === "platforms/" &&
      asset.templateSpans.length === 1 &&
      ts.isIdentifier(asset.templateSpans[0].expression) &&
      asset.templateSpans[0].expression.text === "name" &&
      asset.templateSpans[0].literal.text === ".js"
    ) {
      return "platform";
    }
    return null;
  };
  const hasExactWebpackIgnore = (
    node: ts.CallExpression,
    argument: ts.Expression | undefined
  ): boolean => {
    if (!argument) return false;
    const prefix = source.slice(
      node.expression.end,
      argument.getStart(sourceFile)
    );
    const comments = prefix.match(/\/\*[\s\S]*?\*\//g) ?? [];
    if (comments.length !== 1 || comments[0] !== "/* webpackIgnore: true */") {
      return false;
    }
    const triviaWithoutComment = prefix.replace(comments[0], "");
    const suffix = source.slice(argument.end, node.end);
    return /^\s*\(\s*$/.test(triviaWithoutComment) && /^\s*\)\s*$/.test(suffix);
  };
  const add = (
    kind: StaticDependency["kind"],
    expression: ts.Expression | undefined,
    typeOnly: boolean
  ): void => {
    if (expression && ts.isStringLiteralLike(expression)) {
      dependencies.push({
        kind,
        specifier: expression.text,
        typeOnly,
        unresolved: false,
      });
      return;
    }
    dependencies.push({
      kind,
      specifier: "<dynamic require>",
      typeOnly: false,
      unresolved: true,
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const namedBindings = clause?.namedBindings;
      const namedTypesOnly =
        !clause?.name &&
        namedBindings !== undefined &&
        ts.isNamedImports(namedBindings) &&
        namedBindings.elements.length > 0 &&
        namedBindings.elements.every((element) => element.isTypeOnly);
      add(
        "import",
        node.moduleSpecifier,
        clause?.isTypeOnly === true || namedTypesOnly
      );
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const namedTypesOnly =
        node.exportClause !== undefined &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 &&
        node.exportClause.elements.every((element) => element.isTypeOnly);
      add("re-export", node.moduleSpecifier, node.isTypeOnly || namedTypesOnly);
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add("require", node.moduleReference.expression, node.isTypeOnly);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      add("require", node.arguments[0], false);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      dependencies.push({
        kind: "dynamic-import",
        runtimeUrlContract: runtimeUrlContract(argument),
        specifier:
          argument && ts.isStringLiteralLike(argument)
            ? argument.text
            : "<dynamic import>",
        webpackIgnoreExact: hasExactWebpackIgnore(node, argument),
        typeOnly: false,
        unresolved: !(argument && ts.isStringLiteralLike(argument)),
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return dependencies;
}

function isApprovedRuntimeUrlImport(
  file: string,
  dependency: StaticDependency
): boolean {
  return (
    dependency.kind === "dynamic-import" &&
    dependency.unresolved &&
    dependency.webpackIgnoreExact === true &&
    dependency.runtimeUrlContract === APPROVED_RUNTIME_URL_IMPORTS.get(file)
  );
}

function coreDependencyViolations(file: string, source: string): string[] {
  return staticDependencies(source, file).flatMap(
    ({ specifier, typeOnly, unresolved, ...dependency }) => {
      if (typeOnly) return [];
      if (
        isApprovedRuntimeUrlImport(file, {
          specifier,
          typeOnly,
          unresolved,
          ...dependency,
        })
      ) {
        return [];
      }
      if (unresolved) {
        return [`${relative(CONTENT_ROOT, file)} -> ${specifier}`];
      }
      const packageViolation = FORBIDDEN_CORE_PACKAGES.some(
        (name) => specifier === name || specifier.startsWith(`${name}/`)
      );
      const resolved = specifier.startsWith(".")
        ? resolve(dirname(file), specifier)
        : null;
      const tradingViolation =
        resolved === join(CONTENT_ROOT, "trading") ||
        resolved?.startsWith(
          `${join(CONTENT_ROOT, "trading")}${pathSeparator}`
        );
      return packageViolation || tradingViolation
        ? [`${relative(CONTENT_ROOT, file)} -> ${specifier}`]
        : [];
    }
  );
}

test("the decomposed UI module files exist and the legacy ui.ts is removed", () => {
  for (const file of EXPECTED_UI_FILES) {
    assert.ok(
      existsSync(join(UI_ROOT, file)),
      `expected src/content/ui/${file}`
    );
  }
  assert.equal(
    existsSync(join(CONTENT_ROOT, "ui.ts")),
    false,
    "expected src/content/ui.ts to be deleted after importers are repointed"
  );
});

test("the content entry side-effect imports ui/index instead of the legacy ui module", () => {
  const imports = staticImports(readSource("src/content/index.ts"));
  const sideEffectImports = imports
    .filter((entry) => entry.clause === null)
    .map((entry) => entry.specifier);

  assert.ok(
    sideEffectImports.includes("./ui/index"),
    "expected content/index.ts to side-effect import ./ui/index"
  );
  assert.equal(
    imports.some((entry) => entry.specifier === "./ui"),
    false,
    "expected content/index.ts not to import the legacy ./ui path"
  );
});

test("the core UI has no trading implementation value imports", () => {
  const uiFilesWithTradingValueImports = listTypeScriptFiles(UI_ROOT)
    .filter((file) =>
      staticImports(readFileSync(file, "utf8")).some(
        ({ clause, specifier }) =>
          specifier.startsWith("../trading/") && !isTypeOnlyImport(clause)
      )
    )
    .map((file) => relative(UI_ROOT, file))
    .sort();

  assert.deepEqual(uiFilesWithTradingValueImports, []);

  const indexTradingImports = staticImports(
    readSource("src/content/ui/index.ts")
  )
    .filter(
      ({ clause, specifier }) =>
        specifier.startsWith("../trading/") && !isTypeOnlyImport(clause)
    )
    .map(({ specifier }) => specifier);
  assert.deepEqual(indexTradingImports, []);
});

test("every core content source is statically isolated from trading and its heavy packages", () => {
  const violations = listTypeScriptFiles(CONTENT_ROOT)
    .filter((file) => {
      const relativePath = relative(CONTENT_ROOT, file);
      return (
        !relativePath.startsWith(`trading${pathSeparator}`) &&
        !relativePath.startsWith(`platforms${pathSeparator}`)
      );
    })
    .flatMap((file) =>
      coreDependencyViolations(file, readFileSync(file, "utf8"))
    )
    .sort();

  assert.deepEqual(violations, []);
});

test("the source dependency scan cannot be bypassed with re-exports or CommonJS require", () => {
  const dependencies = staticDependencies(`
      export { runtime } from "../trading/runtime";
      export * from "react";
      const viem = require("viem");
      const commonJsRuntime = require("../trading/commonjs-runtime");
      export type { RuntimeType } from "../trading/runtime-types";
      export { type ReactNode } from "react";
    `)
    .filter(({ typeOnly }) => !typeOnly)
    .map(({ specifier }) => specifier);

  assert.deepEqual(dependencies, [
    "../trading/runtime",
    "react",
    "viem",
    "../trading/commonjs-runtime",
  ]);
  assert.deepEqual(staticDependencies("require(runtimeTarget);"), [
    {
      kind: "require",
      specifier: "<dynamic require>",
      typeOnly: false,
      unresolved: true,
    },
  ]);
  assert.deepEqual(
    staticDependencies(`
      import("../trading/dynamic-runtime");
      import("react");
      import(runtimeUrl);
    `).map(({ kind, specifier, unresolved }) => ({
      kind,
      specifier,
      unresolved,
    })),
    [
      {
        kind: "dynamic-import",
        specifier: "../trading/dynamic-runtime",
        unresolved: false,
      },
      { kind: "dynamic-import", specifier: "react", unresolved: false },
      {
        kind: "dynamic-import",
        specifier: "<dynamic import>",
        unresolved: true,
      },
    ]
  );

  for (const loader of ["trading-loader.ts", "platform-loader.ts"]) {
    const file = join(CONTENT_ROOT, loader);
    assert.deepEqual(
      coreDependencyViolations(file, readFileSync(file, "utf8")),
      []
    );
  }
  const tradingLoaderSource = readSource("src/content/trading-loader.ts");
  assert.notDeepEqual(
    coreDependencyViolations(
      join(CONTENT_ROOT, "unexpected-loader.ts"),
      tradingLoaderSource
    ),
    []
  );
  assert.notDeepEqual(
    coreDependencyViolations(
      join(CONTENT_ROOT, "trading-loader.ts"),
      tradingLoaderSource.replace("content-trading.js", "unexpected.js")
    ),
    []
  );
  for (const collidingMutation of [
    tradingLoaderSource.replace(
      '"content-trading.js"',
      '"content - trading.js"'
    ),
    tradingLoaderSource.replace("webpackIgnore", "webpack Ignore"),
  ]) {
    assert.notDeepEqual(
      coreDependencyViolations(
        join(CONTENT_ROOT, "trading-loader.ts"),
        collidingMutation
      ),
      []
    );
  }
});

test("ui/index.ts is the sole owner of the global KNOWW_UI assignment", () => {
  const assignmentOwners = listTypeScriptFiles(CONTENT_ROOT)
    .filter((file) =>
      /\bwindow\s*\.\s*KNOWW_UI\s*=(?!=)/.test(readFileSync(file, "utf8"))
    )
    .map((file) => relative(CONTENT_ROOT, file))
    .sort();

  assert.deepEqual(assignmentOwners, ["ui/index.ts"]);
  assert.match(
    readSource("src/content/ui/index.ts"),
    /\bwindow\s*\.\s*KNOWW_UI\s*=\s*KNOWW_UI\s*;/,
    "expected the exported mapper itself to become the global mapper"
  );
});

test("the exported and global KNOWW_UI mapper keeps exactly its established public surface", () => {
  const indexSource = readSource("src/content/ui/index.ts");
  const mapper = indexSource.match(
    /export\s+const\s+KNOWW_UI\s*=\s*\{([\s\S]*?)\}\s*;/
  );
  assert.ok(mapper, "expected ui/index.ts to export the KNOWW_UI mapper");

  const memberNames = mapper[1]
    .split(",")
    .map((member) => member.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1])
    .filter((member): member is string => member !== undefined);

  assert.deepEqual(memberNames, EXPECTED_KNOWW_UI_MEMBERS);
  assert.match(indexSource, /window\.KNOWW_UI\s*=\s*KNOWW_UI\s*;/);
});

test("trading modules avoid the ui barrel while direct consumers use the outcome-balances leaf", () => {
  const tradingRoot = join(CONTENT_ROOT, "trading");
  const barrelImports = listTypeScriptFiles(tradingRoot).flatMap((file) =>
    staticImports(readFileSync(file, "utf8"))
      .filter(({ specifier }) => {
        if (!specifier.startsWith(".")) return false;
        const target = resolve(dirname(file), specifier);
        return target === UI_ROOT || target === join(UI_ROOT, "index");
      })
      .map(({ specifier }) => `${relative(tradingRoot, file)} -> ${specifier}`)
  );
  assert.deepEqual(
    barrelImports,
    [],
    "expected no trading import from the ui barrel"
  );

  for (const [file, expectedImport] of [
    ["trading-service.ts", "../ui/outcome-balances"],
    ["panel/positions-view.ts", "../../ui/outcome-balances"],
    ["panel/order-view.ts", "../../ui/outcome-balances"],
  ] as const) {
    const imports = staticImports(
      readSource(`src/content/trading/${file}`)
    ).map(({ specifier }) => specifier);
    assert.ok(
      imports.includes(expectedImport),
      `expected ${file} to import the direct ui/outcome-balances leaf`
    );
  }
});

test("the trading entry and glue cannot import core barrels or loaders", () => {
  const forbiddenTargets = new Set([
    UI_ROOT,
    join(UI_ROOT, "index"),
    join(CONTENT_ROOT, "trading-loader"),
    join(CONTENT_ROOT, "platform-loader"),
  ]);
  const violations = ["trading-entry.ts", "trading-glue.ts"].flatMap((name) => {
    const file = join(CONTENT_ROOT, "trading", name);
    return staticImports(readFileSync(file, "utf8")).flatMap(
      ({ clause, specifier }) => {
        if (isTypeOnlyImport(clause) || !specifier.startsWith(".")) return [];
        const target = resolve(dirname(file), specifier);
        return forbiddenTargets.has(target) ? [`${name} -> ${specifier}`] : [];
      }
    );
  });

  assert.deepEqual(violations, []);
});

test("React QR renderers are synchronously bundled but evaluated only at explicit render calls", () => {
  const panel = readSource("src/content/trading/trading-panel.ts");
  const staticQr = readSource("src/content/trading/walletconnect-qr.ts");
  for (const [name, source] of [
    ["trading-panel.ts", panel],
    ["walletconnect-qr.ts", staticQr],
  ] as const) {
    const eagerHeavyImports = staticImports(source).filter(
      ({ clause, specifier }) =>
        !isTypeOnlyImport(clause) &&
        [
          "react",
          "react-dom/client",
          "react-dom/server",
          "react-qr-code",
        ].includes(specifier)
    );
    assert.deepEqual(
      eagerHeavyImports,
      [],
      `${name} has eager React QR imports`
    );
  }

  const panelRenderer = panel.match(
    /function mountMobileQrCode\([\s\S]*?\n\}/
  )?.[0];
  const staticRenderer = staticQr.match(
    /export function renderWalletConnectQrSvg\([\s\S]*?\n\}/
  )?.[0];
  assert.ok(panelRenderer, "expected panel QR renderer");
  assert.ok(staticRenderer, "expected static QR renderer");
  for (const dependency of ["react", "react-dom/client", "react-qr-code"]) {
    assert.match(
      panelRenderer,
      new RegExp(`require\\(["']${dependency.replace("/", "\\/")}["']\\)`)
    );
  }
  for (const dependency of ["react", "react-dom/server", "react-qr-code"]) {
    assert.match(
      staticRenderer,
      new RegExp(`require\\(["']${dependency.replace("/", "\\/")}["']\\)`)
    );
  }
});
