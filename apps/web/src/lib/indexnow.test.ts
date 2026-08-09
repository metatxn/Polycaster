import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildIndexNowPayload,
  createIndexNowKeyResponse,
  type IndexNowSubmissionError,
  normalizeIndexNowUrls,
  parseIndexNowCliUrls,
  submitIndexNow,
} from "./indexnow";

describe("parseIndexNowCliUrls", () => {
  it("removes the pnpm argument separator before URL validation", () => {
    expect(parseIndexNowCliUrls(["--", "https://knoww.app/guides"])).toEqual([
      "https://knoww.app/guides",
    ]);
  });

  it("preserves direct Node arguments", () => {
    expect(parseIndexNowCliUrls(["https://knoww.app/guides"])).toEqual([
      "https://knoww.app/guides",
    ]);
  });
});

describe("normalizeIndexNowUrls", () => {
  it("normalizes and deduplicates canonical Knoww URLs", () => {
    expect(
      normalizeIndexNowUrls([
        "https://knoww.app/guides/",
        "https://knoww.app/guides",
        "https://knoww.app/",
      ])
    ).toEqual(["https://knoww.app/guides", "https://knoww.app/"]);
  });

  it.each([
    "http://knoww.app/guides",
    "https://www.knoww.app/guides",
    "https://knoww.app/guides?utm_source=test",
    "https://knoww.app/guides#faq",
    "https://knoww.app/api/events/list",
    "https://knoww.app/_next/static/app.js",
    "https://knoww.app/indexnow-key.txt",
  ])("rejects a non-canonical or non-indexable URL: %s", (url) => {
    expect(() => normalizeIndexNowUrls([url])).toThrow(/IndexNow URL/);
  });

  it("does not echo rejected URL data into errors", () => {
    const rejectedUrl = "https://knoww.app/guides?token=sensitive-value";

    expect(() => normalizeIndexNowUrls([rejectedUrl])).toThrow(
      "Non-canonical IndexNow URL"
    );
    try {
      normalizeIndexNowUrls([rejectedUrl]);
    } catch (error) {
      expect((error as Error).message).not.toContain("sensitive-value");
    }
  });
});

describe("buildIndexNowPayload", () => {
  it("builds the documented batch request shape", () => {
    expect(
      buildIndexNowPayload(
        ["https://knoww.app/guides", "https://knoww.app/about"],
        "Abcd1234-key"
      )
    ).toEqual({
      host: "knoww.app",
      key: "Abcd1234-key",
      keyLocation: "https://knoww.app/indexnow-key.txt",
      urlList: ["https://knoww.app/guides", "https://knoww.app/about"],
    });
  });

  it("rejects invalid keys and batches larger than the protocol limit", () => {
    expect(() => buildIndexNowPayload(["https://knoww.app/"], "short")).toThrow(
      /key/
    );

    const tooManyUrls = Array.from(
      { length: 10_001 },
      (_, index) => `https://knoww.app/guides/page-${index}`
    );
    expect(() => buildIndexNowPayload(tooManyUrls, "Abcd1234-key")).toThrow(
      /10,000/
    );
  });
});

describe("createIndexNowKeyResponse", () => {
  it("serves a valid configured key as UTF-8 plain text", async () => {
    const response = createIndexNowKeyResponse("Abcd1234-key");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("Abcd1234-key");
  });

  it("fails closed when the key is missing or malformed", async () => {
    for (const key of [undefined, "", "short", "not valid key"]) {
      const response = createIndexNowKeyResponse(key);

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Not Found");
    }
  });
});

describe("submitIndexNow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits a deduplicated batch and accepts pending key validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));

    const result = await submitIndexNow(
      ["https://knoww.app/guides/", "https://knoww.app/guides"],
      "Abcd1234-key",
      fetchMock
    );

    expect(result).toEqual({ status: 202, submitted: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.indexnow.org/indexnow",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          host: "knoww.app",
          key: "Abcd1234-key",
          keyLocation: "https://knoww.app/indexnow-key.txt",
          urlList: ["https://knoww.app/guides"],
        }),
      })
    );
  });

  it("reports only the upstream status when submission fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("sensitive upstream detail", { status: 403 })
      );

    await expect(
      submitIndexNow(["https://knoww.app/guides"], "Abcd1234-key", fetchMock)
    ).rejects.toThrow("IndexNow submission failed (403)");
  });

  it("preserves a numeric Retry-After delay for rate-limit handling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("sensitive upstream detail", {
        status: 429,
        headers: { "Retry-After": "7200" },
      })
    );

    const submission = submitIndexNow(
      ["https://knoww.app/guides"],
      "Abcd1234-key",
      fetchMock
    );

    await expect(submission).rejects.toMatchObject({
      name: "IndexNowSubmissionError",
      status: 429,
      retryAfterMs: 7_200_000,
      message: "IndexNow submission failed (429)",
    } satisfies Partial<IndexNowSubmissionError>);
  });

  it("rejects undocumented success statuses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      submitIndexNow(["https://knoww.app/guides"], "Abcd1234-key", fetchMock)
    ).rejects.toThrow("IndexNow submission failed (204)");
  });
});
