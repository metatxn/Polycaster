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
