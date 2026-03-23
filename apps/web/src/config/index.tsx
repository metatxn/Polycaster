import {
  type AppKitNetwork,
  arbitrum,
  mainnet,
  polygon,
  polygonAmoy,
} from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { cookieStorage, createStorage, http } from "wagmi";

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
    console.log("[Config] Using RPC proxy for Polygon (API key hidden)");
    return "/api/rpc/polygon";
  }

  // On server (SSR): Use Alchemy directly
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (alchemyKey) {
    console.log("[Config] Using Alchemy RPC for Polygon (server-side)");
    return `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  const customRpcUrl = process.env.POLYGON_RPC_URL;
  if (customRpcUrl) {
    //console.log("[Config] Using custom RPC for Polygon:", customRpcUrl);
    return customRpcUrl;
  }

  console.warn("[Config] Using public Polygon RPC (rate limited)");
  return "https://polygon-rpc.com";
}

// Set up the networks you want to support
// Using Polygon since Polymarket runs on Polygon
export const networks = [polygon, mainnet, arbitrum, polygonAmoy] as [
  AppKitNetwork,
  ...AppKitNetwork[],
];

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
    [polygonAmoy.id]: http("https://rpc-amoy.polygon.technology/"),
  },
});

export const config = wagmiAdapter.wagmiConfig;
