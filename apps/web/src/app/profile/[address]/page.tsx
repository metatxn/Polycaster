"use client";

import { motion } from "framer-motion";
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Medal,
  TrendingDown,
  TrendingUp,
  Trophy,
  User,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function getRankIcon(rank: number) {
  switch (rank) {
    case 1:
      return <Crown className="h-5 w-5 text-yellow-500" />;
    case 2:
      return <Medal className="h-5 w-5 text-gray-400" />;
    case 3:
      return <Medal className="h-5 w-5 text-amber-600" />;
    default:
      return <Trophy className="h-5 w-5 text-muted-foreground" />;
  }
}

function getRankBadgeClass(rank: number) {
  switch (rank) {
    case 1:
      return "bg-gradient-to-r from-yellow-500 to-amber-500 text-white";
    case 2:
      return "bg-gradient-to-r from-gray-400 to-gray-500 text-white";
    case 3:
      return "bg-gradient-to-r from-amber-600 to-orange-600 text-white";
    default:
      return "bg-muted text-muted-foreground";
  }
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
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-muted/60 transition-colors text-sm"
          >
            <span className="font-mono text-muted-foreground">
              {label || text}
            </span>
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : "Copy address"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  className,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | null;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden",
        className
      )}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">{title}</span>
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <div className="flex items-center gap-2">
          {trend &&
            (trend === "up" ? (
              <TrendingUp className="h-5 w-5 text-emerald-500 shrink-0" />
            ) : (
              <TrendingDown className="h-5 w-5 text-red-500 shrink-0" />
            ))}
          <span
            className={cn(
              "text-xl sm:text-2xl font-bold",
              trend === "up" && "text-emerald-500",
              trend === "down" && "text-red-500"
            )}
          >
            {value}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function RankCard({
  title,
  rank,
  pnl,
  volume,
}: {
  title: string;
  rank: string | null;
  pnl: number | null;
  volume: number | null;
}) {
  if (!rank) {
    return (
      <Card className="bg-card/30 backdrop-blur-sm border-border/30">
        <CardContent className="p-4 sm:p-5 text-center h-full flex flex-col justify-center">
          <span className="text-sm text-muted-foreground">{title}</span>
          <p className="text-muted-foreground mt-3 text-sm">Not ranked</p>
        </CardContent>
      </Card>
    );
  }

  const rankNum = Number.parseInt(rank, 10);
  const isProfitable = (pnl || 0) >= 0;

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-violet-500/30 transition-colors overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">{title}</span>
          {getRankIcon(rankNum)}
        </div>
        <div className="flex items-center gap-2 mb-3">
          <span
            className={cn(
              "inline-flex items-center justify-center w-10 h-10 rounded-full text-base font-bold",
              getRankBadgeClass(rankNum)
            )}
          >
            #{rank}
          </span>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground shrink-0">P&L</span>
            <span
              className={cn(
                "font-semibold",
                isProfitable ? "text-emerald-500" : "text-red-500"
              )}
            >
              {formatCurrencyCompact(pnl || 0, true)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground shrink-0">Volume</span>
            <span className="font-medium">
              {formatCurrencyCompact(volume || 0)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;

  const { data: profile, isLoading, error } = useTraderProfile(address);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background">
        <PageBackground />
        <Navbar />
        <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
          <div className="max-w-4xl mx-auto">
            <Skeleton className="h-9 w-24 rounded-xl mb-6" />
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
                <Skeleton key={`stat-${i}`} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </main>
        <footer className="relative z-10 border-t border-border/30 py-6 bg-background/50 backdrop-blur-xl">
          <div className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Image
                src="/logo-256x256.png"
                alt="Knoww Logo"
                width={24}
                height={24}
                className="rounded-md"
              />
              <span className="font-bold text-foreground">Knoww</span>
              <span>•</span>
              <span>Powered by Polymarket</span>
            </div>
            <span>© 2025</span>
          </div>
        </footer>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen flex flex-col bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background">
        <PageBackground />
        <Navbar />
        <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-muted/50 mb-6">
              <User className="h-10 w-10 text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Profile Not Found</h1>
            <p className="text-muted-foreground mb-6 max-w-md">
              We couldn't find a trader with this address. They may not have any
              trading activity yet.
            </p>
            <Button
              onClick={() => router.push("/leaderboard")}
              className="rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Leaderboard
            </Button>
          </div>
        </main>
        <footer className="relative z-10 border-t border-border/30 py-6 bg-background/50 backdrop-blur-xl">
          <div className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Image
                src="/logo-256x256.png"
                alt="Knoww Logo"
                width={24}
                height={24}
                className="rounded-md"
              />
              <span className="font-bold text-foreground">Knoww</span>
              <span>•</span>
              <span>Powered by Polymarket</span>
            </div>
            <span>© 2025</span>
          </div>
        </footer>
      </div>
    );
  }

  const isProfitable = profile.totalPnl >= 0;

  return (
    <div className="min-h-screen flex flex-col bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background">
      <PageBackground />
      <Navbar />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
        <div className="max-w-4xl mx-auto">
          {/* Back Button */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-6"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="gap-2 rounded-xl hover:bg-muted/60"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </motion.div>

          {/* Profile Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex flex-col sm:flex-row items-start gap-5 sm:gap-6 mb-8"
          >
            <Avatar className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl border-4 border-violet-500/20 shadow-xl">
              {profile.profileImage && (
                <AvatarImage
                  src={profile.profileImage}
                  alt={profile.userName || "Trader"}
                />
              )}
              <AvatarFallback className="rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 text-white text-2xl font-bold">
                {getInitials(profile.userName, profile.proxyWallet)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold truncate">
                  {profile.userName || formatAddress(profile.proxyWallet)}
                </h1>
                {profile.verifiedBadge && (
                  <BadgeCheck className="h-6 w-6 text-blue-500 shrink-0" />
                )}
              </div>

              <CopyButton
                text={profile.proxyWallet}
                label={formatAddress(profile.proxyWallet)}
              />

              {profile.bio && (
                <p className="text-muted-foreground mt-2 line-clamp-2">
                  {profile.bio}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {profile.xUsername && (
                  <Link
                    href={`https://x.com/${profile.xUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Badge
                      variant="secondary"
                      className="gap-1.5 hover:bg-violet-100 dark:hover:bg-violet-500/20"
                    >
                      <ExternalLink className="h-3 w-3" />@{profile.xUsername}
                    </Badge>
                  </Link>
                )}
                <Link
                  href={`https://polygonscan.com/address/${profile.proxyWallet}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Badge
                    variant="outline"
                    className="gap-1.5 hover:bg-muted/50"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Polygonscan
                  </Badge>
                </Link>
              </div>
            </div>
          </motion.div>

          {/* Stats Grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-8"
          >
            <StatCard
              title="Total P&L"
              value={formatCurrencyCompact(profile.totalPnl, true)}
              icon={isProfitable ? TrendingUp : TrendingDown}
              trend={isProfitable ? "up" : "down"}
            />
            <StatCard
              title="Total Volume"
              value={formatCurrencyCompact(profile.totalVolume)}
              icon={BarChart3}
            />
            <StatCard
              title="Positions"
              value={profile.positionsCount.toString()}
              icon={Wallet}
            />
            <StatCard
              title="Trades"
              value={
                profile.tradesCount > 100
                  ? "100+"
                  : profile.tradesCount.toString()
              }
              icon={BarChart3}
            />
          </motion.div>

          {/* Rankings Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="bg-card/30 backdrop-blur-sm border-border/50">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Crown className="h-5 w-5 text-yellow-500" />
                  Leaderboard Rankings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                  <RankCard
                    title="Today"
                    rank={profile.rankings.day?.rank || null}
                    pnl={profile.rankings.day?.pnl || null}
                    volume={profile.rankings.day?.vol || null}
                  />
                  <RankCard
                    title="This Week"
                    rank={profile.rankings.week?.rank || null}
                    pnl={profile.rankings.week?.pnl || null}
                    volume={profile.rankings.week?.vol || null}
                  />
                  <RankCard
                    title="This Month"
                    rank={profile.rankings.month?.rank || null}
                    pnl={profile.rankings.month?.pnl || null}
                    volume={profile.rankings.month?.vol || null}
                  />
                  <RankCard
                    title="All Time"
                    rank={profile.rankings.overall?.rank || null}
                    pnl={profile.rankings.overall?.pnl || null}
                    volume={profile.rankings.overall?.vol || null}
                  />
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* View on Leaderboard CTA */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-8 text-center"
          >
            <Link href="/leaderboard">
              <Button
                variant="outline"
                className="gap-2 rounded-xl hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:border-violet-500/50"
              >
                <Trophy className="h-4 w-4" />
                View Full Leaderboard
              </Button>
            </Link>
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/30 py-6 bg-background/50 backdrop-blur-xl">
        <div className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-256x256.png"
              alt="Knoww Logo"
              width={24}
              height={24}
              className="rounded-md"
            />
            <span className="font-bold text-foreground">Knoww</span>
            <span>•</span>
            <span>Powered by Polymarket</span>
          </div>
          <span>© 2025</span>
        </div>
      </footer>
    </div>
  );
}
