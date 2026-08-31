import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sections = readFileSync(
  "src/components/landing/extension-sections.tsx",
  "utf8"
);
const privacy = readFileSync("src/app/privacy/privacy-client.tsx", "utf8");
const terms = readFileSync("src/app/terms/terms-client.tsx", "utf8");
const manifest = JSON.parse(readFileSync("../extension/manifest.json", "utf8"));
const normalizedSections = sections.replace(/\s+/g, " ");
const normalizedPrivacy = privacy.replace(/\s+/g, " ");
const normalizedTerms = terms.replace(/\s+/g, " ");

test("extension landing permissions match the extension manifest", () => {
  const permissionsBlock = sections.slice(
    sections.indexOf("const PERMISSIONS = ["),
    sections.indexOf("export function PermissionsSection")
  );
  const landingPermissions = Array.from(
    permissionsBlock.matchAll(/name: "([^"]+)"/g),
    (match) => match[1]
  );

  assert.deepEqual(landingPermissions.sort(), [...manifest.permissions].sort());
  assert.equal(manifest.permissions.length, 4);
  assert.match(
    normalizedSections,
    /asks for exactly four Chrome API permissions/
  );
});

test("extension landing privacy claims match the privacy policy", () => {
  assert.match(normalizedSections, /turn off usage analytics/);
  assert.match(normalizedPrivacy, /enabled by default and can be turned off/);
  assert.match(normalizedSections, /not page addresses or page text/);
  assert.match(
    normalizedPrivacy,
    /do not include page addresses or raw page text/
  );
  assert.match(normalizedSections, /does not inspect page content/);
  assert.match(
    normalizedPrivacy,
    /does not send the page address or page contents/
  );
  assert.match(normalizedSections, /optional AI-assisted mode/);
  assert.match(normalizedPrivacy, /Disable AI-assisted matching/);
});

test("extension landing trading claims match the terms", () => {
  assert.match(normalizedSections, /Knoww is non-custodial/);
  assert.match(normalizedSections, /sign every transaction/);
  assert.match(
    normalizedTerms,
    /Trading features in the Service are non-custodial/
  );
  assert.match(normalizedTerms, /every transaction you sign/);
});
