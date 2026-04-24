"use client";

import { motion } from "framer-motion";
import { ArrowLeft, BadgeCheck, Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ChromeHeader } from "@/components/app-layout";
import { EditorialFooter } from "@/components/editorial-footer";
import { EditorialHero } from "@/components/editorial-hero";
import { Navbar } from "@/components/navbar";
import { PullStat, PullStatGrid, TrendGlyph } from "@/components/pull-stat";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTraderProfile } from "@/hooks/use-trader-profile";
import { formatCurrencyCompact } from "@/lib/formatters";
import { cn } from "@/lib/utils";

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getInitials(name: string | null, _address: string) {
  if (name && name.length > 0) {
    const parts = name.split(/[\s-]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return "0x";
}

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
  const sign = pnlValue >= 0 ? "+" : "−";
  const pnlStr = `${sign}${formatCurrencyCompact(Math.abs(pnlValue))}`;
  return (
    <>
      {pnlStr} · {formatCurrencyCompact(volValue)} vol
    </>
  );
}

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;

  const { data: profile, isLoading, error } = useTraderProfile(address);

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
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <ChromeHeader />
        <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
          <div className="max-w-4xl mx-auto">
            <Skeleton className="h-9 w-24 rounded-none mb-6" />
            <div className="flex items-start gap-4 mb-8">
              <Skeleton className="h-24 w-24 rounded-2xl" />
              <div className="space-y-3 flex-1">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={`stat-${i}`} className="h-28 rounded-none" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-none" />
          </div>
        </main>
        <EditorialFooter />
      </div>
    );
  }

  if (error || !profile || isEmptyTrader) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
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
        <EditorialFooter />
      </div>
    );
  }

  const isProfitable = profile.totalPnl >= 0;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
        <div className="max-w-4xl mx-auto">
          <EditorialHero
            breadcrumbs={[
              { label: "Leaderboard", href: "/leaderboard" },
              { label: "Trader" },
              {
                label: profile.userName || formatAddress(profile.proxyWallet),
              },
            ]}
            title={
              <>
                <Avatar className="h-12 w-12 sm:h-16 sm:w-16 lg:h-20 lg:w-20 rounded-2xl border border-border/60 shrink-0">
                  {profile.profileImage && (
                    <AvatarImage
                      src={profile.profileImage}
                      alt={profile.userName || "Trader"}
                    />
                  )}
                  <AvatarFallback className="rounded-2xl bg-muted font-mono text-sm sm:text-base lg:text-lg uppercase tracking-[0.1em] text-foreground/80">
                    {getInitials(profile.userName, profile.proxyWallet)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">
                  {profile.userName || formatAddress(profile.proxyWallet)}
                </span>
                {profile.verifiedBadge && (
                  <BadgeCheck className="h-6 w-6 sm:h-8 sm:w-8 text-sky-600 dark:text-sky-400 shrink-0" />
                )}
              </>
            }
            subtitle={
              profile.bio ? (
                <p className="line-clamp-2">{profile.bio}</p>
              ) : undefined
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
                value={formatCurrencyCompact(profile.totalPnl, true)}
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

          {/* View on Leaderboard CTA — editorial mono underline link */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-12 border-t border-border/40 pt-6"
          >
            <Link
              href="/leaderboard"
              className="group inline-flex items-baseline gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="border-b border-border/60 pb-0.5 group-hover:border-foreground transition-colors">
                View full leaderboard
              </span>
              <span
                aria-hidden="true"
                className="translate-y-px transition-transform group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          </motion.div>
        </div>
      </main>

      <EditorialFooter />
    </div>
  );
}
