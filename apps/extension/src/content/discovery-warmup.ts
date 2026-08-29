export type DiscoveryWarmupTarget = "scoring" | "tags";

interface DiscoveryWarmupOptions {
  isHidden(): boolean;
  onError?: (target: DiscoveryWarmupTarget, error: unknown) => void;
  warmScoring(): Promise<unknown>;
  warmTags?: () => Promise<unknown>;
}

function startBackgroundWarmup(
  target: DiscoveryWarmupTarget,
  warm: () => Promise<unknown>,
  onError?: DiscoveryWarmupOptions["onError"]
): void {
  void warm().catch((error: unknown) => {
    onError?.(target, error);
  });
}

export function startDiscoveryWarmup({
  isHidden,
  onError,
  warmScoring,
  warmTags,
}: DiscoveryWarmupOptions): void {
  if (isHidden()) return;

  if (warmTags) {
    startBackgroundWarmup("tags", warmTags, onError);
  }
  startBackgroundWarmup("scoring", warmScoring, onError);
}
