export interface LeaderboardTrader {
  rank: string;
  proxyWallet: string;
  userName: string | null;
  vol: number;
  pnl: number;
  profileImage: string | null;
  xUsername: string | null;
  verifiedBadge: boolean;
}

export interface TraderXProfile {
  handle: string;
  proxyWallet: string;
  userName: string | null;
  pnl: number;
  vol: number;
  rank: string;
  profileImage: string | null;
  verifiedBadge: boolean;
}

const X_HANDLE_RE = /^[a-zA-Z0-9_]{1,15}$/;
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function normalizeXHandle(
  value: string | null | undefined
): string | null {
  const handle = String(value ?? "")
    .trim()
    .replace(/^@+/, "");
  if (!X_HANDLE_RE.test(handle)) return null;
  return handle.toLowerCase();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeLeaderboardTrader(
  value: unknown
): LeaderboardTrader | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<LeaderboardTrader>;
  if (typeof record.rank !== "string") return null;
  if (
    typeof record.proxyWallet !== "string" ||
    !ETH_ADDRESS_RE.test(record.proxyWallet)
  ) {
    return null;
  }
  if (!isFiniteNumber(record.pnl) || !isFiniteNumber(record.vol)) return null;

  return {
    rank: record.rank,
    proxyWallet: record.proxyWallet,
    userName: typeof record.userName === "string" ? record.userName : null,
    vol: record.vol,
    pnl: record.pnl,
    profileImage:
      typeof record.profileImage === "string" && record.profileImage
        ? record.profileImage
        : null,
    xUsername: typeof record.xUsername === "string" ? record.xUsername : null,
    verifiedBadge: record.verifiedBadge === true,
  };
}

export function buildTraderXProfileIndex(
  traders: unknown[]
): Map<string, TraderXProfile> {
  const index = new Map<string, TraderXProfile>();

  for (const rawTrader of traders) {
    const trader = normalizeLeaderboardTrader(rawTrader);
    const handle = normalizeXHandle(trader?.xUsername);
    if (!trader || !handle) continue;

    if (index.has(handle)) continue;

    index.set(handle, {
      handle,
      proxyWallet: trader.proxyWallet,
      userName: trader.userName,
      pnl: trader.pnl,
      vol: trader.vol,
      rank: trader.rank,
      profileImage: trader.profileImage,
      verifiedBadge: trader.verifiedBadge,
    });
  }

  return index;
}
