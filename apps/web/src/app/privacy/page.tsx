import type { Metadata } from "next";
import PrivacyClient from "./privacy-client";
import "../styles/marketing.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Knoww (knoww.app) and the Knoww Extension.",
};

export default function PrivacyPage() {
  return <PrivacyClient />;
}
