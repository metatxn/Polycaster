import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const walletRouteProviders = readFileSync(
  "src/components/wallet-route-providers.tsx",
  "utf8"
);
const avatar = readFileSync("src/components/ui/avatar.tsx", "utf8");

test("app route providers keep the server and first client tree deterministic", () => {
  assert.match(
    walletRouteProviders,
    /import \{ AppRouteProviders \} from "@\/components\/app-route-providers";/
  );
  assert.doesNotMatch(
    walletRouteProviders,
    /dynamic\([\s\S]*app-route-providers/
  );
});

test("avatar images crop non-square profile photos instead of stretching them", () => {
  assert.match(
    avatar,
    /className=\{cn\("aspect-square h-full w-full object-cover", className\)\}/
  );
});
