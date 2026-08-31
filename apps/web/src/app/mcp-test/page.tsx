import { ArrowLeft, BookOpen, FlaskConical, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KnowwMark } from "@/components/knoww-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { McpIntegrationGuide } from "./mcp-integration-guide";
import { McpTestClient } from "./mcp-test-client";

export const metadata: Metadata = {
  title: "MCP API explorer and integration guide",
  description:
    "Explore every Knoww MCP tool, test OAuth, and follow the complete product integration guide.",
};

export default function McpTestPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              aria-label="Knoww home"
              className="rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <KnowwMark />
            </Link>
            <span className="h-5 w-px bg-border" aria-hidden="true" />
            <span className="font-mono text-sm font-semibold">
              MCP API explorer
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Knoww
        </Link>
        <div className="mb-10 max-w-4xl">
          <p className="ui-label mb-3">Developer documentation</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Knoww MCP API explorer
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            Authorize the production server or connect to a local Worker, test
            every read-only market tool, and use the integration guide to add
            Knoww MCP to your product.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5">
              <FlaskConical
                className="size-3.5 text-primary"
                aria-hidden="true"
              />
              20 testable tools
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5">
              <ShieldCheck
                className="size-3.5 text-primary"
                aria-hidden="true"
              />
              OAuth 2.1 + PKCE
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5">
              <BookOpen className="size-3.5 text-primary" aria-hidden="true" />
              Streamable HTTP
            </span>
          </div>
        </div>

        <nav
          aria-label="MCP page sections"
          className="mb-8 overflow-x-auto border-y"
        >
          <div className="flex min-w-max gap-6 py-3 text-sm font-medium">
            <a href="#explorer" className="hover:text-primary">
              Explorer
            </a>
            <a href="#connect" className="hover:text-primary">
              Connect
            </a>
            <a href="#authentication" className="hover:text-primary">
              Authentication
            </a>
            <a href="#product-integration" className="hover:text-primary">
              Product integration
            </a>
            <a href="#local-development" className="hover:text-primary">
              Local development
            </a>
            <a href="#reference" className="hover:text-primary">
              Reference
            </a>
          </div>
        </nav>

        <section
          id="explorer"
          className="scroll-mt-24"
          aria-labelledby="explorer-heading"
        >
          <div className="mb-6 max-w-3xl">
            <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
              Interactive explorer
            </p>
            <h2
              id="explorer-heading"
              className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Test every MCP tool
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              The operation list mirrors an OpenAPI explorer. Connect once,
              expand a tool, edit its JSON arguments, and inspect the complete
              JSON-RPC response.
            </p>
          </div>
          <McpTestClient />
        </section>

        <div className="my-16 border-t" />
        <McpIntegrationGuide />
      </main>
    </div>
  );
}
