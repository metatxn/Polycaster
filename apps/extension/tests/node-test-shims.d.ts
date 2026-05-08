declare module "node:assert/strict" {
  const assert: {
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
  };

  export default assert;
}

declare module "node:test" {
  type TestFn = () => void | Promise<void>;

  function test(name: string, fn: TestFn): void;

  export default test;
}

declare module "node:module" {
  const Module: {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };

  export default Module;
}
