import type { NextRequest } from "next/server";

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: string };

function getContentLength(request: NextRequest): number | null {
  const header = request.headers.get("content-length");
  if (!header) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readBodyWithLimit(
  request: NextRequest,
  maxBytes: number
): Promise<string | null> {
  const body = request.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

export async function readJsonBodyWithLimit(
  request: NextRequest,
  maxBytes: number
): Promise<JsonBodyResult> {
  const contentLength = getContentLength(request);
  if (contentLength !== null && contentLength > maxBytes) {
    return { ok: false, status: 413, error: "Request body too large" };
  }

  const rawBody = await readBodyWithLimit(request, maxBytes);
  if (rawBody === null) {
    return { ok: false, status: 413, error: "Request body too large" };
  }

  try {
    return { ok: true, body: JSON.parse(rawBody) };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON payload" };
  }
}
