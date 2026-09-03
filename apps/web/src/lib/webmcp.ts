import { createLogger } from "@knoww/logger";

const log = createLogger("webmcp");

export interface WebMcpToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface WebMcpTool<Output = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: WebMcpToolAnnotations;
  execute: (
    input: unknown,
    options?: { signal?: AbortSignal }
  ) => Output | Promise<Output>;
}

interface WebMcpModelContext {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal }
  ) => void | Promise<void>;
}

type WebMcpDocument = Document & {
  modelContext?: WebMcpModelContext;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "WebMCP tool registration failed";
}

/**
 * Registers imperative WebMCP tools for the lifetime of the current page.
 * Unsupported browsers keep the normal human interface unchanged.
 */
export function registerWebMcpTools(
  tools: WebMcpTool[],
  pageDocument?: Document
): () => void {
  const targetDocument =
    pageDocument ?? (typeof document === "undefined" ? undefined : document);
  const modelContext = (targetDocument as WebMcpDocument | undefined)
    ?.modelContext;

  if (typeof modelContext?.registerTool !== "function") {
    return () => undefined;
  }

  const controller = new AbortController();
  void Promise.all(
    tools.map((tool) =>
      Promise.resolve().then(() =>
        modelContext.registerTool(tool, { signal: controller.signal })
      )
    )
  ).catch((error: unknown) => {
    if (controller.signal.aborted) return;

    log.warn("webmcp.registration_failed", {
      message: getErrorMessage(error),
    });
  });

  return () => controller.abort();
}
