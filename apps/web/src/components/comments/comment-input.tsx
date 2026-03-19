"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Loader2, Send, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useSignTypedData } from "wagmi";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CLOB_AUTH_DOMAIN,
  CLOB_AUTH_MESSAGE,
  CLOB_AUTH_TYPES,
} from "@/constants/polymarket";
import { cn } from "@/lib/utils";

interface PostCommentPayload {
  body: string;
  parentEntityId: number;
  parentEntityType: "Event" | "Series" | "market";
  parentCommentId?: string;
  auth: {
    address: string;
    signature: string;
    timestamp: string;
    nonce: string;
  };
}

interface PostCommentResponse {
  success: boolean;
  comment?: unknown;
  error?: string;
}

async function postComment(
  payload: PostCommentPayload
): Promise<PostCommentResponse> {
  const response = await fetch("/api/comments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data: PostCommentResponse = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to post comment");
  }

  return data;
}

interface CommentInputProps {
  /** Event ID for posting comments */
  eventId: number;
  /** Parent comment ID if this is a reply */
  parentCommentId?: string | null;
  /** Username being replied to (for display) */
  replyToUsername?: string | null;
  /** Callback when cancel is clicked (for replies) */
  onCancel?: () => void;
  /** Callback when comment is successfully posted */
  onSuccess?: () => void;
  /** User's avatar URL */
  userAvatarUrl?: string | null;
  /** User's display name */
  userDisplayName?: string | null;
  /** User's wallet address (required for posting) */
  userAddress?: string | null;
  /** Whether user is connected/authenticated */
  isConnected?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Variant styling */
  variant?: "default" | "reply";
  /** Additional className */
  className?: string;
}

export function CommentInput({
  eventId,
  parentCommentId,
  replyToUsername,
  onCancel,
  onSuccess,
  userAvatarUrl,
  userDisplayName,
  userAddress,
  isConnected = false,
  placeholder,
  variant = "default",
  className,
}: CommentInputProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { signTypedDataAsync } = useSignTypedData();

  const isReply = variant === "reply" || !!parentCommentId;
  const defaultPlaceholder = isReply
    ? `Reply to ${replyToUsername || "comment"}...`
    : "Share your thoughts on this event...";

  const handleSubmit = useCallback(async () => {
    if (!content.trim() || isSubmitting || !userAddress) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Generate L1 authentication signature
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = 0;

      const signature = await signTypedDataAsync({
        domain: CLOB_AUTH_DOMAIN,
        types: CLOB_AUTH_TYPES,
        primaryType: "ClobAuth",
        message: {
          address: userAddress as `0x${string}`,
          timestamp: `${timestamp}`,
          nonce: BigInt(nonce),
          message: CLOB_AUTH_MESSAGE,
        },
      });

      const payload: PostCommentPayload = {
        body: content.trim(),
        parentEntityId: eventId,
        parentEntityType: "Event",
        auth: {
          address: userAddress,
          signature,
          timestamp: `${timestamp}`,
          nonce: `${nonce}`,
        },
      };

      // Add parent comment ID if this is a reply
      if (parentCommentId) {
        payload.parentCommentId = parentCommentId;
      }

      await postComment(payload);

      // Clear the input
      setContent("");
      setIsFocused(false);

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      // Call success callback
      onSuccess?.();

      // If it's a reply, also call cancel to close the reply form
      if (isReply) {
        onCancel?.();
      }
    } catch (err) {
      console.error("Failed to post comment:", err);
      // Handle user rejection
      if (err instanceof Error && err.message.includes("rejected")) {
        setError("Signature request was rejected");
      } else {
        setError(err instanceof Error ? err.message : "Failed to post comment");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    content,
    isSubmitting,
    eventId,
    parentCommentId,
    userAddress,
    signTypedDataAsync,
    onSuccess,
    onCancel,
    isReply,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Cmd/Ctrl + Enter
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
      // Cancel reply on Escape
      if (e.key === "Escape" && isReply) {
        onCancel?.();
      }
    },
    [handleSubmit, isReply, onCancel]
  );

  // Auto-resize textarea
  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, []);

  // Not connected state
  if (!isConnected) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50",
          isReply && "ml-12",
          className
        )}
      >
        <Avatar className="h-8 w-8 shrink-0 opacity-50">
          <AvatarFallback className="bg-muted text-muted-foreground text-sm">
            ?
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">
            Connect your wallet to join the discussion
          </p>
        </div>
        {isReply && onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onCancel}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={isReply ? { opacity: 0, height: 0 } : false}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className={cn("overflow-hidden", isReply && "ml-12 mt-2", className)}
    >
      <div
        className={cn(
          "flex gap-3 p-3 rounded-lg transition-colors",
          isFocused || content
            ? "bg-accent/50 border border-border/50"
            : "bg-muted/30 border border-transparent hover:bg-muted/50"
        )}
      >
        <Avatar className="h-8 w-8 shrink-0">
          {userAvatarUrl && (
            <AvatarImage src={userAvatarUrl} alt={userDisplayName || "You"} />
          )}
          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 text-sm font-medium">
            {userDisplayName?.charAt(0).toUpperCase() || "Y"}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          {/* Reply indicator */}
          {isReply && replyToUsername && (
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-xs text-muted-foreground">
                Replying to{" "}
                <span className="font-medium text-foreground">
                  {replyToUsername}
                </span>
              </span>
            </div>
          )}

          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder || defaultPlaceholder}
            disabled={isSubmitting}
            className={cn(
              "min-h-[40px] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 resize-none",
              "placeholder:text-muted-foreground/60"
            )}
            rows={1}
          />

          {/* Error message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 mt-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="ml-auto hover:text-destructive/80"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actions row - show when focused or has content */}
          <AnimatePresence>
            {(isFocused || content) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center justify-between mt-2 pt-2 border-t border-border/30"
              >
                <span className="text-[10px] text-muted-foreground/60">
                  {content.length > 0 && `${content.length} characters`}
                  {content.length === 0 && "Press ⌘+Enter to submit"}
                </span>

                <div className="flex items-center gap-2">
                  {isReply && onCancel && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={onCancel}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-3 text-xs gap-1.5"
                    onClick={handleSubmit}
                    disabled={!content.trim() || isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Posting...
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        {isReply ? "Reply" : "Comment"}
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
