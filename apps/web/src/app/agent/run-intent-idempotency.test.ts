import { describe, expect, it } from "vitest";
import {
  completeAgentRunIntent,
  getOrCreateAgentRunIntentKey,
  getOrCreateAgentRunIntentKeyWithLock,
} from "./run-intent-idempotency";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("agent run intent idempotency", () => {
  it("recovers the same key after a page reload until a terminal response", () => {
    const storage = createStorage();
    let generated = 0;
    const randomUuid = () => {
      generated += 1;
      return "338295e1-bfe2-4f07-91a9-e23bc86379f1";
    };

    const first = getOrCreateAgentRunIntentKey(storage, "all", randomUuid);
    const afterReload = getOrCreateAgentRunIntentKey(
      storage,
      "all",
      randomUuid
    );

    expect(afterReload).toBe(first);
    expect(generated).toBe(1);
  });

  it("rotates the key only after the matching run completes", () => {
    const storage = createStorage();
    const keys = [
      "338295e1-bfe2-4f07-91a9-e23bc86379f1",
      "7ca67e21-263d-414b-938b-868dd88d15bd",
    ];
    let index = 0;
    const first = getOrCreateAgentRunIntentKey(
      storage,
      "watch-1",
      () => keys[index++]
    );

    completeAgentRunIntent(storage, "watch-1", "different-key");
    expect(
      getOrCreateAgentRunIntentKey(storage, "watch-1", () => keys[index++])
    ).toBe(first);

    completeAgentRunIntent(storage, "watch-1", first);
    expect(
      getOrCreateAgentRunIntentKey(storage, "watch-1", () => keys[index++])
    ).toBe(keys[1]);
  });

  it("coordinates concurrent tabs so they persist one intent key", async () => {
    const storage = createStorage();
    const firstTab = createStorage();
    const secondTab = createStorage();
    let generated = 0;
    let queue = Promise.resolve();
    const lockManager = {
      request<Result>(
        _name: string,
        callback: () => Result | Promise<Result>
      ): Promise<Result> {
        const result = queue.then(callback, callback);
        queue = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      },
    };
    const randomUuid = () => {
      generated += 1;
      return generated === 1
        ? "338295e1-bfe2-4f07-91a9-e23bc86379f1"
        : "7ca67e21-263d-414b-938b-868dd88d15bd";
    };

    const [first, second] = await Promise.all([
      getOrCreateAgentRunIntentKeyWithLock(
        storage,
        "all",
        lockManager,
        randomUuid,
        firstTab
      ),
      getOrCreateAgentRunIntentKeyWithLock(
        storage,
        "all",
        lockManager,
        randomUuid,
        secondTab
      ),
    ]);

    expect(second).toBe(first);
    expect(generated).toBe(1);

    completeAgentRunIntent(storage, "all", first, firstTab);
    expect(
      await getOrCreateAgentRunIntentKeyWithLock(
        storage,
        "all",
        lockManager,
        randomUuid,
        secondTab
      )
    ).toBe(first);
    expect(generated).toBe(1);
  });
});
