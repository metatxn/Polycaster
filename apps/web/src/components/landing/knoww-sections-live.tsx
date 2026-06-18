"use client";

/**
 * The only client-side pieces of the landing sections: two mock widgets
 * whose numbers drift on an interval for the "live" feel. Everything else
 * in knoww-sections.tsx is static server markup; keeping these isolated
 * means the sections ship zero hydration JS apart from these two islands.
 */

import { Search } from "lucide-react";
import { useEffect, useState } from "react";

/** Odds value that drifts within a band on an interval — the "live" feel. */
function useTickingOdds(initial: number, [lo, hi]: [number, number]) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setV((prev) => {
        let next = prev + (Math.random() - 0.5) * 1.6;
        if (next < lo) next = lo + 0.5;
        if (next > hi) next = hi - 0.5;
        return Math.round(next * 10) / 10;
      });
    }, 1800);
    return () => clearInterval(id);
  }, [lo, hi]);
  return v;
}

export function ExtensionPopup() {
  const yes = useTickingOdds(42.6, [40, 46]);
  const no = Math.round((100 - yes) * 10) / 10;
  return (
    <div className="kw-glass relative z-1 w-[320px] overflow-hidden rounded-[14px]">
      <div className="flex items-center gap-3 border-b border-(--kw-fg)/10 px-4 py-3.5">
        <span
          className="relative h-7 w-7 rounded-[8px]"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--kw-accent) 70%, white), var(--kw-accent))",
            boxShadow: "0 0 14px var(--kw-accent-glow)",
          }}
        >
          <span className="absolute inset-[6px] rounded-[4px] bg-(--kw-bg-card)/70" />
        </span>
        <div className="flex-1">
          <div className="text-[13px] font-semibold">Knoww.App</div>
          <div className="font-mono text-[11px] text-(--kw-accent-text)">
            ● ACTIVE
          </div>
        </div>
        <Search className="h-3.5 w-3.5 text-(--kw-fg)/50" />
      </div>
      <div className="px-4 py-4">
        <div className="flex justify-between py-1.5 font-mono text-[12px] text-(--kw-fg)/70">
          <span>Scanning page context</span>
          <span className="text-(--kw-fg)">0.42s</span>
        </div>
        <div className="my-2 h-1 overflow-hidden rounded-full bg-(--kw-fg)/10">
          <div className="kw-bar-fill h-full w-[91%] rounded-full" />
        </div>
        <div className="flex justify-between py-1.5 font-mono text-[12px] text-(--kw-fg)/70">
          <span>Relevant markets found</span>
          <span className="text-(--kw-fg)">3</span>
        </div>
        <div className="flex justify-between py-1.5 font-mono text-[12px] text-(--kw-fg)/70">
          <span>Best match confidence</span>
          <span className="text-(--kw-accent-text)">91%</span>
        </div>
        <div className="-mx-4 mt-3 border-t border-(--kw-fg)/10 px-4 pt-3">
          <div className="mb-2 font-mono text-[10px] tracking-[0.08em] text-(--kw-fg)/70">
            TOP MATCH
          </div>
          <div className="text-[13px] leading-[1.4] text-(--kw-fg)">
            Incumbent-party win, 2028 US Presidential Election
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <div className="flex-1 rounded-[7px] bg-(--kw-accent)/12 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-(--kw-accent-text)">
              YES {yes}%
            </div>
            <div className="flex-1 rounded-[7px] bg-(--kw-danger-bright)/12 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-(--kw-danger-text)">
              NO {no}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function useTickingNumber(initial: number, range: number, ms = 1500) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setV((prev) => {
        const next = prev + (Math.random() - 0.5) * range * 2;
        return Math.max(
          initial - range,
          Math.min(initial + range, Math.round(next))
        );
      });
    }, ms);
    return () => clearInterval(id);
  }, [initial, range, ms]);
  return v;
}

