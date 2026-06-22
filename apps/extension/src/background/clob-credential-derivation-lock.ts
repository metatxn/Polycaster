type CredentialDerivationLock = {
  token: string;
  expiresAtMs: number;
  ownerTabId?: number;
};

export const CLOB_CREDENTIAL_DERIVATION_LOCK_TTL_MS = 24 * 60 * 60 * 1000;

export type CredentialDerivationBeginResult =
  | { status: "claimed"; token: string }
  | { status: "busy" };
export type CredentialDerivationBeginWithPresenceResult =
  | { status: "present" }
  | CredentialDerivationBeginResult;

export type CredentialDerivationStatus =
  | { status: "busy" }
  | { status: "idle" };

const activeDerivations = new Map<string, CredentialDerivationLock>();

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function createToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getActiveDerivation(address: string): CredentialDerivationLock | null {
  const key = normalizeAddress(address);
  const active = activeDerivations.get(key);
  if (!active) return null;

  if (active.expiresAtMs <= Date.now()) {
    activeDerivations.delete(key);
    return null;
  }

  return active;
}

export function beginClobCredentialDerivation(
  address: string,
  options: { ownerTabId?: number } = {}
): CredentialDerivationBeginResult {
  const key = normalizeAddress(address);
  if (getActiveDerivation(address)) return { status: "busy" };

  const token = createToken();
  activeDerivations.set(key, {
    token,
    expiresAtMs: Date.now() + CLOB_CREDENTIAL_DERIVATION_LOCK_TTL_MS,
    ownerTabId: options.ownerTabId,
  });
  return { status: "claimed", token };
}

export async function resolveClobCredentialDerivationBegin(
  address: string,
  options: {
    hasCredentials: () => Promise<boolean>;
    ownerTabId?: number;
  }
): Promise<CredentialDerivationBeginWithPresenceResult> {
  return (await options.hasCredentials())
    ? { status: "present" }
    : beginClobCredentialDerivation(address, {
        ownerTabId: options.ownerTabId,
      });
}

export function getClobCredentialDerivationStatus(
  address: string
): CredentialDerivationStatus {
  return getActiveDerivation(address) ? { status: "busy" } : { status: "idle" };
}

export function endClobCredentialDerivation(
  address: string,
  token: string
): boolean {
  const key = normalizeAddress(address);
  const active = getActiveDerivation(address);
  if (!active || active.token !== token) return false;
  activeDerivations.delete(key);
  return true;
}

export function clearClobCredentialDerivationsForTab(tabId: number): number {
  let released = 0;
  for (const [key, active] of activeDerivations) {
    if (active.expiresAtMs <= Date.now() || active.ownerTabId === tabId) {
      activeDerivations.delete(key);
      released += 1;
    }
  }
  return released;
}
