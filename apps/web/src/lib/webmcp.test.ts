import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWebMcpTools, type WebMcpTool } from "./webmcp";

const logger = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("@knoww/logger", () => ({
  createLogger: () => logger,
}));

afterEach(() => {
  logger.warn.mockClear();
});

describe("registerWebMcpTools", () => {
  it("registers tools with one shared lifetime signal", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const pageDocument = {
      modelContext: { registerTool },
    } as unknown as Document;
    const tools: WebMcpTool[] = [
      {
        name: "read_page",
        description: "Read the page.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: () => ({ ok: true }),
      },
      {
        name: "change_view",
        description: "Change the visible page state.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: () => ({ ok: true }),
      },
    ];

    const unregister = registerWebMcpTools(tools, pageDocument);

    await vi.waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    const firstOptions = registerTool.mock.calls[0]?.[1];
    const secondOptions = registerTool.mock.calls[1]?.[1];
    expect(firstOptions.signal).toBe(secondOptions.signal);
    expect(firstOptions.signal.aborted).toBe(false);

    unregister();

    expect(firstOptions.signal.aborted).toBe(true);
  });

  it("is a no-op when the browser does not support WebMCP", () => {
    const pageDocument = {} as Document;

    expect(() => registerWebMcpTools([], pageDocument)()).not.toThrow();
  });

  it("does not warn when cleanup cancels a pending registration", async () => {
    const registerTool = vi.fn(
      (_tool: WebMcpTool, options?: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(undefined), {
            once: true,
          });
        })
    );
    const pageDocument = {
      modelContext: { registerTool },
    } as unknown as Document;
    const unregister = registerWebMcpTools(
      [
        {
          name: "read_page",
          description: "Read the page.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          execute: () => ({ ok: true }),
        },
      ],
      pageDocument
    );

    await vi.waitFor(() => expect(registerTool).toHaveBeenCalledOnce());
    unregister();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
