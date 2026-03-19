/**
 * Type definitions for Polymarket Comments API
 * Reference: https://docs.polymarket.com/api-reference/comments/list-comments
 */

export interface ProfileImageOptimized {
  id: string;
  imageUrlSource: string;
  imageUrlOptimized: string;
  imageSizeKbSource: number;
  imageSizeKbOptimized: number;
  imageOptimizedComplete: boolean;
  imageOptimizedLastUpdated: string;
  relID?: number;
  field?: string;
  relname?: string;
}

export interface CommentPosition {
  tokenId: string;
  positionSize: string;
}

export interface CommentProfile {
  name: string | null;
  pseudonym: string | null;
  displayUsernamePublic: boolean;
  bio: string | null;
  isMod: boolean;
  isCreator: boolean;
  proxyWallet: string | null;
  baseAddress: string | null;
  profileImage: string | null;
  profileImageOptimized?: ProfileImageOptimized;
  positions?: CommentPosition[];
}

export interface CommentReaction {
  id: string;
  commentID: number;
  reactionType: string;
  icon: string;
  userAddress: string;
  createdAt: string;
  profile?: CommentProfile;
}

export interface Comment {
  id: string;
  body: string | null;
  parentEntityType: "Event" | "Market" | "Series" | null;
  parentEntityID: number | null;
  parentCommentID: string | null;
  userAddress: string | null;
  replyAddress: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  profile: CommentProfile | null;
  reactions: CommentReaction[];
  reportCount: number | null;
  reactionCount: number | null;
}

/** Comment with nested replies for threaded display */
export interface CommentWithReplies extends Comment {
  replies: CommentWithReplies[];
}

export type ParentEntityType = "Event" | "Series" | "market";

export interface CommentsQueryParams {
  limit?: number;
  offset?: number;
  order?: string;
  ascending?: boolean;
  parent_entity_type?: ParentEntityType;
  parent_entity_id?: number;
  get_positions?: boolean;
  get_reports?: boolean;
  holders_only?: boolean;
}

export interface CommentsApiResponse {
  success: boolean;
  comments: Comment[];
  error?: string;
}

/** Mapping of token IDs to market info for displaying position details in comments */
export interface TokenMarketInfo {
  tokenId: string;
  marketName: string; // e.g., "Arsenal", "Man City"
  outcome: "Yes" | "No" | string; // YES or NO shares
}

/** Map from tokenId to market info */
export type TokenMarketMap = Map<string, TokenMarketInfo>;
