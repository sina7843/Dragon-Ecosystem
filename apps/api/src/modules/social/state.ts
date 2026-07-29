import type { EntityId } from '../../shared/ids.ts';

/**
 * Social graph and community contracts (SOCIAL-001..012, DATA-056..060).
 *
 * Two rules shape everything here:
 *
 * - Visibility is evaluated at *read* time, never baked into a stored activity row
 *   (BR-025). A post that was public when written and is followers-only now must
 *   disappear from a feed built after the change, which a precomputed fan-out cannot
 *   guarantee without a rebuild.
 * - Blocking and muting are not implemented at all while OD-017 is unresolved
 *   (SOCIAL-008). There is no half-built block table to accidentally consult.
 */

/** Entity types a user may follow (SOCIAL-002). Each already exists from Phase 1. */
export const FOLLOW_TARGET_TYPES = ['user', 'team', 'game'] as const;
export type FollowTargetType = (typeof FOLLOW_TARGET_TYPES)[number];

export interface FollowRecord {
  _id: EntityId;
  followerId: EntityId;
  targetType: FollowTargetType;
  targetId: EntityId;
  /** `active` or `withdrawn`; a withdrawn row is kept so the relation has a history. */
  state: 'active' | 'withdrawn';
  createdAt: string;
  updatedAt: string;
}

/**
 * Post audience (SOCIAL-004). Privacy-by-default: the composer defaults to `followers`,
 * so publishing to everyone is always a deliberate choice rather than an accident.
 * A wider `public` audience is still bounded by the author's own profile visibility.
 */
export const POST_VISIBILITIES = ['followers', 'public'] as const;
export type PostVisibility = (typeof POST_VISIBILITIES)[number];

/**
 * Moderation lifecycle shared by posts and comments (SOCIAL-005). `removed` keeps the
 * record so a thread does not collapse and evidence survives; the body simply stops
 * being served.
 */
export const CONTENT_STATES = ['published', 'removed', 'deleted'] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

/** Only a published item is ever readable by an ordinary viewer. */
export function isContentReadable(state: ContentState): boolean {
  return state === 'published';
}

/**
 * States that still occupy their place in a thread. A removed item renders as a
 * tombstone; a deleted one (the author's own removal) does too, so a reply never
 * dangles under a hole.
 */
export function hasTombstone(state: ContentState): boolean {
  return state === 'removed' || state === 'deleted';
}

export interface SocialPostRecord {
  _id: EntityId;
  authorId: EntityId;
  /** Plain text. Markup is stripped at the write boundary, never escaped at render. */
  body: string;
  /** Site media paths only; a social upload is moderation-compatible (MEDIA-013). */
  mediaUrls: string[];
  visibility: PostVisibility;
  state: ContentState;
  /** Accounts named in the body, resolved and filtered at write time (SOCIAL-006). */
  mentionedAccountIds: EntityId[];
  commentCount: number;
  reactionCount: number;
  removedBy: EntityId | null;
  removedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialCommentRecord {
  _id: EntityId;
  postId: EntityId;
  authorId: EntityId;
  body: string;
  state: ContentState;
  mentionedAccountIds: EntityId[];
  removedBy: EntityId | null;
  removedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Reaction kinds. Deliberately small: one positive signal, no sentiment taxonomy. */
export const REACTION_TYPES = ['like'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const REACTION_TARGET_TYPES = ['post', 'comment'] as const;
export type ReactionTargetType = (typeof REACTION_TARGET_TYPES)[number];

export interface ReactionRecord {
  _id: EntityId;
  actorId: EntityId;
  targetType: ReactionTargetType;
  targetId: EntityId;
  type: ReactionType;
  createdAt: string;
}

/**
 * Extra social fields layered beside the Phase 1 profile rather than replacing it
 * (SOCIAL-001): the existing profile id, username, and URL stay exactly as they were.
 * Statistics carry their own source and period so a displayed number can be reproduced
 * from authoritative records (SOCIAL-010).
 */
export interface SocialProfileRecord {
  _id: EntityId;
  accountId: EntityId;
  headline: string;
  links: Array<{ label: string; url: string }>;
  /** Whether follower/following counts and the post list are shown to others. */
  statisticsVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A statistic a public profile shows, with the provenance SOCIAL-010 requires. */
export interface SocialStatistic {
  key: 'followers' | 'following' | 'posts';
  value: number;
  /** The collection the number was counted from, so it can be reproduced. */
  source: string;
  /** Inclusive lower bound of the counting window; null means "all time". */
  periodStart: string | null;
  calculatedAt: string;
}
