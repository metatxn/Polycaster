"use client";

import { m } from "framer-motion";
import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChromeHeader } from "@/components/app-layout";
import { Navbar } from "@/components/navbar";
import { ProductFooter } from "@/components/product-footer";
import {
  ProductDataAge,
  ProductHero,
  ProductRefreshButton,
} from "@/components/product-hero";
import { PullStat, PullStatGrid, TrendGlyph } from "@/components/pull-stat";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { useTraderProfile } from "@/hooks/use-trader-profile";
import { formatAddress, formatCurrencyCompact } from "@/lib/formatters";
import { cn } from "@/lib/utils";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 py-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
              {label || text}
            </span>
            {copied ? (
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3 opacity-60" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : "Copy address"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RankCaption({
  pnl,
  volume,
}: {
  pnl: number | null;
  volume: number | null;
}) {
  const hasData = pnl !== null || volume !== null;
  if (!hasData) return <>Not ranked</>;
  const pnlValue = pnl ?? 0;
  const volValue = volume ?? 0;
  const sign = pnlValue < 0 ? "−" : "";
  const pnlStr = `${sign}${formatCurrencyCompact(Math.abs(pnlValue))}`;
  return (
    <>
      {/* nowrap: browsers can break after the minus sign, orphaning it on
          its own line in narrow ranking cells. */}
      <span className="whitespace-nowrap">{pnlStr}</span>
      <span className="mx-1.5 text-border/80">·</span>
      <span className="opacity-60 mr-1">VOL</span>
      {formatCurrencyCompact(volValue)}
    </>
  );
}

/** Ticking "updated Xs ago" leaf — re-renders only this label (every 5s)
 *  instead of the whole profile page (every second). */
