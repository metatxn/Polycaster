"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createOAuthCallbackMessage } from "../../mcp-oauth-callback";

export function OAuthCallbackClient() {
  const sent = useRef(false);
  const [status, setStatus] = useState("Returning to the MCP explorer...");

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const opener = window.opener;
    if (!opener) {
      setStatus("The MCP explorer window is no longer open.");
      return;
    }

    const message = createOAuthCallbackMessage(window.location.search);
    window.history.replaceState({}, "", window.location.pathname);
    opener.postMessage(message, window.location.origin);
    window.close();
    setStatus("Authorization returned. You can close this window.");
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-sm text-center">
        <LoaderCircle
          className="mx-auto size-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <h1 className="mt-4 text-lg font-semibold">Wallet authorization</h1>
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {status}
        </p>
      </div>
    </main>
  );
}
