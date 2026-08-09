import { describe, expect, it, vi } from "vitest";
import {
  diffIndexNowSitemapSnapshots,
  INDEXNOW_CRON_EXPRESSION,
  type IndexNowSnapshot,
  type IndexNowStateStore,
  runIndexNowSitemapCron,
  shouldRunIndexNowCron,
} from "./indexnow-cron";

const INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://knoww.app/sitemaps/static.xml</loc></sitemap>
</sitemapindex>`;

function urlSetXml(
  entries: Array<{ url: string; lastModified?: string }>
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    ({ url, lastModified }) =>
      `<url><loc>${url}</loc>${lastModified ? `<lastmod>${lastModified}</lastmod>` : ""}</url>`
  )
  .join("\n")}
</urlset>`;
}

function createFetch(
  entries: Array<{ url: string; lastModified?: string }>
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://knoww.app/sitemap.xml") {
      return new Response(INDEX_XML, { status: 200 });
    }
    if (url === "https://knoww.app/sitemaps/static.xml") {
      return new Response(urlSetXml(entries), { status: 200 });
    }
    throw new Error("Unexpected request");
  }) as typeof fetch;
}

function createStateStore(initialValue: string | null = null): {
  state: IndexNowStateStore;
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (initialValue !== null) {
    values.set("indexnow:sitemap-snapshot:v1", initialValue);
  }

  return {
    values,
    state: {
      get: vi.fn(async (key) => values.get(key) ?? null),
      put: vi.fn(async (key, value) => {
        values.set(key, value);
      }),
    },
  };
}

function snapshot(
  entries: Array<{ url: string; lastModified?: string | null }>
): IndexNowSnapshot {
  return {
    version: 1,
    entries: entries.map(({ url, lastModified = null }) => ({
      url,
      lastModified,
    })),
  };
}

describe("shouldRunIndexNowCron", () => {
  it("runs only the enabled, dedicated hourly trigger", () => {
    expect(shouldRunIndexNowCron(INDEXNOW_CRON_EXPRESSION, "true")).toBe(true);
    expect(shouldRunIndexNowCron("*/5 * * * *", "true")).toBe(false);
    expect(shouldRunIndexNowCron(INDEXNOW_CRON_EXPRESSION, "false")).toBe(
      false
    );
  });
});

describe("diffIndexNowSitemapSnapshots", () => {
  it("finds added, lastmod-updated, and removed URLs", () => {
    const previous = snapshot([
      { url: "https://knoww.app/about" },
      {
        url: "https://knoww.app/events/detail/updated",
        lastModified: "2026-08-08T00:00:00.000Z",
      },
      { url: "https://knoww.app/events/detail/removed" },
    ]);
    const current = snapshot([
      { url: "https://knoww.app/about" },
      {
        url: "https://knoww.app/events/detail/updated",
        lastModified: "2026-08-09T00:00:00.000Z",
      },
      { url: "https://knoww.app/guides" },
    ]);

    expect(diffIndexNowSitemapSnapshots(previous, current)).toEqual({
      added: ["https://knoww.app/guides"],
      updated: ["https://knoww.app/events/detail/updated"],
      removed: ["https://knoww.app/events/detail/removed"],
      changed: [
        "https://knoww.app/events/detail/removed",
        "https://knoww.app/events/detail/updated",
        "https://knoww.app/guides",
      ],
    });
  });
});

