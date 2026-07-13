import assert from "node:assert/strict";
import { test } from "vitest";
import {
  type MultiOutcomeItem,
  reconcileMultiOutcomeData,
} from "../../src/content/ui/cards";

test("live refresh repairs option indexes when closed markets change array positions", () => {
  const displayedOptions: MultiOutcomeItem[] = [
    {
      name: "December 31",
      price: 0.58,
      marketIndex: 0,
      conditionId: "december-condition",
    },
    {
      name: "August 31",
      price: 0.44,
      marketIndex: 1,
      conditionId: "august-condition",
    },
  ];
  const refreshedOptions: MultiOutcomeItem[] = [
    {
      name: "December 31",
      price: 0.59,
      marketIndex: 2,
      conditionId: "december-condition",
    },
    {
      name: "August 31",
      price: 0.45,
      marketIndex: 3,
      conditionId: "august-condition",
    },
  ];

  reconcileMultiOutcomeData(displayedOptions, refreshedOptions);

  assert.deepEqual(displayedOptions, refreshedOptions);
});
