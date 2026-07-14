import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCssBudgets,
  createRouteCssReport,
} from "../../scripts/check-route-css.mjs";

const manifest = {
  pages: {
    "/layout": ["static/css/shared.css", "static/css/fonts.css"],
    "/page": ["static/css/landing.css"],
    "/privacy/page": ["static/css/privacy.css"],
    "/markets/layout": ["static/css/product.css"],
    "/events/layout": ["static/css/product.css"],
  },
};

const assets = new Map([
  ["static/css/shared.css", Buffer.from("shared")],
  ["static/css/fonts.css", Buffer.from("fonts")],
  ["static/css/landing.css", Buffer.from("landing")],
  ["static/css/privacy.css", Buffer.from("privacy")],
  ["static/css/product.css", Buffer.from("product")],
]);

test("route CSS report combines shared and surface assets without duplicates", () => {
  const report = createRouteCssReport(manifest, (asset) => assets.get(asset));

  assert.deepEqual(report.landing.assets, [
    "static/css/fonts.css",
    "static/css/landing.css",
    "static/css/shared.css",
  ]);
  assert.deepEqual(report.markets.assets, [
    "static/css/fonts.css",
    "static/css/product.css",
    "static/css/shared.css",
  ]);
  assert.deepEqual(report.eventDetail.assets, report.markets.assets);
  assert.equal(report.privacy.assets.includes("static/css/landing.css"), false);
  assert.equal(report.markets.assets.includes("static/css/landing.css"), false);
});

test("route CSS budgets identify the surface that regressed", () => {
  const report = createRouteCssReport(manifest, (asset) => assets.get(asset));

  assert.doesNotThrow(() =>
    assertCssBudgets(report, {
      shared: Number.POSITIVE_INFINITY,
      landing: Number.POSITIVE_INFINITY,
      privacy: Number.POSITIVE_INFINITY,
      markets: Number.POSITIVE_INFINITY,
      eventDetail: Number.POSITIVE_INFINITY,
    })
  );
  assert.throws(
    () => assertCssBudgets(report, { landing: 0 }),
    /landing CSS is .* over its 0 B gzip budget/
  );
});
