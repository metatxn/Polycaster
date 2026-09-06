import assert from "node:assert/strict";
import test from "node:test";
import { isOnboardingSuppressedPath } from "./onboarding-route-suppression.ts";

test("does not overlay web onboarding on extension setup", () => {
  assert.equal(isOnboardingSuppressedPath("/extension/connect"), true);
});

test("suppresses onboarding on the agent dashboard route", () => {
  assert.equal(isOnboardingSuppressedPath("/agent"), true);
});

test("suppresses onboarding on agent dashboard subroutes", () => {
  assert.equal(isOnboardingSuppressedPath("/agent/runs"), true);
});

test("does not suppress onboarding on regular app routes", () => {
  assert.equal(isOnboardingSuppressedPath("/markets"), false);
});
