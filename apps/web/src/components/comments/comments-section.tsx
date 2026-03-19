"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock, Heart, MessageCircle, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { TokenMarketMap } from "@/types/comments";
// TODO: Uncomment when POST comments API is available
// import { CommentInput } from "./comment-input";
import { CommentList } from "./comment-list";

type SortOption = "latest" | "oldest" | "most_liked";

interface CommentsSectionProps {
  /** Numeric event ID for fetching comments */
  eventId: number;
  /** Optional class name for styling */
  className?: string;
  /** Whether to show as a card or inline */
  variant?: "card" | "inline";
  /** Token to market mapping for displaying position details */
  tokenMarketMap?: TokenMarketMap;
  // TODO: Uncomment when POST comments API is available
  // /** Whether user is connected/authenticated */
  // isConnected?: boolean;
  // /** User's avatar URL */
  // userAvatarUrl?: string | null;
  // /** User's display name */
  // userDisplayName?: string | null;
  // /** User's wallet address (required for posting) */
  // userAddress?: string | null;
}

const SORT_OPTIONS: { value: SortOption; label: string; icon: typeof Clock }[] =
  [
    { value: "latest", label: "Latest", icon: Clock },
    { value: "oldest", label: "Oldest", icon: Clock },
    { value: "most_liked", label: "Most Liked", icon: Heart },
  ];

export function CommentsSection({
  eventId,
  className,
  variant = "card",
  tokenMarketMap,
  // TODO: Uncomment when POST comments API is available
  // isConnected = false,
  // userAvatarUrl,
  // userDisplayName,
  // userAddress,
}: CommentsSectionProps) {
  const [holdersOnly, setHoldersOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("latest");
  // TODO: Uncomment when POST comments API is available
  // Track which comment has an active reply form (null = none)
  // const [activeReplyId, setActiveReplyId] = useState<string | null>(null);

  // const handleReplyClick = useCallback((commentId: string | null) => {
  //   setActiveReplyId(commentId);
  // }, []);

  // const handleCommentSuccess = useCallback(() => {
  //   // TODO: Refetch comments after posting
  //   console.log("Comment posted successfully");
  // }, []);

  // Get sort parameters based on selected option
  const getSortParams = () => {
    switch (sortBy) {
      case "latest":
        return { order: "createdAt", ascending: false };
      case "oldest":
        return { order: "createdAt", ascending: true };
      case "most_liked":
        return { order: "reactionCount", ascending: false };
      default:
        return { order: "createdAt", ascending: false };
    }
  };

  const { order, ascending } = getSortParams();

  const currentSortLabel =
    SORT_OPTIONS.find((opt) => opt.value === sortBy)?.label || "Latest";

  const content = (
    <>
      {/* Header with filter options */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-lg">Comments</h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Sort dropdown */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                {sortBy === "most_liked" ? (
                  <Heart className="h-3.5 w-3.5" />
                ) : (
                  <Clock className="h-3.5 w-3.5" />
                )}
                {currentSortLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setSortBy(option.value)}
                  className="gap-2"
                >
                  <option.icon className="h-4 w-4" />
                  {option.label}
                  {sortBy === option.value && (
                    <Check className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Holders only toggle */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="holders-filter"
              className={cn(
                "flex items-center gap-1.5 text-sm cursor-pointer transition-colors",
                holdersOnly
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground"
              )}
            >
              <Users className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Holders</span>
            </label>
            <Switch
              id="holders-filter"
              checked={holdersOnly}
              onCheckedChange={setHoldersOnly}
            />
          </div>
        </div>
      </div>

      {/* TODO: Uncomment when POST comments API is available */}
      {/* New comment input at the top */}
      {/* <div className="mb-6">
        <CommentInput
          eventId={eventId}
          isConnected={isConnected}
          userAvatarUrl={userAvatarUrl}
          userDisplayName={userDisplayName}
          userAddress={userAddress}
          onSuccess={handleCommentSuccess}
        />
      </div> */}

      {/* Active filters indicator */}
      <AnimatePresence>
        {(holdersOnly || sortBy !== "latest") && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {holdersOnly && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Users className="h-3 w-3" />
                  Holders only
                  <button
                    type="button"
                    onClick={() => setHoldersOnly(false)}
                    className="ml-1 hover:text-emerald-800 dark:hover:text-emerald-200"
                  >
                    ×
                  </button>
                </span>
              )}
              {sortBy !== "latest" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">
                  {sortBy === "most_liked" ? (
                    <Heart className="h-3 w-3" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                  {currentSortLabel}
                  <button
                    type="button"
                    onClick={() => setSortBy("latest")}
                    className="ml-1 hover:text-violet-800 dark:hover:text-violet-200"
                  >
                    ×
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setHoldersOnly(false);
                  setSortBy("latest");
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comments list */}
      <CommentList
        eventId={eventId}
        holdersOnly={holdersOnly}
        order={order}
        ascending={ascending}
        tokenMarketMap={tokenMarketMap}
        // TODO: Uncomment when POST comments API is available
        // activeReplyId={activeReplyId}
        // onReplyClick={handleReplyClick}
        // isConnected={isConnected}
        // userAvatarUrl={userAvatarUrl}
        // userDisplayName={userDisplayName}
        // userAddress={userAddress}
      />
    </>
  );

  if (variant === "inline") {
    return <div className={cn("py-4", className)}>{content}</div>;
  }

  return (
    <Card className={cn("overflow-hidden py-4", className)}>
      <CardContent className="pt-0">{content}</CardContent>
    </Card>
  );
}
