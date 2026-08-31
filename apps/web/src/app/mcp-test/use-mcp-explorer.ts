"use client";

import { useEffect, useRef, useState } from "react";
import { exampleArguments, TOOL_CATALOG } from "./mcp-catalog";
import {
  type JsonRpcResponse,
  MCP_PROTOCOL_VERSION,
  type McpTool,
  sendMcpRequest,
  toolsFromResponse,
} from "./mcp-client";
import {
  beginOAuthAuthorization,
  finishOAuthAuthorization,
  isLocalMcpEndpoint,
  type OAuthSession,
  type OAuthTransaction,
} from "./mcp-oauth";
import {
  listenForOAuthCallbackBroadcast,
  parseOAuthCallbackMessage,
} from "./mcp-oauth-callback";

const DEFAULT_ENDPOINT =
  process.env.NODE_ENV === "production"
    ? "https://mcp.knoww.app/mcp"
    : "http://127.0.0.1:8787/mcp";

type BusyState = "authorize" | "call" | "connect" | null;

function initialArguments(): Record<string, string> {
  return Object.fromEntries(
    TOOL_CATALOG.map((tool) => [tool.name, exampleArguments(tool.name)])
  );
}

function responseError(response: JsonRpcResponse): Error | null {
  if (response.error) {
    return new Error(
      `JSON-RPC ${response.error.code}: ${response.error.message}`
    );
  }
  if (response.result?.isError !== true) return null;
  const content = response.result.content;
  if (Array.isArray(content)) {
    const textResult = content.find(
      (item): item is { text: string; type: "text" } =>
        Boolean(item) &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string"
    );
    if (textResult) return new Error(textResult.text);
  }
  return new Error("The MCP tool returned an error.");
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Arguments must be a JSON object.");
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

export function useMcpExplorer() {
  const requestId = useRef(0);
  const oauthTransaction = useRef<OAuthTransaction | null>(null);
  const oauthPopup = useRef<Window | null>(null);
  const [endpoint, setEndpointValue] = useState(DEFAULT_ENDPOINT);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [connected, setConnected] = useState(false);
  const [expandedTool, setExpandedTool] = useState("search_markets");
  const [argumentsByTool, setArgumentsByTool] = useState(initialArguments);
  const [outputsByTool, setOutputsByTool] = useState<Record<string, string>>(
    {}
  );
  const [toolErrors, setToolErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState(
    "Connect to verify the server catalog and enable requests."
  );
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState<BusyState>(null);
  const [authPending, setAuthPending] = useState(false);
  const [session, setSession] = useState<OAuthSession | null>(null);

  useEffect(() => {
    const completeOAuthCallback = (value: unknown) => {
      const params = parseOAuthCallbackMessage(value);
      const transaction = oauthTransaction.current;
      if (!params || !transaction) return;
      oauthTransaction.current = null;

      setBusy("authorize");
      void finishOAuthAuthorization(transaction, params)
        .then((authorizedSession) => {
          setSession(authorizedSession);
          setStatus(
            "Authorized with markets:read. Connect to discover the tools."
          );
          setConnectionError("");
        })
        .catch((caught) => {
          setConnectionError(errorText(caught));
          setStatus("Authorization failed.");
        })
        .finally(() => {
          oauthPopup.current?.close();
          oauthPopup.current = null;
          setAuthPending(false);
          setBusy(null);
        });
    };

    const receiveWindowCallback = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      completeOAuthCallback(event.data);
    };
    const stopChannelCallback = listenForOAuthCallbackBroadcast(
      completeOAuthCallback
    );

    window.addEventListener("message", receiveWindowCallback);
    return () => {
      window.removeEventListener("message", receiveWindowCallback);
      stopChannelCallback();
      oauthPopup.current?.close();
      oauthPopup.current = null;
      oauthTransaction.current = null;
    };
  }, []);

  const nextId = () => {
    requestId.current += 1;
    return requestId.current;
  };

  const requestOptions = () =>
    session?.accessToken ? { accessToken: session.accessToken } : {};

  const connect = async () => {
    setBusy("connect");
    setConnected(false);
    setConnectionError("");
    setStatus("Connecting and reading the tool catalog...");
    try {
      const initialize = await sendMcpRequest(
        endpoint,
        {
          jsonrpc: "2.0",
          id: nextId(),
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "knoww-mcp-explorer", version: "1.0.0" },
          },
        },
        requestOptions()
      );
      const initializeError = responseError(initialize);
      if (initializeError) throw initializeError;

      const listResponse = await sendMcpRequest(
        endpoint,
        {
          jsonrpc: "2.0",
          id: nextId(),
          method: "tools/list",
          params: {},
        },
        requestOptions()
      );
      const listError = responseError(listResponse);
      if (listError) throw listError;
      const discoveredTools = toolsFromResponse(listResponse);
      setTools(discoveredTools);
      setConnected(true);

      const serverInfo = initialize.result?.serverInfo as
        | { name?: string; version?: string }
        | undefined;
      const serverName = serverInfo?.name ?? "MCP server";
      const serverVersion = serverInfo?.version ? ` ${serverInfo.version}` : "";
      const toolLabel = discoveredTools.length === 1 ? "tool" : "tools";
      setStatus(
        `Connected to ${serverName}${serverVersion}. Found ${discoveredTools.length} ${toolLabel}.`
      );
    } catch (caught) {
      setTools([]);
      setConnected(false);
      setConnectionError(errorText(caught));
      setStatus(
        errorText(caught).includes("HTTP 401")
          ? "Authorization required. Authorize, then connect again."
          : "Connection failed."
      );
    } finally {
      setBusy(null);
    }
  };

  const runTool = async (toolName: string) => {
    setToolErrors((current) => ({ ...current, [toolName]: "" }));
    let args: Record<string, unknown>;
    try {
      args = parseArguments(argumentsByTool[toolName] ?? "{}");
    } catch (caught) {
      setToolErrors((current) => ({
        ...current,
        [toolName]: errorText(caught),
      }));
      return;
    }
    setBusy("call");
    setStatus(`Calling ${toolName}...`);
    try {
      const response = await sendMcpRequest(
        endpoint,
        {
          jsonrpc: "2.0",
          id: nextId(),
          method: "tools/call",
          params: { name: toolName, arguments: args },
        },
        requestOptions()
      );
      setOutputsByTool((current) => ({
        ...current,
        [toolName]: JSON.stringify(response, null, 2),
      }));
      const callError = responseError(response);
      if (callError) throw callError;
      setStatus(`${toolName} returned a response.`);
    } catch (caught) {
      setToolErrors((current) => ({
        ...current,
        [toolName]: errorText(caught),
      }));
      setStatus(`${toolName} failed.`);
    } finally {
      setBusy(null);
    }
  };

  const authorize = async () => {
    setConnectionError("");
    const popup = window.open(
      "about:blank",
      "knoww-mcp-oauth",
      "popup,width=560,height=760"
    );
    if (!popup) {
      setConnectionError("Allow popups to start Google authorization.");
      return;
    }
    oauthPopup.current = popup;
    setBusy("authorize");
    setAuthPending(true);
    setStatus("Preparing secure Google authorization...");
    try {
      const redirectUri = `${window.location.origin}/mcp-test/oauth/callback`;
      const authorization = await beginOAuthAuthorization(
        endpoint,
        redirectUri
      );
      oauthTransaction.current = authorization.transaction;
      popup.location.href = authorization.authorizationUrl;
      setStatus("Complete Google sign-in in the popup window.");
    } catch (caught) {
      popup.close();
      oauthPopup.current = null;
      setAuthPending(false);
      setConnectionError(errorText(caught));
      setStatus("Authorization could not start.");
    } finally {
      setBusy(null);
    }
  };

  const setEndpoint = (value: string) => {
    oauthPopup.current?.close();
    oauthPopup.current = null;
    oauthTransaction.current = null;
    setEndpointValue(value);
    setSession(null);
    setAuthPending(false);
    setConnected(false);
    setTools([]);
    setConnectionError("");
    setToolErrors({});
    setOutputsByTool({});
    setStatus("Endpoint changed. Connect to verify its tool catalog.");
  };

  const cancelAuthorization = () => {
    oauthPopup.current?.close();
    oauthPopup.current = null;
    oauthTransaction.current = null;
    setAuthPending(false);
    setConnectionError("");
    setStatus("Authorization canceled. No credentials were stored.");
  };

  const disconnect = () => {
    oauthPopup.current?.close();
    oauthPopup.current = null;
    oauthTransaction.current = null;
    setSession(null);
    setAuthPending(false);
    setConnected(false);
    setTools([]);
    setConnectionError("");
    setStatus("Authorization cleared from this browser tab.");
  };

  return {
    argumentsByTool,
    authPending,
    authorize,
    authorized: Boolean(session),
    busy,
    cancelAuthorization,
    connect,
    connected,
    connectionError,
    disconnect,
    endpoint,
    expandedTool,
    isLocal: isLocalMcpEndpoint(endpoint),
    outputsByTool,
    runTool,
    setArgumentsByTool,
    setEndpoint,
    setExpandedTool,
    status,
    tools,
    toolErrors,
  };
}
