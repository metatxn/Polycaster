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

# Configure environment
cp .env.example .env.local
# Add your NEXT_PUBLIC_REOWN_PROJECT_ID
# Add POSTHOG_PROJECT_API_KEY to enable extension analytics ingestion
# Optional: set POSTHOG_HOST for EU Cloud or self-hosted PostHog

# Start development server
pnpm dev
```

Open [http://localhost:8000](http://localhost:8000)

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
pnpm dev          # Development server
pnpm build        # Production build
pnpm lint         # Lint code
pnpm format       # Format code
pnpm type-check   # Type checking
pnpm deploy       # Deploy to Cloudflare
```

## Documentation

- [FLOW_DIAGRAM.md](./FLOW_DIAGRAM.md) - Architecture overview
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
