export const TRUSTED_CLIENT_IP_HEADER = "x-knoww-client-ip";

type RequestWithCloudflareMetadata = Request & { readonly cf?: unknown };

/** Stamp the edge-derived client identity before handing off to OpenNext. */
export function withTrustedClientIp(request: Request): Request {
  const headers = new Headers(request.headers);
  const clientIp = (request as RequestWithCloudflareMetadata).cf
    ? request.headers.get("cf-connecting-ip")?.trim()
    : undefined;

  if (clientIp) headers.set(TRUSTED_CLIENT_IP_HEADER, clientIp);
  else headers.delete(TRUSTED_CLIENT_IP_HEADER);

  return new Request(request, { headers });
}

/** Read only the identity stamped by the Worker entrypoint. */
export function readTrustedClientIp(request: Pick<Request, "headers">): string {
  return request.headers.get(TRUSTED_CLIENT_IP_HEADER)?.trim() || "anonymous";
}
