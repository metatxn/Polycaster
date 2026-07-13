import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootRouteShell = readFileSync(
  "src/components/root-route-shell.tsx",
  "utf8"
);
const avatar = readFileSync("src/components/ui/avatar.tsx", "utf8");

test("app route providers keep the server and first client tree deterministic", () => {
  assert.match(
    rootRouteShell,
    /import \{ AppRouteProviders \} from "@\/components\/app-route-providers";/
  );
  assert.doesNotMatch(rootRouteShell, /dynamic\([\s\S]*app-route-providers/);
});

test("avatar images crop non-square profile photos instead of stretching them", () => {
  assert.match(
    avatar,
    /className=\{cn\("aspect-square h-full w-full object-cover", className\)\}/
  );
});
