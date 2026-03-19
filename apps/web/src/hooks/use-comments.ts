import { useInfiniteQuery } from "@tanstack/react-query";
import type {
  Comment,
  CommentsQueryParams,
  CommentWithReplies,
  ParentEntityType,
} from "@/types/comments";

interface CommentsApiResponse {
  success: boolean;
  comments: Comment[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  error?: string;
}

/**
 * Fetch comments from the API
 */
async function fetchComments(
  params: CommentsQueryParams
): Promise<CommentsApiResponse> {
  const searchParams = new URLSearchParams();

  if (params.parent_entity_type) {
    searchParams.set("parent_entity_type", params.parent_entity_type);
  }
  if (params.parent_entity_id !== undefined) {
    searchParams.set("parent_entity_id", String(params.parent_entity_id));
  }
  if (params.limit !== undefined) {
    searchParams.set("limit", String(params.limit));
  }
  if (params.offset !== undefined) {
    searchParams.set("offset", String(params.offset));
  }
  if (params.order) {
    searchParams.set("order", params.order);
  }
  if (params.ascending !== undefined) {
    searchParams.set("ascending", String(params.ascending));
  }
  if (params.get_positions !== undefined) {
    searchParams.set("get_positions", String(params.get_positions));
  }
  if (params.get_reports !== undefined) {
    searchParams.set("get_reports", String(params.get_reports));
  }
  if (params.holders_only !== undefined) {
    searchParams.set("holders_only", String(params.holders_only));
  }

  const response = await fetch(`/api/comments?${searchParams.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch comments");
  }

  const data: CommentsApiResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to fetch comments");
  }

  return data;
}

/**
 * Build a threaded comment tree from flat comments array
 * Groups replies under their parent comments
 */
export function buildCommentTree(comments: Comment[]): CommentWithReplies[] {
  const commentMap = new Map<string, CommentWithReplies>();
  const rootComments: CommentWithReplies[] = [];

  // First pass: create map of all comments with empty replies array
  for (const comment of comments) {
    commentMap.set(comment.id, { ...comment, replies: [] });
  }

  // Second pass: organize into tree structure
  for (const comment of comments) {
    const commentWithReplies = commentMap.get(comment.id);
    if (!commentWithReplies) continue;

    if (comment.parentCommentID) {
      // This is a reply - add to parent's replies
      const parent = commentMap.get(comment.parentCommentID);
      if (parent) {
        parent.replies.push(commentWithReplies);
      } else {
        // Parent not found (maybe not loaded yet), treat as root
        rootComments.push(commentWithReplies);
      }
    } else {
      // This is a root comment
      rootComments.push(commentWithReplies);
    }
  }

  // Sort replies by createdAt (oldest first for conversation flow)
  const sortReplies = (comments: CommentWithReplies[]) => {
    for (const comment of comments) {
      comment.replies.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });
      sortReplies(comment.replies);
    }
  };

  sortReplies(rootComments);

  return rootComments;
}

interface UseCommentsOptions {
  /** Number of comments per page (default: 40, matching Polymarket) */
  limit?: number;
  /** Field to order by */
  order?: string;
  /** Sort ascending (default: false = newest first) */
  ascending?: boolean;
  /** Include user positions in response */
  getPositions?: boolean;
  /** Include report/flag data in response */
  getReports?: boolean;
  /** Only show comments from position holders */
  holdersOnly?: boolean;
  /** Enable/disable the query */
  enabled?: boolean;
}

/**
 * Hook to fetch comments for an event with infinite scroll support
 *
 * @param entityType - Type of entity ("Event", "Series", "market")
 * @param entityId - Numeric ID of the entity
 * @param options - Query options
 */
export function useComments(
  entityType: ParentEntityType,
  entityId: number | undefined,
  options: UseCommentsOptions = {}
) {
  const {
    limit = 40, // Match Polymarket's default
    order = "createdAt",
    ascending = false,
    getPositions = true,
    getReports = true, // Match Polymarket's default
    holdersOnly,
    enabled = true,
  } = options;

  return useInfiniteQuery({
    queryKey: [
      "comments",
      entityType,
      entityId,
      { limit, order, ascending, holdersOnly, getReports },
    ],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await fetchComments({
        parent_entity_type: entityType,
        parent_entity_id: entityId,
        limit,
        offset: pageParam,
        order,
        ascending,
        get_positions: getPositions,
        get_reports: getReports,
        holders_only: holdersOnly,
      });
      return response;
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPage.pagination.offset + lastPage.pagination.limit;
    },
    initialPageParam: 0,
    enabled: enabled && entityId !== undefined,
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook specifically for event comments
 */
export function useEventComments(
  eventId: number | undefined,
  options?: UseCommentsOptions
) {
  return useComments("Event", eventId, options);
}
