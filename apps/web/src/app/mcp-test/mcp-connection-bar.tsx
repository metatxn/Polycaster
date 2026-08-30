import { CircleCheck, LoaderCircle, PlugZap, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MCP_PROTOCOL_VERSION } from "./mcp-client";

interface McpConnectionBarProps {
  busy: boolean;
  connected: boolean;
  endpoint: string;
  onConnect: () => void;
  onEndpointChange: (value: string) => void;
  status: string;
}

export function McpConnectionBar({
  busy,
  connected,
  endpoint,
  onConnect,
  onEndpointChange,
  status,
}: McpConnectionBarProps) {
  return (
    <section
      aria-labelledby="mcp-server-heading"
      className="rounded-md border bg-card"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <label
            id="mcp-server-heading"
            htmlFor="mcp-endpoint"
            className="text-sm font-semibold"
          >
            Server
          </label>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the local Worker for dev bypass or the production URL with
            OAuth.
          </p>
          <Input
            id="mcp-endpoint"
            value={endpoint}
            onChange={(event) => onEndpointChange(event.target.value)}
            spellCheck={false}
            className="mt-3 font-mono"
          />
        </div>
        <Button
          type="button"
          onClick={onConnect}
          disabled={busy}
          className="lg:w-32"
        >
          {busy ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : connected ? (
            <CircleCheck aria-hidden="true" />
          ) : (
            <PlugZap aria-hidden="true" />
          )}
          {busy ? "Connecting" : connected ? "Reconnect" : "Connect"}
        </Button>
      </div>

      <div className="grid border-t bg-muted/20 sm:grid-cols-3">
        <ConnectionFact label="Transport" value="Streamable HTTP" />
        <ConnectionFact label="Protocol" value={MCP_PROTOCOL_VERSION} mono />
        <ConnectionFact label="Permission" value="markets:read" mono />
      </div>

      <div
        role="status"
        aria-live="polite"
        className="flex min-h-11 items-center gap-2 border-t px-4 py-2 text-sm text-muted-foreground sm:px-5"
      >
        {connected ? (
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <PlugZap className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span>{status}</span>
      </div>
    </section>
  );
}

function ConnectionFact({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="border-b px-4 py-3 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0 sm:px-5">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