describe("runIndexNowSitemapCron", () => {
  it("stores a baseline without submitting historical URLs", async () => {
    const { state, values } = createStateStore();
    const submit = vi.fn();

    const result = await runIndexNowSitemapCron({
      state,
      key: "Abcd1234-key",
      fetcher: createFetch([{ url: "https://knoww.app/about" }]),
      submit,
    });

    expect(result).toEqual({
      outcome: "baseline",
      discovered: 1,
      added: 0,
      updated: 0,
      removed: 0,
      submitted: 0,
      batches: 0,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(values.get("indexnow:sitemap-snapshot:v1")).toBe(
      JSON.stringify(snapshot([{ url: "https://knoww.app/about" }]))
    );
  });

  it("submits only changes and advances the snapshot after success", async () => {
    const previous = snapshot([
      { url: "https://knoww.app/about" },
      { url: "https://knoww.app/events/detail/removed" },
    ]);
    const { state, values } = createStateStore(JSON.stringify(previous));
    const submit = vi.fn(async (urls: readonly string[]) => ({
      status: 202,
      submitted: urls.length,
    }));

    const result = await runIndexNowSitemapCron({
      state,
      key: "Abcd1234-key",
      fetcher: createFetch([
        { url: "https://knoww.app/about" },
        { url: "https://knoww.app/guides" },
      ]),
      submit,
    });

    expect(submit).toHaveBeenCalledWith(
      ["https://knoww.app/events/detail/removed", "https://knoww.app/guides"],
      "Abcd1234-key",
      expect.any(Function)
    );
    expect(result).toMatchObject({
      outcome: "submitted",
      discovered: 2,
      added: 1,
      updated: 0,
      removed: 1,
      submitted: 2,
      batches: 1,
    });
    expect(values.get("indexnow:sitemap-snapshot:v1")).toBe(
      JSON.stringify(
        snapshot([
          { url: "https://knoww.app/about" },
          { url: "https://knoww.app/guides" },
        ])
      )
    );
  });

  it("does not rewrite KV when the sitemap is unchanged", async () => {
    const previous = snapshot([{ url: "https://knoww.app/about" }]);
    const { state } = createStateStore(JSON.stringify(previous));
    const submit = vi.fn();

    const result = await runIndexNowSitemapCron({
      state,
      key: "Abcd1234-key",
      fetcher: createFetch([{ url: "https://knoww.app/about" }]),
      submit,
    });

    expect(result).toMatchObject({ outcome: "unchanged", submitted: 0 });
    expect(submit).not.toHaveBeenCalled();
    expect(state.put).not.toHaveBeenCalled();
  });

  it("does not advance the snapshot when IndexNow rejects a batch", async () => {
    const previous = snapshot([{ url: "https://knoww.app/about" }]);
    const serializedPrevious = JSON.stringify(previous);
    const { state, values } = createStateStore(serializedPrevious);

    await expect(
      runIndexNowSitemapCron({
        state,
        key: "Abcd1234-key",
        fetcher: createFetch([
          { url: "https://knoww.app/about" },
          { url: "https://knoww.app/guides" },
        ]),
        submit: vi.fn(async () => {
          throw new Error("IndexNow submission failed (429)");
        }),
      })
    ).rejects.toThrow("IndexNow submission failed (429)");

    expect(values.get("indexnow:sitemap-snapshot:v1")).toBe(serializedPrevious);
  });

  it("fails closed when stored state is malformed", async () => {
    const { state, values } = createStateStore("not-json");
    const submit = vi.fn();

    await expect(
      runIndexNowSitemapCron({
        state,
        key: "Abcd1234-key",
        fetcher: createFetch([{ url: "https://knoww.app/about" }]),
        submit,
      })
    ).rejects.toThrow("IndexNow snapshot is malformed");

    expect(submit).not.toHaveBeenCalled();
    expect(values.get("indexnow:sitemap-snapshot:v1")).toBe("not-json");
  });

  it("rejects foreign sitemap segments without fetching them", async () => {
    const state = createStateStore().state;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://knoww.app/sitemap.xml") {
        return new Response(
          `<sitemapindex><sitemap><loc>https://example.com/private.xml</loc></sitemap></sitemapindex>`,
          { status: 200 }
        );
      }
      throw new Error("Foreign sitemap was fetched");
    }) as typeof fetch;

    await expect(
      runIndexNowSitemapCron({
        state,
        key: "Abcd1234-key",
        fetcher,
        submit: vi.fn(),
      })
    ).rejects.toThrow("Sitemap index contains an invalid segment URL");

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses the Workers-compatible manual redirect mode", async () => {
    const fetcher = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        expect(init?.redirect).toBe("manual");
        const url = input instanceof Request ? input.url : String(input);
        if (url === "https://knoww.app/sitemap.xml") {
          return new Response(INDEX_XML, { status: 200 });
        }
        return new Response(urlSetXml([{ url: "https://knoww.app/about" }]), {
          status: 200,
        });
      }
    ) as typeof fetch;

    await expect(
      runIndexNowSitemapCron({
        state: createStateStore().state,
        key: "Abcd1234-key",
        fetcher,
        submit: vi.fn(),
      })
    ).resolves.toMatchObject({ outcome: "baseline" });
  });

  it("batches protocol submissions at 10,000 URLs", async () => {
    const previous = snapshot([]);
    const { state } = createStateStore(JSON.stringify(previous));
    const entries = Array.from({ length: 10_001 }, (_, index) => ({
      url: `https://knoww.app/events/detail/market-${index}`,
    }));
    const submit = vi.fn(async (urls: readonly string[]) => ({
      status: 202,
      submitted: urls.length,
    }));

    const result = await runIndexNowSitemapCron({
      state,
      key: "Abcd1234-key",
      fetcher: createFetch(entries),
      submit,
    });

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0]).toHaveLength(10_000);
    expect(submit.mock.calls[1]?.[0]).toHaveLength(1);
    expect(result).toMatchObject({ submitted: 10_001, batches: 2 });
  });
});
