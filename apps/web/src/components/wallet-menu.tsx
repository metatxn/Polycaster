"use client";

import {
  ArrowLeftRight,
  ChevronRight,
  Copy,
  LogOut,
  PieChart,
  Plus,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { formatUnits } from "viem";
import {
  useBalance,
  useConnection,
  useDisconnect,
  useEnsAvatar,
  useEnsName,
  useWalletClient,
} from "wagmi";
import { DepositModal } from "@/components/deposit-modal";
import { PUSD_DECIMALS } from "@/constants/contracts";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { mainnet, polygon } from "@/lib/chains";
import { cn } from "@/lib/utils";
import { openWalletModal } from "@/lib/wallet-modal";
import { requestEoaWalletSwitch } from "@/lib/wallet-switch";

/**
 * Custom dropdown for the connected-wallet account menu — replaces the
 * `@reown/appkit` modal that doesn't fit our editorial system. Pass the
 * existing wallet button as a single child; the component clones it,
 * attaches the open/close handler, and floats the panel beneath.
 *
 * Disconnected state should NOT use this component — the AppKit
 * `open()` modal still owns wallet selection. Render this only when
 * `isConnected && address`.
 */
interface WalletMenuProps {
  children: ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
  /** Anchor side of the floating panel relative to the trigger. */
  align?: "start" | "end";
}

export function WalletMenu({ children, align = "end" }: WalletMenuProps) {
  const [open, setOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click or Escape — only attached while open so we
  // don't leak listeners on every render of an unopened menu.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Clone the trigger child to attach our toggle handler while preserving
  // any existing onClick the caller wired up.
  const trigger = isValidElement(children)
    ? cloneElement(children, {
        onClick: (e: React.MouseEvent) => {
          children.props.onClick?.(e);
          setOpen((prev) => !prev);
        },
      })
    : children;

  return (
    <>
      <div ref={containerRef} className="relative inline-block">
        {trigger}
        {open && (
          <WalletMenuPanel
            align={align}
            onClose={close}
            onOpenDeposit={() => {
              setOpen(false);
              setDepositOpen(true);
            }}
          />
        )}
      </div>
      <DepositModal open={depositOpen} onOpenChange={setDepositOpen} />
    </>
  );
}

interface WalletMenuPanelProps {
  align: "start" | "end";
  onClose: () => void;
  onOpenDeposit: () => void;
}

function WalletMenuPanel({
  align,
  onClose,
  onOpenDeposit,
}: WalletMenuPanelProps) {
  const router = useRouter();
  const { address } = useConnection();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();

  // ENS lookup forces mainnet because Polygon doesn't index ENS. wagmi
  // gracefully returns null when the user has no ENS record set.
  const { data: ensName } = useEnsName({
    address,
    chainId: mainnet.id,
  });
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ?? undefined,
    chainId: mainnet.id,
  });

  // POL balance from the connected EOA on Polygon.
  const { data: polBalance } = useBalance({
    address,
    chainId: polygon.id,
  });

  // pUSD lives on the user's proxy wallet (the trading account), NOT the
  // EOA. Pulling from useProxyWallet keeps this in sync with the trading
  // panel which uses the same hook.
  const {
    proxyAddress,
    usdcBalance: pUsdBalance,
    isEoaMode,
  } = useProxyWallet();

  if (!address) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const handleDisconnect = () => {
    disconnect();
    onClose();
  };

  const handlePortfolio = () => {
    router.push("/portfolio");
    onClose();
  };

  const handleSwitchWallet = async () => {
    onClose();
    try {
      const didOpenEoaWallet = await requestEoaWalletSwitch(walletClient);
      if (!didOpenEoaWallet) {
        await openWalletModal();
      }
    } catch {
      toast.error("Couldn't open wallet switcher");
    }
  };

  return (
    <div
      role="menu"
      aria-label="Wallet menu"
      className={cn(
        "absolute top-[calc(100%+8px)] z-50 w-[300px] max-w-[calc(100vw-24px)]",
        "bg-background border border-border/60 shadow-2xl shadow-black/40",
        "animate-in fade-in slide-in-from-top-1 duration-150",
        align === "end" ? "right-0" : "left-0"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="font-editorial italic font-medium text-[14px] tracking-tight text-foreground">
          Wallet
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/70">
          {ensName ? "ENS" : "EOA"}
        </span>
      </div>

      <Hairline />

      {/* Identity — when ENS is set we show the name as the primary
          identifier and the truncated address as a secondary copy pill;
          without ENS the address itself becomes the copy pill so we
          don't duplicate the same string twice. */}
      <div className="flex items-center gap-3 px-4 py-4">
        <Avatar ensAvatar={ensAvatar ?? null} address={address} />
        <div className="min-w-0 flex-1">
          {ensName ? (
            <>
              <div className="truncate text-[14px] font-semibold text-foreground">
                {ensName}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>{truncate(address)}</span>
                <Copy className="h-3 w-3" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleCopy}
              className="group inline-flex items-center gap-2 text-[14px] font-semibold text-foreground transition-colors"
            >
              <span className="font-mono tabular-nums">
                {truncate(address)}
              </span>
              <Copy className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-foreground" />
            </button>
          )}
        </div>
      </div>

      <Hairline />

      {/* Balances */}
      <div className="px-4 py-3 space-y-2.5">
        <BalanceRow
          label="POL"
          value={
            polBalance
              ? formatBalance(polBalance.value, polBalance.decimals, 4)
              : "—"
          }
        />
        <BalanceRow
          label="PUSD"
          value={formatBalance(
            pUsdBalance
              ? BigInt(Math.round(pUsdBalance * 10 ** PUSD_DECIMALS))
              : BigInt(0),
            PUSD_DECIMALS,
            2
          )}
          sublabel={
            proxyAddress
              ? isEoaMode
                ? "Connected wallet"
                : "Trading wallet"
              : null
          }
        />
      </div>

      <Hairline />

      {/* Actions */}
      <div className="py-1">
        <ActionRow
          icon={<Plus className="h-4 w-4" />}
          label="Deposit"
          onClick={onOpenDeposit}
        />
        <ActionRow
          icon={<PieChart className="h-4 w-4" />}
          label="Portfolio"
          onClick={handlePortfolio}
        />
        <ActionRow
          icon={<ArrowLeftRight className="h-4 w-4" />}
          label="Switch wallet"
          onClick={handleSwitchWallet}
        />
      </div>

      <Hairline />

      <div className="py-1">
        <ActionRow
          icon={<LogOut className="h-4 w-4" />}
          label="Disconnect"
          onClick={handleDisconnect}
        />
      </div>

      <Hairline />

      {/* Footer */}
      <div className="px-4 py-2.5 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/50">
        <span>Polygon</span>
        <span>Mainnet</span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-pieces
// -----------------------------------------------------------------------------

function Hairline() {
  return (
    <div
      aria-hidden="true"
      className="h-px bg-linear-to-r from-transparent via-border/60 to-transparent"
    />
  );
}

function Avatar({
  ensAvatar,
  address,
}: {
  ensAvatar: string | null;
  address: string;
}) {
  if (ensAvatar) {
    return (
      <Image
        src={ensAvatar}
        alt=""
        width={36}
        height={36}
        className="shrink-0 select-none"
        unoptimized
      />
    );
  }
  // Fall back to the K-mark logo so the menu's identity surface still
  // carries the brand even when the user has no ENS.
  return (
    <Image
      src="/logo-256x256.png"
      alt=""
      width={36}
      height={36}
      className="shrink-0 select-none"
      title={address}
      unoptimized
    />
  );
}

function BalanceRow({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex flex-col">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        {sublabel ? (
          <span className="text-[10px] text-muted-foreground/60">
            {sublabel}
          </span>
        ) : null}
      </div>
      <span className="font-mono text-[16px] font-medium tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-[14px] text-foreground">{label}</span>
      <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
    </button>
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** `0xE5...0F69Dc` */
function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Format a wei-style bigint into a human-readable decimal string with
 * tabular-friendly trailing zeros. We always show `precision` decimals so
 * the column doesn't jitter as values update.
 */
function formatBalance(
  raw: bigint,
  decimals: number,
  precision: number
): string {
  const formatted = formatUnits(raw, decimals);
  const num = Number(formatted);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}