export function AgentDashboard() {
  const conf = useTickingNumber(78, 4);
  return (
    <div className="kw-glass overflow-hidden rounded-[18px]">
      <div className="flex items-center justify-between border-b border-(--kw-fg)/10 px-4 py-3.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-(--kw-fg)/70">
        <span>Knoww Agent · Live Monitor</span>
        <span className="flex items-center gap-2 text-(--kw-accent-text)">
          <span className="kw-signal-dot h-1.5 w-1.5" />
          STREAMING
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="rounded-[12px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 p-3.5">
            <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-(--kw-accent-text)">
              <span className="kw-signal-dot h-1.5 w-1.5" />
              MARKET MOVEMENT DETECTED
            </span>
            <div className="mb-1 mt-2.5 text-[15px] font-medium">
              Incumbent-party win 2028 — odds shifted +3.2% in 14m
            </div>
            <div className="text-[14px] text-(--kw-fg)/75">
              <span className="font-mono text-[11px] text-(--kw-fg)/70">
                REASON
              </span>{" "}
              New policy statement from leading 2028 candidate referenced across
              3 monitored feeds.
            </div>
            <div className="mt-3 flex gap-2">
              {["Watch", "Alert"].map((a) => (
                <div
                  key={a}
                  className="flex-1 cursor-default rounded-[8px] border border-(--kw-fg)/10 py-2 text-center font-mono text-[12px] uppercase tracking-wider text-(--kw-fg)/70 transition-colors hover:border-(--kw-fg)/20"
                >
                  {a}
                </div>
              ))}
              <div className="flex-1 cursor-default rounded-[8px] border border-(--kw-accent)/28 bg-(--kw-accent)/10 py-2 text-center font-mono text-[12px] uppercase tracking-wider text-(--kw-accent-text)">
                Take position
              </div>
            </div>
          </div>

          <div className="mt-3 font-mono text-[12px] text-(--kw-fg)/65">
            {[
              {
                t: "14:02:11 · Crypto narrative pivot detected",
                d: "+1.1%",
                up: true,
              },
              {
                t: "13:58:42 · Macro release · CPI surprise",
                d: "−2.4%",
                up: false,
              },
              {
                t: "13:51:09 · Sports injury report parsed",
                d: "+0.6%",
                up: true,
              },
            ].map((r) => (
              <div
                key={r.t}
                className="flex justify-between border-t border-(--kw-fg)/10 py-2"
              >
                <span>{r.t}</span>
                <span
                  className={
                    r.up ? "text-(--kw-accent-text)" : "text-(--kw-danger-text)"
                  }
                >
                  {r.d}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          {[
            { k: "SUGGESTED", v: "Watch", c: "text-(--kw-fg)" },
            { k: "RISK LEVEL", v: "Medium", c: "text-amber-500" },
          ].map((row) => (
            <div
              key={row.k}
              className="mb-2 flex justify-between rounded-[10px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 px-3 py-2.5 font-mono text-[12px]"
            >
              <span className="text-(--kw-fg)/70">{row.k}</span>
              <span className={row.c}>{row.v}</span>
            </div>
          ))}
          <div className="flex justify-between rounded-[10px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 px-3 py-2.5 font-mono text-[12px]">
            <span className="text-(--kw-fg)/70">CONFIDENCE</span>
            <span className="text-(--kw-accent-text)">{conf}%</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-(--kw-fg)/10">
            <div
              className="h-full rounded-full bg-(--kw-accent) transition-[width] duration-700"
              style={{ width: `${conf}%` }}
            />
          </div>

          <div className="mt-3.5 rounded-[10px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 p-3">
            <div className="mb-1.5 font-mono text-[10px] tracking-[0.08em] text-(--kw-fg)/70">
              EXECUTION LIMIT
            </div>
            <div className="text-[13px]">≤ $250 per signal · max 3/day</div>
          </div>
          <div className="mt-2 rounded-[10px] border border-(--kw-fg)/10 bg-(--kw-fg)/2 p-3">
            <div className="mb-1.5 font-mono text-[10px] tracking-[0.08em] text-(--kw-fg)/70">
              REASONING
            </div>
            <div className="text-[13px] leading-[1.5] text-(--kw-fg)/75">
              Signal corroborated across 3 sources. Volume in matching market up
              18%. Suggesting watch, not act.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
