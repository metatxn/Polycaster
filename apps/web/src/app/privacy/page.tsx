import { buildPageMetadata } from "@/lib/seo";
import PrivacyClient from "./privacy-client";
import "../styles/marketing.css";

export const metadata = buildPageMetadata({
  title: "Privacy Policy",
  description:
    "Privacy Policy for Knoww (knoww.app) and the Knoww Extension — what we collect, what stays on your device, and how to reach us.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return <PrivacyClient />;
}
