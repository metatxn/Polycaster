import { createLogger } from "@knoww/logger";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { cookieStorage, createStorage, http } from "wagmi";
import { polygon } from "@/lib/chains";

const log = createLogger("config");
type AppKitNetwork = typeof polygon;

// Get projectId from https://dashboard.reown.com2
export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!projectId) {
  throw new Error("Project ID is not defined in config");
}

/**
 * Get the best available RPC URL for Polygon
 *
 * SECURITY: On client-side, we use a server-side proxy to hide the Alchemy API key.
 * The proxy forwards requests to Alchemy without exposing the key in network requests.
 */
function getPolygonRpcUrl(): string {
  // Check if we're on the client side
  const isClient = typeof window !== "undefined";

  if (isClient) {
    // On client: Use the proxy to hide API key
    log.debug("rpc.select", { provider: "proxy" });
    return "/api/rpc/polygon";
  }

  // On server (SSR): Use Alchemy directly
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (alchemyKey) {
    log.debug("rpc.select", { provider: "alchemy" });
    return `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  const customRpcUrl = process.env.POLYGON_RPC_URL;
  if (customRpcUrl) {
    return customRpcUrl;
  }

  log.warn("rpc.select", { provider: "public", note: "rate limited" });
  return "https://polygon-rpc.com";
}

// Polymarket trading runs on Polygon. Keep AppKit scoped to Polygon so other
// connected wallet chains do not look like supported trading networks.
export const networks = [polygon] as [AppKitNetwork, ...AppKitNetwork[]];

// Set up the Wagmi Adapter (Config)
// Configure custom transports to use Alchemy for Polygon
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
  transports: {
    [polygon.id]: http(getPolygonRpcUrl()),
  },
});

export const config = wagmiAdapter.wagmiConfig;
