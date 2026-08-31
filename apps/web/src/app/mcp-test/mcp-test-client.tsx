"use client";

import { TOOL_CATALOG } from "./mcp-catalog";
import { McpConnectionBar } from "./mcp-connection-bar";
import { McpOperation } from "./mcp-operation";
import { useMcpExplorer } from "./use-mcp-explorer";

export function McpTestClient() {
  const explorer = useMcpExplorer();

  return (
    <div className="space-y-6">
      <McpConnectionBar
        authBusy={explorer.busy === "authorize"}
        authPending={explorer.authPending}
        authorized={explorer.authorized}
        connecting={explorer.busy === "connect"}
        connected={explorer.connected}
        endpoint={explorer.endpoint}
        error={explorer.connectionError}
        isLocal={explorer.isLocal}
        onAuthorize={() => void explorer.authorize()}
        onCancelAuthorization={explorer.cancelAuthorization}
        onConnect={() => void explorer.connect()}
        onDisconnect={explorer.disconnect}
        onEndpointChange={explorer.setEndpoint}
        requestBusy={explorer.busy !== null}
        status={explorer.status}
      />

      <section aria-labelledby="mcp-tools-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 id="mcp-tools-heading" className="text-lg font-semibold">
              Tools
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Run search_markets first to load current identifiers into the
              other request editors, then review and execute each operation.
            </p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {TOOL_CATALOG.length} operations
          </span>
        </div>
        <div className="space-y-2">
          {TOOL_CATALOG.map((tool) => (
            <McpOperation
              key={tool.name}
              tool={tool}
              argumentsJson={explorer.argumentsByTool[tool.name] ?? "{}"}
              busy={
                explorer.busy === "call" && explorer.expandedTool === tool.name
              }
              connected={explorer.connected}
              discoveredTool={explorer.tools.find(
                (item) => item.name === tool.name
              )}
              error={explorer.toolErrors[tool.name] ?? ""}
              expanded={explorer.expandedTool === tool.name}
              output={explorer.outputsByTool[tool.name] ?? ""}
              onArgumentsChange={(value) =>
                explorer.setArgumentsByTool((current) => ({
                  ...current,
                  [tool.name]: value,
                }))
              }
              onExecute={() => void explorer.runTool(tool.name)}
              onToggle={() => {
                explorer.setExpandedTool((current) =>
                  current === tool.name ? "" : tool.name
                );
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
