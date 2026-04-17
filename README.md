# Knoww

A prediction markets platform to **Know your Odds**, powered by Polymarket.

## Features

- Real-time market data from Polymarket
- Multi-wallet support via Reown AppKit
- Browse by categories: Politics, Sports, Finance, Crypto
- Event and market detail views with price charts
- Edge deployment on Cloudflare Workers

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- [Reown Cloud Project ID](https://cloud.reown.com/)

### Setup

```bash
# Install dependencies
pnpm install

# Configure the web app environment
$EDITOR apps/web/.env.local
# Required: NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
# Optional client analytics: NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN and NEXT_PUBLIC_POSTHOG_HOST
# Optional server analytics: POSTHOG_PROJECT_API_KEY and POSTHOG_HOST

# Run the web app
pnpm dev:web
```

Open [http://localhost:8000](http://localhost:8000)

For full local parity with production-only features, the web app also reads server-side variables such as `OPENROUTER_API_KEY`, `EXTENSION_SESSION_SECRET`, `BUILDER_SIGNING_SERVER_URL`, `INTERNAL_AUTH_TOKEN`, `ALCHEMY_API_KEY`, and `POLYGON_RPC_URL`.

### Extension Development

```bash
# Configure the extension environment if needed
cp apps/extension/.env.example apps/extension/.env

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

```bash
pnpm dev:web        # Run the Next.js web app on port 8000
pnpm dev:ext        # Run the extension build in watch mode
pnpm build          # Build all workspace packages
pnpm build:web      # Build the web app only
pnpm build:ext      # Build the extension only
pnpm preview        # Preview the Cloudflare web deployment locally
pnpm lint           # Lint the monorepo
pnpm lint:web       # Lint the web app only
pnpm lint:ext       # Lint the extension only
pnpm format         # Format the monorepo
pnpm typecheck      # Type-check all workspace packages
pnpm typecheck:web  # Type-check the web app only
pnpm typecheck:ext  # Type-check the extension only
pnpm audit:security # Run a high-severity dependency audit
pnpm deploy         # Deploy the web app to Cloudflare
pnpm release:ext    # Bump, build, and zip the extension release
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
