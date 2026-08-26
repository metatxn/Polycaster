export const MAX_MCP_BODY_BYTES = 1024 * 1024;
export const MAX_OAUTH_REGISTRATION_BODY_BYTES = 1024 * 1024;
export const MAX_OAUTH_TOKEN_BODY_BYTES = 64 * 1024;

interface BodyLimit {
  bytes: number;
  label: string;
  responseKind: "mcp" | "oauth";
}

function bodyLimitFor(request: Request): BodyLimit | null {
  if (request.method !== "POST" || !request.body) return null;
  switch (new URL(request.url).pathname) {
    case "/mcp":
      return {
        bytes: MAX_MCP_BODY_BYTES,
        label: "1 MiB",
        responseKind: "mcp",
      };
    case "/oauth/register":
      return {
        bytes: MAX_OAUTH_REGISTRATION_BODY_BYTES,
        label: "1 MiB",
        responseKind: "oauth",
      };
    case "/oauth/token":
      return {
        bytes: MAX_OAUTH_TOKEN_BODY_BYTES,
        label: "64 KiB",
        responseKind: "oauth",
      };
    default:
      return null;
  }
}

function payloadTooLarge(limit: BodyLimit, requestId: string): Response {
  if (limit.responseKind === "oauth") {
    return Response.json(
      {
        error: "invalid_request",
        error_description: `Request body exceeds ${limit.label}.`,
      },
      {
        status: 413,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      }
    );
  }
  return Response.json(
    {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: `MCP request body exceeds ${limit.label}.`,
        requestId,
      },
    },
    {
      status: 413,
      headers: { "cache-control": "no-store" },
    }
  );
}

export async function boundPublicRequestBody(
  request: Request,
  requestId: string
): Promise<Request | Response> {
  const limit = bodyLimitFor(request);
  if (!limit) return request;
  const requestBody = request.body;
  if (!requestBody) return request;

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > limit.bytes
  ) {
    await requestBody.cancel();
    return payloadTooLarge(limit, requestId);
  }

  const reader = requestBody.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit.bytes) {
      await reader.cancel();
      return payloadTooLarge(limit, requestId);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request, { body, headers });
}
