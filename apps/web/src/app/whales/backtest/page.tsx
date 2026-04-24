import { BacktestClient } from "./backtest-client";

export const metadata = {
  title: "Insider Detection Backtest — Knoww",
  description:
    "Replay the insider detector against resolved Polymarket markets and measure precision + P&L lift.",
};

export default function BacktestPage() {
  return <BacktestClient />;
}
