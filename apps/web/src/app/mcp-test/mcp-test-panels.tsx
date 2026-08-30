import { CheckCircle2, LoaderCircle, Play, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MCP_PROTOCOL_VERSION, type McpTool } from "./mcp-client";

interface ConnectionPanelProps {
  argumentsJson: string;
  busy: "connect" | "call" | null;
  endpoint: string;
  error: string;
  onArgumentsChange: (value: string) => void;
  onConnect: () => void;
  onEndpointChange: (value: string) => void;
  onRunTool: () => void;
  onToolChange: (name: string) => void;
  selectedTool?: McpTool;
  selectedToolName: string;
  status: string;
  tools: McpTool[];
}

export function ConnectionPanel({
  argumentsJson,
  busy,
  endpoint,
  error,
  onArgumentsChange,
  onConnect,
  onEndpointChange,
  onRunTool,
  onToolChange,
  selectedTool,
  selectedToolName,
  status,
  tools,
}: ConnectionPanelProps) {
  return (
    <section className="flex flex-col border-b lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
      <div className="border-b px-5 py-5 sm:px-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <PlugZap className="size-4" aria-hidden="true" />
          Connection
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Built for the local dev-bypass server. No credentials are stored.
        </p>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="space-y-2">
          <label htmlFor="mcp-endpoint" className="ui-label-strong">
            MCP endpoint
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="mcp-endpoint"
              value={endpoint}
              onChange={(event) => onEndpointChange(event.target.value)}
              spellCheck={false}
              className="font-mono"
            />
            <Button
              type="button"
              onClick={onConnect}
              disabled={busy !== null}
              className="sm:w-28"
            >
              {busy === "connect" ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <PlugZap aria-hidden="true" />
              )}
              {busy === "connect" ? "Connecting" : "Connect"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="mcp-tool" className="ui-label-strong">
            Tool
          </label>
          <select
            id="mcp-tool"
            value={selectedToolName}
            onChange={(event) => onToolChange(event.target.value)}
            disabled={tools.length === 0 || busy !== null}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {tools.length === 0 && <option value="">Connect first</option>}
            {tools.map((tool) => (
              <option key={tool.name} value={tool.name}>
                {tool.name}
              </option>
            ))}
          </select>
          {selectedTool?.description && (
            <p className="text-sm leading-6 text-muted-foreground">
              {selectedTool.description}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="mcp-arguments" className="ui-label-strong">
            Arguments as JSON
          </label>
          <Textarea
            id="mcp-arguments"
            aria-label="Arguments as JSON"
            value={argumentsJson}
            onChange={(event) => onArgumentsChange(event.target.value)}
            disabled={tools.length === 0 || busy !== null}
            spellCheck={false}
            className="min-h-40 resize-y font-mono leading-6"
          />
        </div>

        <Button
          type="button"
          onClick={onRunTool}
          disabled={!selectedToolName || busy !== null}
          className="w-full"
        >
          {busy === "call" ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
          {busy === "call" ? "Running" : "Run tool"}
        </Button>

        <div
          role="status"
          aria-live="polite"
          className="flex min-h-6 items-start gap-2 text-sm text-muted-foreground"
        >
          {tools.length > 0 && (
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0 text-foreground"
              aria-hidden="true"
            />
          )}
          <span>{status}</span>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

export function ResponsePanel({ output }: { output: string }) {
  return (
    <section
      aria-labelledby="mcp-response-heading"
      className="flex h-96 flex-col overflow-hidden bg-muted/20 lg:h-auto lg:min-h-0"
    >
      <div className="flex items-center justify-between border-b px-5 py-5 sm:px-6">
        <div>
          <h2 id="mcp-response-heading" className="text-sm font-semibold">
            Response
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Raw JSON-RPC output
          </p>
        </div>
        <span className="rounded border bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
          {MCP_PROTOCOL_VERSION}
        </span>
      </div>
      <section
        aria-label="Response output"
        className="min-h-0 flex-1 overflow-auto"
      >
        <pre className="p-5 font-mono text-xs leading-6 whitespace-pre-wrap break-words sm:p-6">
          {output || "Connect to inspect the server's tool catalog."}
        </pre>
      </section>
    </section>
  );
}
