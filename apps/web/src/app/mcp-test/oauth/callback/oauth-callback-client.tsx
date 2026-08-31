"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createOAuthCallbackMessage,
  OAUTH_CALLBACK_CHANNEL,
} from "../../mcp-oauth-callback";

export function OAuthCallbackClient() {
  const sent = useRef(false);
  const [status, setStatus] = useState("Returning to the MCP explorer...");

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const message = createOAuthCallbackMessage(window.location.search);
    window.history.replaceState({}, "", window.location.pathname);
    let delivered = false;
    const opener = window.opener;
    if (opener) {
      try {
        opener.postMessage(message, window.location.origin);
        delivered = true;
      } catch {
        // BroadcastChannel below covers browsers that sever popup openers.
      }
    }

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel === "function") {
      try {
        channel = new BroadcastChannel(OAUTH_CALLBACK_CHANNEL);
        channel.postMessage(message);
        delivered = true;
      } catch {
        channel = null;
      }
    }

    if (!delivered) {
      setStatus("The MCP explorer window is no longer open.");
      return;
    }

    setStatus("Authorization returned. You can close this window.");
    window.setTimeout(() => {
      channel?.close();
      window.close();
    }, 50);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-sm text-center">
        <LoaderCircle
          className="mx-auto size-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <h1 className="mt-4 text-lg font-semibold">MCP authorization</h1>
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {status}
        </p>
      </div>
    </main>
  );
}
