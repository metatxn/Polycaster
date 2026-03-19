"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MessageSquareOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { buildCommentTree, useEventComments } from "@/hooks/use-comments";
import { cn } from "@/lib/utils";
import type { TokenMarketMap } from "@/types/comments";
import { CommentItem } from "./comment-item";

interface CommentListProps {
  eventId: number;
  holdersOnly?: boolean;
  /** Sort order field */
  order?: string;
  /** Sort ascending */
  ascending?: boolean;
  className?: string;
  /** Token to market mapping for displaying position details */
  tokenMarketMap?: TokenMarketMap;
  /** Currently active reply comment ID */
  activeReplyId?: string | null;
  /** Callback when reply button is clicked */
  onReplyClick?: (commentId: string | null) => void;
  /** Whether user is connected */
  isConnected?: boolean;
  /** User's avatar URL */
  userAvatarUrl?: string | null;
  /** User's display name */
  userDisplayName?: string | null;
  /** User's wallet address */
  userAddress?: string | null;
  /** Legacy onReply callback */
  onReply?: (commentId: string, replyToAddress: string | null) => void;
}

export function CommentList({
  eventId,
  holdersOnly = false,
  order = "createdAt",
  ascending = false,
  className,
  tokenMarketMap,
}: // TODO: Uncomment when POST comments API is available
// activeReplyId,
// onReplyClick,
// isConnected,
// userAvatarUrl,
// userDisplayName,
// userAddress,
// onReply,
CommentListProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEventComments(eventId, {
    limit: 20,
    order,
    ascending,
    holdersOnly,
    getPositions: true,
  });

  // Infinite scroll observer
  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    );

    observer.observe(loadMoreRef.current);

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Flatten all pages and build comment tree
  const allComments = data?.pages.flatMap((page) => page.comments) ?? [];
  const commentTree = buildCommentTree(allComments);

  // TODO: Uncomment when POST comments API is available
  // Handle reply callback
  // const handleReply = useCallback(
  //   (commentId: string, replyToAddress: string | null) => {
  //     onReply?.(commentId, replyToAddress);
  //   },
  //   [onReply]
  // );

  if (isLoading) {
    return (
      <div className={cn("space-y-4", className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <CommentSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className={cn("text-center py-8", className)}>
        <p className="text-sm text-destructive">
          Failed to load comments: {error?.message || "Unknown error"}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => window.location.reload()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (commentTree.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(
          "flex flex-col items-center justify-center py-12 text-center",
          className
        )}
      >
        <div className="rounded-full bg-muted/50 p-4 mb-4">
          <MessageSquareOff className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">
          No comments yet
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Be the first to share your thoughts on this event
        </p>
      </motion.div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <AnimatePresence mode="popLayout">
        {commentTree.map((comment, index) => (
          <motion.div
            key={comment.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ delay: index * 0.05, duration: 0.2 }}
          >
            <CommentItem
              comment={comment}
              tokenMarketMap={tokenMarketMap}
              // TODO: Uncomment when POST comments API is available
              // eventId={eventId}
              // activeReplyId={activeReplyId}
              // onReplyClick={onReplyClick}
              // isConnected={isConnected}
              // userAvatarUrl={userAvatarUrl}
              // userDisplayName={userDisplayName}
              // userAddress={userAddress}
              // onReply={handleReply}
            />
            {index < commentTree.length - 1 && (
              <div className="border-b border-border/30 mt-4" />
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Load more trigger */}
      <div ref={loadMoreRef} className="h-4" />

      {/* Loading more indicator */}
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading more comments...
          </span>
        </div>
      )}

      {/* End of comments */}
      {!hasNextPage && allComments.length > 10 && (
        <p className="text-center text-xs text-muted-foreground/50 py-4">
          You&apos;ve reached the end of comments
        </p>
      )}
    </div>
  );
}

function CommentSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="h-9 w-9 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-6 w-14" />
        </div>
      </div>
    </div>
  );
}
