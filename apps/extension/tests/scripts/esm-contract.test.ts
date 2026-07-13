import assert from "node:assert/strict";
import { describe, test } from "vitest";

// @ts-expect-error Task 11 intentionally introduces this plain-ESM helper.
import { extractStaticEsmExportNames } from "../../scripts/lib/esm-contract.mjs";

describe("extractStaticEsmExportNames", () => {
  test("extracts direct and aliased exports in source order", () => {
    assert.deepEqual(
      extractStaticEsmExportNames(
        "const internal = 1; export { internal as publicName, internal }; export function factory() {}"
      ),
      ["publicName", "internal", "factory"]
    );
  });

  test("ignores export-like text in comments and string literals", () => {
    assert.deepEqual(
      extractStaticEsmExportNames(
        'const text = "export { fake }"; /* export const hidden = 1 */ export { text as real };'
      ),
      ["real"]
    );
  });

  test("rejects malformed or export-free input instead of passing open", () => {
    assert.throws(
      () => extractStaticEsmExportNames("const value = 1;"),
      /no static ESM exports/i
    );
    assert.throws(
      () => extractStaticEsmExportNames("export { value as };"),
      /malformed ESM export/i
    );
  });

  test("rejects duplicate public export names", () => {
    assert.throws(
      () =>
        extractStaticEsmExportNames(
          "const a = 1; const b = 2; export { a as same, b as same };"
        ),
      /duplicate (?:ESM )?export/i
    );
  });
});
