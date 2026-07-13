# Knoww

A prediction markets platform to **Know your Odds**, powered by Polymarket.

## Features

- Real-time market data from Polymarket
- Multi-wallet support via Reown AppKit
- Browse by categories: Politics, Sports, Finance, Crypto
- Event and market detail views with price charts
- Internal paper-trading agent dashboard and admin APIs
- Edge deployment on Cloudflare Workers

## Quick Start

### Prerequisites

- Node.js 20.19+ (or 22.x)
- pnpm
- [Reown Cloud Project ID](https://cloud.reown.com/)

If you plan to work on `apps/agent`, use a current Node.js release that supports `node --experimental-strip-types` for that package's test script.

### Setup

```bash
# Install dependencies
pnpm install

# Seed the Next.js environment file used by `pnpm dev:web`
cp apps/web/.env.local.example apps/web/.env.local

# Seed the Wrangler/Worker environment file used by `pnpm preview`
# and by local Cloudflare-style bindings such as D1/cron vars
cp apps/web/.dev.vars.example apps/web/.dev.vars

# Add required local variables
$EDITOR apps/web/.env.local
# Add Worker/runtime variables when you need preview mode, agent admin flows,
# or parity with Cloudflare bindings
$EDITOR apps/web/.dev.vars
# Required beyond the example file:
# NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
#
# The example file already includes:
# NEXT_PUBLIC_POLY_BUILDER_CODE
# NEXT_PUBLIC_POLYMARKET_HOST
# NEXT_PUBLIC_POLYMARKET_WS_HOST
# NEXT_PUBLIC_POLYMARKET_CHAIN_ID
# POLY_RELAYER_API_KEY
# POLY_RELAYER_API_KEY_ADDRESS
#
# Common optional vars for local parity:
# NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
# NEXT_PUBLIC_POSTHOG_HOST, POSTHOG_PROJECT_API_KEY, POSTHOG_HOST,
# OPENROUTER_API_KEY, EXTENSION_SESSION_SECRET,
# BUILDER_SIGNING_SERVER_URL, INTERNAL_AUTH_TOKEN,
# ALCHEMY_API_KEY, POLYGON_RPC_URL, COINMARKET_API_KEY

# Run the web app
pnpm dev:web
```

Open [http://localhost:8000](http://localhost:8000)

`pnpm dev:web` reads `apps/web/.env.local`. `pnpm preview` and the Cloudflare Worker runtime read `apps/web/.dev.vars`, which is also where local D1/agent cron settings belong.

### Extension Development

```bash
# Configure the extension environment
cp apps/extension/.env.example apps/extension/.env

# Optional overrides:
# DEV_MODE=false        # point the built extension at production
# POLY_BUILDER_CODE=... # builder attribution code for extension orders
# WALLETCONNECT_PROJECT_ID=... # required for WalletConnect/mobile wallet QR flows

# Run the web app locally for extension API calls
pnpm dev:web

# In a second terminal, run the extension build in watch mode
pnpm dev:ext
```

In development, the extension targets `http://localhost:8000` by default. Use `DEV_MODE=false` in `apps/extension/.env` if you want the built extension to talk to production instead.

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 15 (App Router) |
| Wallet | Reown AppKit, Wagmi, Viem |
| Data | TanStack Query |
| UI | Shadcn, Tailwind CSS v4, Framer Motion |
| Tooling | BiomeJS, TypeScript |
| Deployment | Cloudflare Workers |

## Scripts

Root workspace scripts:

```bash
pnpm dev:web        # Run the Next.js web app on port 8000
pnpm dev:ext        # Run the extension build in watch mode
pnpm build          # Build all workspace packages
pnpm build:web      # Build the web app only
pnpm build:ext      # Build the extension only
pnpm build:ext:dev  # Build the extension once in development mode
pnpm test           # Run workspace tests where defined
pnpm preview        # Preview the Cloudflare web deployment locally
pnpm lint           # Lint the monorepo
pnpm lint:web       # Lint the web app only
pnpm lint:ext       # Lint the extension only
pnpm format         # Format the monorepo
pnpm typecheck      # Type-check all workspace packages
pnpm typecheck:web  # Type-check the web app only
pnpm typecheck:ext  # Type-check the extension only
pnpm audit:security # Run a high-severity dependency audit
pnpm brand:render   # Render the brand mark asset
pnpm deploy         # Deploy the web app to Cloudflare
pnpm prepare        # Install Husky hooks
pnpm release:ext    # Bump, build, and zip the extension release
```

Package-level scripts live in the workspace packages:

- `apps/web/package.json`: `dev:turbo`, `start`, `soak`, `soak:assert`, `cf-typegen`, `agent:d1:list:local`, `agent:d1:adopt-runtime-schema:local`, `agent:d1:adopt-runtime-schema:remote`, `agent:d1:migrate:local`, `agent:d1:migrate:remote`, `test`, `test:node`, `test:watch`, `test:coverage`, `test:e2e`
- `apps/extension/package.json`: `clean`, `test`, `test:scoring`, `benchmark:embeddings`, `format`, `version:bump`, `zip`, `release`
- `apps/agent/package.json`: `build`, `typecheck`, `lint`, `format`, `test`

Common test commands:

```bash
pnpm --filter @knoww/web test           # Web Vitest suite + node-based tests
pnpm --filter @knoww/web test:watch     # Web Vitest watch mode
pnpm --filter @knoww/web test:coverage  # Web coverage run
pnpm --filter @knoww/web test:e2e       # Web Playwright smoke test
pnpm --filter @knoww/extension test     # Extension scoring tests
pnpm --filter @knoww/agent test         # Agent node tests
```

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Architecture overview
- [docs/API.md](./docs/API.md) - API route reference
- [Polymarket Docs](https://docs.polymarket.com/)
- [Reown Docs](https://docs.reown.com/)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run `pnpm lint` before submitting
4. Open a pull request

## License

AGPL-3.0

---

Built by [Soclly](https://github.com/soclly)
