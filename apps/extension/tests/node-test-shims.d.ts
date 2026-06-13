declare module "node:assert/strict" {
  const assert: {
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
  };

  export default assert;
}

declare module "node:fs" {
  export function readFileSync(
    path: string,
    options: { encoding: "utf8" }
  ): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "node:module" {
  const Module: {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };

  export default Module;
}