function ProfileDataAge({ updatedAt }: { updatedAt: number }) {
  const now = useNow(5_000);
  return <ProductDataAge dataAgeMs={now - updatedAt} />;
}

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;

  const {
    data: profile,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useTraderProfile(address);

  // Title active before this route's own <title> committed — captured in
  // the first render (render phase runs before DOM mutations), so on soft
  // navigation it's the PREVIOUS route's metadata title (e.g.
  // /leaderboard's). Capturing inside the effect below is too late: Next
  // swaps the title for this route as soon as the navigation commits,
  // well before the profile data arrives.
  const [previousTitle] = useState(() =>
    typeof document === "undefined" ? "" : document.title
  );

  // Per-trader document title — set once the profile data arrives.
  // Cleanup restores the pre-navigation title instead of a hardcoded site
  // default (which clobbered e.g. /leaderboard's own metadata title on
  // Back). Restore only while we still own the title: on forward
  // navigation Next applies the destination route's metadata BEFORE this
  // passive cleanup runs, and overwriting it would clobber that route's
  // title; on Back, Next does NOT re-render the title, so this restore is
  // what brings the previous route's title back.
  useEffect(() => {
    if (!profile) return;
    const name = profile.userName || formatAddress(profile.proxyWallet);
    const title = `${name} | Knoww`;
    document.title = title;
    return () => {
      if (previousTitle && document.title === title) {
        document.title = previousTitle;
      }
    };
  }, [profile, previousTitle]);

  // The "updated Xs ago" ticking lives in the ProfileDataAge leaf so it
  // doesn't re-render the whole page every second. Fall back to the mount
  // timestamp until the first client fetch lands.
  const [mountedAt] = useState(() => Date.now());
  const effectiveUpdatedAt = dataUpdatedAt || mountedAt;

  // The API returns a valid empty profile for any 0x address. Treat a
  // trader with zero volume, no username, and no rankings at all as a
  // 404 — otherwise users hitting a typo'd address see a ghost profile
  // indistinguishable from a legit zero-activity trader.
  const isEmptyTrader =
    !!profile &&
    !profile.userName &&
    profile.totalVolume === 0 &&
    profile.totalPnl === 0 &&
    profile.tradesCount === 0 &&
    profile.positionsCount === 0 &&
    !profile.rankings.overall &&
    !profile.rankings.day &&
    !profile.rankings.week &&
    !profile.rankings.month;

  if (isLoading) {
    return (
      <div className="kw-app min-h-screen flex flex-col bg-(--kwm-bg)">
        <Navbar />
        <ChromeHeader />
        <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
          <div className="max-w-4xl mx-auto">
            <Skeleton className="h-9 w-24 rounded-none mb-6" />
            <div className="flex items-start gap-4 mb-8">
              <Skeleton className="h-20 w-20 rounded-sm" />
              <div className="space-y-3 flex-1">
                <Skeleton className="h-10 w-64 rounded-none" />
                <Skeleton className="h-3 w-40 rounded-none" />
                <Skeleton className="h-3 w-56 rounded-none" />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 border-y border-border/50 divide-x divide-y divide-border/40 md:divide-y-0 mb-8">
              {[...Array(4)].map((_, i) => (
                <div
                  key={`stat-${i}`}
                  className="px-4 py-5 flex flex-col gap-2"
                >
                  <Skeleton className="h-2.5 w-16 rounded-none" />
                  <Skeleton className="h-7 w-24 rounded-none" />
                  <Skeleton className="h-2.5 w-20 rounded-none" />
                </div>
              ))}
            </div>
            <Skeleton className="h-64 rounded-none" />
          </div>
        </main>
        <ProductFooter context="Profile" />
      </div>
    );
  }

  if (error || !profile || isEmptyTrader) {
    return (
      <div className="kw-app min-h-screen flex flex-col bg-(--kwm-bg)">
        <Navbar />
        <ChromeHeader />
        <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8 flex items-center justify-center">
          <div className="max-w-md text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-4">
              404 · Trader
            </p>
            <h1 className="font-editorial italic font-medium text-5xl sm:text-6xl leading-[1.02] tracking-tight text-foreground mb-4">
              Not found
            </h1>
            <p className="font-editorial text-base text-muted-foreground mb-8 leading-snug">
              No trader with this address has traded on Polymarket. Check the
              address or browse the leaderboard.
            </p>
            <button
              type="button"
              onClick={() => router.push("/leaderboard")}
              className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground hover:text-muted-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              <span className="underline underline-offset-4 decoration-border">
                Back to Leaderboard
              </span>
            </button>
          </div>
        </main>
        <ProductFooter context="Profile" />
      </div>
    );
  }

  const isProfitable = profile.totalPnl >= 0;

  return (
    <div className="kw-app min-h-screen flex flex-col bg-(--kwm-bg)">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="sr-only">
            {profile.userName || formatAddress(profile.proxyWallet)} — Trader
            Profile
          </h1>

          <ProductHero
            breadcrumbs={[
              { label: "Leaderboard", href: "/leaderboard" },
              { label: "Trader" },
              {
                label: profile.userName || formatAddress(profile.proxyWallet),
              },
            ]}
            rightSlot={
              <>
                <ProfileDataAge updatedAt={effectiveUpdatedAt} />
                <ProductRefreshButton
                  onRefresh={() => refetch()}
                  isFetching={isFetching}
                />
              </>
            }
            belowSlot={
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                <CopyButton
                  text={profile.proxyWallet}
                  label={formatAddress(profile.proxyWallet)}
                />
                {profile.xUsername && (
                  <Link
                    href={`https://x.com/${profile.xUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3 w-3 opacity-60" />@
                    {profile.xUsername}
                  </Link>
                )}
                <Link
                  href={`https://polygonscan.com/address/${profile.proxyWallet}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3 opacity-60" />
                  Polygonscan
                </Link>
              </div>
            }
          />

          {/* Pull-numbers */}
          <div className="mb-8">
            <PullStatGrid cols={4}>
              <PullStat
                label="Total P&L"
                value={formatCurrencyCompact(profile.totalPnl, false)}
                valueClassName={cn(
                  isProfitable
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                )}
                mark={<TrendGlyph direction={isProfitable ? "up" : "down"} />}
                caption="Realised + unrealised"
              />
              <PullStat
                label="Total Volume"
                value={formatCurrencyCompact(profile.totalVolume)}
                caption="All categories"
              />
              <PullStat
                label="Positions"
                value={profile.positionsCount.toString()}
                caption="Open markets"
              />
              <PullStat
                label="Trades"
                value={
                  profile.tradesCount > 100
                    ? "100+"
                    : profile.tradesCount.toString()
                }
                caption="Last 100"
              />
            </PullStatGrid>
          </div>

          {/* Rankings */}
          <div className="mb-8">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-3">
              §&nbsp;&nbsp;Leaderboard Rankings
            </h2>
            <PullStatGrid cols={4}>
              <PullStat
                label="Today"
                value={
                  profile.rankings.day?.rank
                    ? `#${profile.rankings.day.rank}`
                    : "—"
                }
                caption={
                  <RankCaption
                    pnl={profile.rankings.day?.pnl ?? null}
                    volume={profile.rankings.day?.vol ?? null}
                  />
                }
              />
              <PullStat
                label="This Week"
                value={
                  profile.rankings.week?.rank
                    ? `#${profile.rankings.week.rank}`
                    : "—"
                }
                caption={
                  <RankCaption
                    pnl={profile.rankings.week?.pnl ?? null}
                    volume={profile.rankings.week?.vol ?? null}
                  />
                }
              />
              <PullStat
                label="This Month"
                value={
                  profile.rankings.month?.rank
                    ? `#${profile.rankings.month.rank}`
                    : "—"
                }
                caption={
                  <RankCaption
                    pnl={profile.rankings.month?.pnl ?? null}
                    volume={profile.rankings.month?.vol ?? null}
                  />
                }
              />
              <PullStat
                label="All Time"
                value={
                  profile.rankings.overall?.rank
                    ? `#${profile.rankings.overall.rank}`
                    : "—"
                }
                caption={
                  <RankCaption
                    pnl={profile.rankings.overall?.pnl ?? null}
                    volume={profile.rankings.overall?.vol ?? null}
                  />
                }
              />
            </PullStatGrid>
          </div>

          {/* Related — editorial mono links to adjacent surfaces */}
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-12 border-t border-border/40 pt-6"
          >
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-4">
              §&nbsp;&nbsp;Related
            </h2>
            <ul className="flex flex-col gap-2.5">
              {[
                { href: "/leaderboard", label: "Full leaderboard" },
                {
                  href: `https://polygonscan.com/address/${profile.proxyWallet}`,
                  label: "On-chain activity",
                  external: true,
                },
                { href: "/markets", label: "Browse markets" },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                    className="group inline-flex items-baseline gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className="border-b border-border/60 pb-0.5 group-hover:border-foreground transition-colors">
                      {item.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className="translate-y-px transition-transform group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </m.div>
        </div>
      </main>

      <ProductFooter context="Profile" />
    </div>
  );
}
