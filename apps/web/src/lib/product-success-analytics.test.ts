import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("product success analytics", () => {
  it("tracks successful web split, merge, and cancel outcomes", () => {
    expect(
      readSource("src/components/trading/split-shares-modal.tsx")
    ).toContain('posthog.capture("position_split_succeeded"');
    expect(
      readSource("src/components/trading/merge-shares-modal.tsx")
    ).toContain('posthog.capture("position_merge_succeeded"');
    expect(readSource("src/hooks/use-open-orders.ts")).toContain(
      'posthog.capture("order_cancelled"'
    );
  });
});
