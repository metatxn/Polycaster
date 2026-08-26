export interface WorkerConfig {
  authMode: "dev-bypass" | "oauth-required";
  canonicalResource: string;
  allowedHostnames: string[];
  allowedOriginHostnames: string[];
}

function splitHostnames(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function workerConfigFromEnv(env: Env): WorkerConfig {
  const canonicalResource = new URL(env.MCP_CANONICAL_RESOURCE);
  if (
    !["http:", "https:"].includes(canonicalResource.protocol) ||
    canonicalResource.pathname !== "/mcp" ||
    canonicalResource.search ||
    canonicalResource.hash
  ) {
    throw new Error("MCP_CANONICAL_RESOURCE must be an HTTP(S) /mcp URL.");
  }
  return {
    // Fail closed: anything but the exact dev marker gets production auth.
    authMode:
      env.MCP_AUTH_MODE === "dev-bypass" ? "dev-bypass" : "oauth-required",
    canonicalResource: canonicalResource.toString(),
    allowedHostnames: splitHostnames(env.MCP_ALLOWED_HOSTNAMES),
    allowedOriginHostnames: splitHostnames(env.MCP_ALLOWED_ORIGIN_HOSTNAMES),
  };
}
