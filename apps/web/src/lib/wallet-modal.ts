import { createLogger } from "@knoww/logger";

const log = createLogger("wallet-modal");

let modalPromise: ReturnType<typeof initAppKit> | null = null;

function getAppUrl(): string {
  if (typeof window === "undefined") {
    return "https://knoww.app";
  }
  return window.location.origin;
}

async function initAppKit() {
  const [{ createAppKit }, { networks, projectId, wagmiAdapter }, { polygon }] =
    await Promise.all([
      import("@reown/appkit/react"),
      import("@/config"),
      import("@/lib/chains"),
    ]);

  if (!projectId) {
    throw new Error("Project ID is not defined in wallet-modal");
  }

  return createAppKit({
    adapters: [wagmiAdapter],
    projectId,
    networks,
    defaultNetwork: polygon, // Polymarket trades on Polygon
    allowUnsupportedChain: true,
    metadata: {
      name: "Knoww",
      description: "A prediction market layer for the open internet.",
      url: getAppUrl(), // origin must match the active domain and subdomain
      icons: ["https://avatars.githubusercontent.com/u/179229932"],
    },
    features: {
      analytics: true,
      emailShowWallets: true, // Show other wallets alongside email
    },
  });
}

/**
 * createAppKit boots the whole Reown UI stack (web components, modal views,
 * walletconnect core). At module scope that lands in the shared bundle and
 * executes on every page load; behind this memoized dynamic import only a
 * user's explicit connect/disconnect intent pays the cost. Wagmi account
 * state and session restore do not depend on this — they live on
 * wagmiAdapter.wagmiConfig, which stays eagerly constructed in @/config.
 */
function getModal(): ReturnType<typeof initAppKit> {
  if (!modalPromise) {
    modalPromise = initAppKit().catch((error) => {
      modalPromise = null; // allow retry after a failed chunk load
      throw error;
    });
  }
  return modalPromise;
}

/**
 * Warm the AppKit chunk ahead of a likely open (hover/focus on a connect
 * button) so the first click does not pay the download + boot latency.
 * Failures are ignored here on purpose — openWalletModal retries the load
 * and owns error reporting.
 */
export function preloadWalletModal(): void {
  if (typeof window === "undefined") return;
  void getModal().catch(() => undefined);
}

/**
 * Open the wallet-connect modal, initializing AppKit on first call.
 * Rejects on failure — for callers that drive UI state off the outcome
 * (e.g. the onboarding connect step's error state).
 */
export async function openWalletModalStrict(): Promise<void> {
  if (typeof window === "undefined") return;
  const modal = await getModal();
  await modal.open();
}

/** Fire-and-forget variant for plain buttons: failures are logged, not thrown. */
export async function openWalletModal(): Promise<void> {
  try {
    await openWalletModalStrict();
  } catch (error) {
    log.error("open_failed", { error });
  }
}

/**
 * Close the wallet modal. Intentionally a no-op when AppKit was never
 * initialized — booting the whole stack just to close nothing is wasted work.
 */
export async function closeWalletModal(): Promise<void> {
  if (typeof window === "undefined" || !modalPromise) return;
  try {
    const modal = await getModal();
    await modal.close();
  } catch (error) {
    log.error("close_failed", { error });
  }
}
