import { ChevronDown, LoaderCircle, LockKeyhole, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ToolDocument } from "./mcp-catalog";
import type { McpTool } from "./mcp-client";

interface McpOperationProps {
  argumentsJson: string;
  busy: boolean;
  connected: boolean;
  discoveredTool?: McpTool;
  error: string;
  expanded: boolean;
  onArgumentsChange: (value: string) => void;
  onExecute: () => void;
  onToggle: () => void;
  output: string;
  tool: ToolDocument;
}

export function McpOperation({
  argumentsJson,
  busy,
  connected,
  discoveredTool,
  error,
  expanded,
  onArgumentsChange,
  onExecute,
  onToggle,
  output,
  tool,
}: McpOperationProps) {
  const available = Boolean(discoveredTool);
  const editorId = `arguments-${tool.name}`;

  return (
    <article className="overflow-hidden rounded-md border bg-card">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`operation-${tool.name}`}
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4"
        >
          <span className="w-14 shrink-0 rounded bg-sky-600 px-2 py-1 text-center font-mono text-[11px] font-bold text-white">
            TOOL
          </span>
          <code className="min-w-0 shrink-0 text-sm font-semibold">
            {tool.name}
          </code>
          <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">
            {tool.summary}
          </span>
          <LockKeyhole
            className="ml-auto size-4 shrink-0 text-muted-foreground"
            aria-label="Requires markets:read"
          />
          <ChevronDown
            className={`size-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </h3>

      {expanded && (
        <div id={`operation-${tool.name}`} className="border-t">
          <div className="space-y-5 p-4 sm:p-5">
            <div>
              <p className="text-sm leading-6">
                {discoveredTool?.description ?? tool.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded border bg-muted px-2 py-1 font-mono">
                  markets:read
                </span>
                <span className="rounded border bg-muted px-2 py-1">
                  Read only
                </span>
                <span className="rounded border bg-muted px-2 py-1">
                  {connected
                    ? available
                      ? "Available"
                      : "Not advertised"
                    : "Connect to verify"}
                </span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold">Parameters</h4>
              <div className="mt-2 overflow-x-auto rounded border">
                <table className="w-full min-w-150 text-left text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tool.parameters.map((parameter) => (
                      <tr key={parameter.name}>
                        <td className="px-3 py-3 align-top font-mono text-xs font-semibold">
                          {parameter.name}
                          {parameter.required && (
                            <span className="ml-1 text-destructive">
                              required
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top font-mono text-xs text-muted-foreground">
                          {parameter.type}
                        </td>
                        <td className="px-3 py-3 leading-5 text-muted-foreground">
                          {parameter.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor={editorId} className="text-sm font-semibold">
                  Request arguments
                </label>
                <Textarea
                  id={editorId}
                  aria-label={`Arguments for ${tool.name}`}
                  value={argumentsJson}
                  onChange={(event) => onArgumentsChange(event.target.value)}
                  disabled={!available || busy}
                  spellCheck={false}
                  className="min-h-52 resize-y font-mono text-xs leading-5"
                />
                <Button
                  type="button"
                  onClick={onExecute}
                  disabled={!available || busy}
                  aria-label={`Execute ${tool.name}`}
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  {busy ? "Executing" : "Execute"}
                </Button>
                {error && (
                  <p
                    role="alert"
                    className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}
              </div>

              <section
                aria-label={`${tool.name} response`}
                className="min-h-64 overflow-hidden rounded border bg-muted/20"
              >
                <div className="border-b px-3 py-2 text-xs font-semibold">
                  Server response
                </div>
                <pre className="max-h-96 overflow-auto p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
                  {output ||
                    "Execute this operation to inspect its JSON-RPC response."}
                </pre>
              </section>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
