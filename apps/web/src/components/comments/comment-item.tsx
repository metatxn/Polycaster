"use client";

import { formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  // TODO: Uncomment when POST comments API is available
  // MessageSquare,
  Minus,
  Plus,
  Shield,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CommentWithReplies, TokenMarketMap } from "@/types/comments";

// TODO: Uncomment when POST comments API is available
// import { CommentInput } from "./comment-input";

interface CommentItemProps {
  comment: CommentWithReplies;
  depth?: number;
  /** Token to market mapping for displaying position details */
  tokenMarketMap?: TokenMarketMap;
  // TODO: Uncomment when POST comments API is available
  // /** Event ID for posting replies */
  // eventId?: number;
  // /** Currently active reply comment ID (controlled from parent) */
  // activeReplyId?: string | null;
  // /** Callback when reply button is clicked */
  // onReplyClick?: (commentId: string | null) => void;
  // /** Whether user is connected */
  // isConnected?: boolean;
  // /** User's avatar URL */
  // userAvatarUrl?: string | null;
  // /** User's display name */
  // userDisplayName?: string | null;
  // /** User's wallet address */
  // userAddress?: string | null;
  // /** Legacy onReply callback (deprecated, use onReplyClick) */
  // onReply?: (commentId: string, replyToAddress: string | null) => void;
}

// TODO: Uncomment when POST comments API is available
// const MAX_REPLY_DEPTH = 3;

/** Count total replies recursively */
function countAllReplies(comment: CommentWithReplies): number {
  let count = comment.replies?.length || 0;
  for (const reply of comment.replies || []) {
    count += countAllReplies(reply);
  }
  return count;
}

