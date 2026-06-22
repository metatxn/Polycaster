import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import openNextConfig from "../../open-next.config";

type WranglerConfig = {
  name?: string;
  r2_buckets?: Array<{
    binding?: string;
    bucket_name?: string;
  }>;
  services?: Array<{
    binding?: string;
    service?: string;
  }>;
};

const stripJsonComments = (source: string) => {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      } else if (char === "\n" || char === "\r") {
        output += char;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
};

const parseWranglerConfig = () =>
  JSON.parse(
    stripJsonComments(
      readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8")
    )
  ) as WranglerConfig;

const resolveOverride = async (override: unknown) =>
  typeof override === "function" ? await override() : override;

describe("OpenNext Cloudflare config", () => {
  it("parses JSONC comments without corrupting string literals", () => {
    const parsed = JSON.parse(
      stripJsonComments(`{
        "name": "knoww/*literal*/",
        "services": [
          {
            "binding": "WORKER_SELF_REFERENCE",
            "service": "knoww/*literal*/" // inline comment
          }
        ]
      }`)
    ) as WranglerConfig;

    expect(parsed.name).toBe("knoww/*literal*/");
    expect(parsed.services?.[0]?.service).toBe("knoww/*literal*/");
  });

  it("keeps R2 incremental cache and uses the Cloudflare memory queue for ISR", async () => {
    const defaultOverride = openNextConfig.default.override;
    const middlewareConfig = openNextConfig.middleware;
    const middlewareOverride =
      middlewareConfig && "override" in middlewareConfig
        ? middlewareConfig.override
        : undefined;

    expect(defaultOverride).toBeDefined();
    expect(middlewareConfig).toBeDefined();
    expect(middlewareOverride).toBeDefined();

    if (!defaultOverride || !middlewareOverride) {
      throw new Error("OpenNext Cloudflare overrides are not configured");
    }

    expect(defaultOverride.incrementalCache).not.toBe("dummy");
    expect(middlewareOverride.incrementalCache).not.toBe("dummy");

    const defaultQueue = await resolveOverride(defaultOverride.queue);
    const middlewareQueue = await resolveOverride(middlewareOverride.queue);

    expect(defaultQueue).not.toBe("dummy");
    expect(defaultQueue).not.toBe("direct");
    expect(defaultQueue).toMatchObject({ name: "memory-queue" });

    expect(middlewareQueue).not.toBe("dummy");
    expect(middlewareQueue).not.toBe("direct");
    expect(middlewareQueue).toMatchObject({ name: "memory-queue" });
  });

  it("keeps Wrangler bindings required by OpenNext cache revalidation", () => {
    const wranglerConfig = parseWranglerConfig();

    expect(wranglerConfig.name).toBeTruthy();
    expect(wranglerConfig.r2_buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          binding: "NEXT_INC_CACHE_R2_BUCKET",
        }),
      ])
    );
    expect(wranglerConfig.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          binding: "WORKER_SELF_REFERENCE",
          service: wranglerConfig.name,
        }),
      ])
    );
  });
});
