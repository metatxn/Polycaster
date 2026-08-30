import type { Metadata } from "next";
import { OAuthCallbackClient } from "./oauth-callback-client";

export const metadata: Metadata = {
  title: "MCP authorization",
  robots: { index: false, follow: false },
};

export default function OAuthCallbackPage() {
  return <OAuthCallbackClient />;
}
