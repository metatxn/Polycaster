import type {
  BuilderConfig,
  BuilderHeaderPayload,
  BuilderType,
  RemoteBuilderConfig as RemoteBuilderConfigOptions,
} from "@polymarket/builder-signing-sdk";

/**
 * Browser-safe drop-in replacement for the SDK's BuilderConfig.
 *
 * The official BuilderConfig imports node:crypto (for local HMAC signing),
 * which breaks client-side Next.js builds. This class provides the same
 * public interface but only supports the REMOTE signing path — delegating
 * header generation to the /api/sign proxy via fetch().
 *
 * Because BuilderConfig has private members, TypeScript won't allow
 * `implements BuilderConfig`. We use a factory function that returns a
 * typed `BuilderConfig` so the cast lives in exactly one place.
 *
 * Type-only imports ensure no node:crypto code is pulled into the bundle.
 */
class RemoteBuilderConfig {
  readonly remoteBuilderConfig: RemoteBuilderConfigOptions;
  readonly localBuilderCreds = undefined;
  readonly signer = undefined;

  constructor(config: RemoteBuilderConfigOptions) {
    const url = config.url?.trim();
    if (!url || !(url.startsWith("http://") || url.startsWith("https://"))) {
      throw new Error("invalid remote url!");
    }
    if (config.token !== undefined && config.token.length === 0) {
      throw new Error("invalid auth token");
    }
    this.remoteBuilderConfig = config;
  }

  isValid(): boolean {
    return true;
  }

  getBuilderType(): BuilderType {
    return "REMOTE" as BuilderType;
  }

  async generateBuilderHeaders(
    method: string,
    path: string,
    body?: string,
    timestamp?: number
  ): Promise<BuilderHeaderPayload | undefined> {
    try {
      const response = await fetch(this.remoteBuilderConfig.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.remoteBuilderConfig.token
            ? { Authorization: `Bearer ${this.remoteBuilderConfig.token}` }
            : {}),
        },
        body: JSON.stringify({ method, path, body, timestamp }),
      });

      if (!response.ok) {
        console.error(
          "[RemoteBuilderConfig] signing proxy returned",
          response.status
        );
        return undefined;
      }

      return (await response.json()) as BuilderHeaderPayload;
    } catch (err) {
      console.error("[RemoteBuilderConfig] Failed to generate headers:", err);
      return undefined;
    }
  }
}

/**
 * Create a BuilderConfig that delegates signing to the remote proxy.
 *
 * The single `as unknown as BuilderConfig` cast is confined here so every
 * consumer receives a properly typed BuilderConfig with no casts needed.
 */
export function createBuilderConfig(
  config: RemoteBuilderConfigOptions
): BuilderConfig {
  return new RemoteBuilderConfig(config) as unknown as BuilderConfig;
}
