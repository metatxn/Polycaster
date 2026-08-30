import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KnowwMark } from "@/components/knoww-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { McpTestClient } from "./mcp-test-client";

export const metadata: Metadata = {
  title: "MCP test console | Knoww",
  description: "A local console for testing the Knoww MCP server.",
  robots: { index: false, follow: false },
};

export default function McpTestPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
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
            <span className="font-mono text-sm font-semibold">MCP console</span>
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
        <div className="mb-8 max-w-2xl">
          <p className="ui-label mb-3">Developer tool</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Test the Knoww MCP server
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Connect to a local Streamable HTTP endpoint, inspect its tools, and
            send a call without leaving the browser.
          </p>
        </div>
        <McpTestClient />
      </main>
    </div>
  );
}
