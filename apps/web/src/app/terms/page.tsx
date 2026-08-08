import { buildPageMetadata } from "@/lib/seo";
import TermsClient from "./terms-client";
import "../styles/marketing.css";

export const metadata = buildPageMetadata({
  title: "Terms of Use",
  description:
    "Terms of Use for Knoww (knoww.app) and the Knoww Extension — eligibility, non-custodial trading, market data, and risk disclosures.",
  path: "/terms",
});

export default function TermsPage() {
  return <TermsClient />;
}