export function CommentItem({
  comment,
  depth = 0,
  tokenMarketMap,
}: // TODO: Uncomment when POST comments API is available
// eventId,
// activeReplyId,
// onReplyClick,
// isConnected,
// userAvatarUrl,
// userDisplayName,
// userAddress,
// onReply,
CommentItemProps) {
  // Minimized = entire comment collapsed (shows only avatar + name + expand button)
  const [isMinimized, setIsMinimized] = useState(false);
  // Show/hide replies (separate from minimize)
  const [showReplies, setShowReplies] = useState(depth < 2);

  const displayName = comment.profile?.displayUsernamePublic
    ? comment.profile.name
    : comment.profile?.pseudonym || "Anonymous";

  const avatarUrl =
    comment.profile?.profileImageOptimized?.imageUrlOptimized ||
    comment.profile?.profileImage;

  const timeAgo = comment.createdAt
    ? formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })
    : "";

  // Check if user has positions (holder badge)
  const hasPositions =
    comment.profile?.positions && comment.profile.positions.length > 0;

  // Calculate total position size for display
  const totalPositionSize = hasPositions
    ? (comment.profile?.positions ?? []).reduce(
        (sum, pos) => sum + Number.parseFloat(pos.positionSize || "0"),
        0
      )
    : 0;

  // Build position details for display
  const positionDetails = useMemo(() => {
    if (!hasPositions || !tokenMarketMap || tokenMarketMap.size === 0) {
      return null;
    }

    const positions = comment.profile?.positions ?? [];
    const details: {
      size: string;
      rawSize: number; // Keep raw size for sorting
      marketName: string;
      isYes: boolean;
    }[] = [];

    for (const pos of positions) {
      // Position size from API is in raw units (6 decimals like USDC)
      // Divide by 10^6 to get actual share count
      const rawSize = Number.parseFloat(pos.positionSize || "0");
      const size = rawSize / 1_000_000;
      if (size <= 0) continue;

      const marketInfo = tokenMarketMap.get(pos.tokenId);
      if (marketInfo) {
        // Format size with appropriate suffix (K, M, B)
        let formattedSize: string;
        if (size >= 1_000_000_000) {
          formattedSize = `${(size / 1_000_000_000).toFixed(1)}B`;
        } else if (size >= 1_000_000) {
          formattedSize = `${(size / 1_000_000).toFixed(1)}M`;
        } else if (size >= 1_000) {
          formattedSize = `${(size / 1_000).toFixed(1)}K`;
        } else if (size >= 1) {
          formattedSize = size.toFixed(0);
        } else {
          // For very small amounts, show with decimals
          formattedSize = size.toFixed(2);
        }
        // Remove trailing .0 for cleaner display (e.g., "101.0K" -> "101K")
        formattedSize = formattedSize.replace(/\.0([KMB])$/, "$1");

        details.push({
          size: formattedSize,
          rawSize: size, // Store raw size for sorting
          marketName: marketInfo.marketName,
          isYes: marketInfo.outcome.toLowerCase() === "yes",
        });
      }
    }

    // Sort by share count in descending order (highest first)
    details.sort((a, b) => b.rawSize - a.rawSize);

    return details.length > 0 ? details : null;
  }, [hasPositions, tokenMarketMap, comment.profile?.positions]);

  const isMod = comment.profile?.isMod;
  const isCreator = comment.profile?.isCreator;

  // Truncate wallet address for display
  const shortAddress = comment.userAddress
    ? `${comment.userAddress.slice(0, 6)}...${comment.userAddress.slice(-4)}`
    : null;

  // Get the profile address for linking (prefer proxyWallet, fallback to userAddress)
  const profileAddress =
    comment.profile?.proxyWallet ||
    comment.profile?.baseAddress ||
    comment.userAddress;

  const hasReplies = comment.replies && comment.replies.length > 0;
  const totalReplies = countAllReplies(comment);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn("group", depth > 0 && "mt-3")}
    >
      <div
        className={cn(
          "flex gap-3",
          depth > 0 && "pl-4 border-l-2 border-border/50 ml-4"
        )}
      >
        {/* Minimize/Expand toggle button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground self-start mt-1.5"
          onClick={() => setIsMinimized(!isMinimized)}
          title={isMinimized ? "Expand comment" : "Minimize comment"}
        >
          {isMinimized ? (
            <Plus className="h-3.5 w-3.5" />
          ) : (
            <Minus className="h-3.5 w-3.5" />
          )}
        </Button>

        {profileAddress ? (
          <Link
            href={`/profile/${profileAddress}`}
            className="shrink-0 transition-transform hover:scale-105"
          >
            <Avatar className="h-8 w-8 ring-2 ring-background cursor-pointer">
              <AvatarImage
                src={avatarUrl || undefined}
                alt={displayName || "User"}
              />
              <AvatarFallback className="bg-linear-to-br from-primary/20 to-accent/20 text-sm font-medium">
                {displayName?.charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          </Link>
        ) : (
          <Avatar className="h-8 w-8 shrink-0 ring-2 ring-background">
            <AvatarImage
              src={avatarUrl || undefined}
              alt={displayName || "User"}
            />
            <AvatarFallback className="bg-linear-to-br from-primary/20 to-accent/20 text-sm font-medium">
              {displayName?.charAt(0).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
        )}

        <div className="flex-1 min-w-0">
          {/* Header with name, badges, and time - always visible */}
          <div className="flex items-center gap-2 flex-wrap">
            {profileAddress ? (
              <Link
                href={`/profile/${profileAddress}`}
                className="font-semibold text-sm text-foreground hover:text-primary hover:underline transition-colors"
              >
                {displayName}
              </Link>
            ) : (
              <span className="font-semibold text-sm text-foreground">
                {displayName}
              </span>
            )}

            {/* Badges */}
            {isMod && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-500 dark:text-blue-400 font-medium">
                <Shield className="h-2.5 w-2.5" />
                Mod
              </span>
            )}
            {isCreator && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-500 dark:text-purple-400 font-medium">
                <Sparkles className="h-2.5 w-2.5" />
                Creator
              </span>
            )}
            {hasPositions &&
              totalPositionSize > 0 &&
              positionDetails &&
              positionDetails.length > 0 &&
              (positionDetails.length === 1 ? (
                // Single position - show inline badge
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                    positionDetails[0].isYes
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-red-500/15 text-red-600 dark:text-red-400"
                  )}
                >
                  {positionDetails[0].size} {positionDetails[0].marketName}
                </span>
              ) : (
                // Multiple positions - show dropdown like Polymarket
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-80 transition-opacity",
                        positionDetails[0].isYes
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-red-500/15 text-red-600 dark:text-red-400"
                      )}
                    >
                      {positionDetails[0].size} {positionDetails[0].marketName}
                      <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[180px]">
                    {positionDetails.map((pos, idx) => (
                      <DropdownMenuItem
                        key={idx}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="text-foreground/80">
                          {pos.marketName}
                        </span>
                        <span
                          className={cn(
                            "font-medium px-1.5 py-0.5 rounded text-[10px]",
                            pos.isYes
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-red-500/15 text-red-600 dark:text-red-400"
                          )}
                        >
                          {pos.size} {pos.isYes ? "Yes" : "No"}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}

            {/* Wallet address */}
            {shortAddress &&
              !isMinimized &&
              (profileAddress ? (
                <Link
                  href={`/profile/${profileAddress}`}
                  className="text-[10px] text-muted-foreground/70 font-mono hover:text-primary hover:underline transition-colors"
                >
                  {shortAddress}
                </Link>
              ) : (
                <span className="text-[10px] text-muted-foreground/70 font-mono">
                  {shortAddress}
                </span>
              ))}

            <span className="text-xs text-muted-foreground">{timeAgo}</span>

            {/* Minimized indicator */}
            {isMinimized && (
              <button
                type="button"
                onClick={() => setIsMinimized(false)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <ChevronRight className="h-3 w-3" />
                <span className="text-muted-foreground/70">
                  {totalReplies > 0
                    ? `${totalReplies + 1} comments hidden`
                    : "comment hidden"}
                </span>
              </button>
            )}
          </div>

          {/* Collapsible content */}
          <AnimatePresence initial={false}>
            {!isMinimized && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                {/* Comment body */}
                <p className="text-sm mt-1.5 text-foreground/90 whitespace-pre-wrap wrap-break-word leading-relaxed">
                  {comment.body}
                </p>

                {/* Actions row */}
                <div className="flex items-center gap-1 mt-2 -ml-2">
                  {/* Reactions count */}
                  {comment.reactionCount !== null &&
                    comment.reactionCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        {comment.reactionCount}
                      </Button>
                    )}

                  {/* TODO: Uncomment when POST comments API is available */}
                  {/* Reply button */}
                  {/* {depth < MAX_REPLY_DEPTH && (onReplyClick || onReply) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1 transition-opacity",
                        activeReplyId === comment.id
                          ? "opacity-100 text-primary"
                          : "opacity-0 group-hover:opacity-100"
                      )}
                      onClick={() => {
                        if (onReplyClick) {
                          // Toggle reply form - if already open, close it
                          onReplyClick(
                            activeReplyId === comment.id ? null : comment.id
                          );
                        } else if (onReply) {
                          onReply(comment.id, comment.userAddress);
                        }
                      }}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      {activeReplyId === comment.id ? "Cancel" : "Reply"}
                    </Button>
                  )} */}

                  {/* Show/hide replies toggle */}
                  {hasReplies && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1 ml-auto"
                      onClick={() => setShowReplies(!showReplies)}
                    >
                      {showReplies ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" />
                          Hide {comment.replies.length}{" "}
                          {comment.replies.length === 1 ? "reply" : "replies"}
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          Show {comment.replies.length}{" "}
                          {comment.replies.length === 1 ? "reply" : "replies"}
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {/* TODO: Uncomment when POST comments API is available */}
                {/* Inline reply form - appears below the comment */}
                {/* <AnimatePresence>
                  {activeReplyId === comment.id && eventId && (
                    <CommentInput
                      eventId={eventId}
                      parentCommentId={comment.id}
                      replyToUsername={displayName}
                      variant="reply"
                      isConnected={isConnected}
                      userAvatarUrl={userAvatarUrl}
                      userDisplayName={userDisplayName}
                      userAddress={userAddress}
                      onCancel={() => onReplyClick?.(null)}
                      onSuccess={() => {
                        onReplyClick?.(null);
                        // TODO: Refetch comments
                      }}
                      className="mt-3 ml-0"
                    />
                  )}
                </AnimatePresence> */}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Nested replies - hidden when parent is minimized */}
      <AnimatePresence initial={false}>
        {hasReplies && showReplies && !isMinimized && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2 overflow-hidden"
          >
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                depth={depth + 1}
                tokenMarketMap={tokenMarketMap}
                // TODO: Uncomment when POST comments API is available
                // eventId={eventId}
                // activeReplyId={activeReplyId}
                // onReplyClick={onReplyClick}
                // isConnected={isConnected}
                // userAvatarUrl={userAvatarUrl}
                // userDisplayName={userDisplayName}
                // userAddress={userAddress}
                // onReply={onReply}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
