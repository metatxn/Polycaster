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
# Required: NEXT_PUBLIC_REOWN_PROJECT_ID
# Optional: POSTHOG_PROJECT_API_KEY and POSTHOG_HOST for analytics ingestion

# Run the web app
pnpm dev:web
```

Open [http://localhost:8000](http://localhost:8000)

### Extension Development

```bash
# Configure the extension environment if needed
cp apps/extension/.env.example apps/extension/.env

# Run the extension build in watch mode
pnpm dev:ext
```

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
pnpm format         # Format the monorepo
pnpm typecheck      # Type-check all workspace packages
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
