import { createRequire } from "node:module";

const projectRequire = createRequire(import.meta.url);
// Webpack is a direct build dependency and already owns this parser version.
// Resolve acorn from webpack's dependency graph instead of adding another copy.
const webpackRequire = createRequire(
  projectRequire.resolve("webpack/package.json")
);
const { parse } = webpackRequire("acorn");

function declarationNames(declaration) {
  if (
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "ClassDeclaration"
  ) {
    if (!declaration.id?.name) {
      throw new Error("Malformed ESM export: anonymous named declaration");
    }
    return [declaration.id.name];
  }
  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.map(({ id }) => {
      if (id.type !== "Identifier") {
        throw new Error(
          "Malformed ESM export: destructured variable exports are unsupported"
        );
      }
      return id.name;
    });
  }
  throw new Error(
    `Malformed ESM export: unsupported declaration ${declaration.type}`
  );
}

function exportedName(exported) {
  if (exported.type === "Identifier") return exported.name;
  if (exported.type === "Literal" && typeof exported.value === "string") {
    return exported.value;
  }
  throw new Error("Malformed ESM export: unsupported public name");
}

/** Parse static ESM exports without evaluating the built asset. */
export function extractStaticEsmExportNames(source) {
  if (typeof source !== "string") {
    throw new TypeError("ESM source must be a string");
  }
  let program;
  try {
    program = parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch (error) {
    throw new Error(
      `Malformed ESM export/source: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const names = [];
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      names.push("default");
      continue;
    }
    if (statement.type === "ExportAllDeclaration") {
      if (!statement.exported) {
        throw new Error(
          "Malformed ESM export: export-star names cannot be determined statically"
        );
      }
      names.push(exportedName(statement.exported));
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.declaration) {
      names.push(...declarationNames(statement.declaration));
    }
    for (const specifier of statement.specifiers) {
      names.push(exportedName(specifier.exported));
    }
  }

  if (names.length === 0) throw new Error("No static ESM exports found");
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) throw new Error(`Duplicate ESM export name: ${duplicate}`);
  return names;
}
