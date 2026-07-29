import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the social module (DATA-056..059, SOCIAL-001). */
export const SOCIAL_COLLECTIONS = {
  follows: 'social_follows',
  posts: 'social_posts',
  comments: 'social_comments',
  reactions: 'social_reactions',
  profiles: 'social_profiles'
} as const;

export const SOCIAL_INDEXES: readonly IndexDeclaration[] = [
  // DATA-056: one active relation per (follower, target). Partial so a withdrawn follow
  // is kept as history while a duplicate active one is impossible.
  {
    collection: SOCIAL_COLLECTIONS.follows,
    name: 'follow_active_unique',
    keys: { followerId: 1, targetType: 1, targetId: 1 },
    options: { unique: true, partialFilterExpression: { state: 'active' } }
  },
  // The feed resolves "who do I follow" on every read (BR-025), so it must be indexed.
  { collection: SOCIAL_COLLECTIONS.follows, name: 'follow_follower_state', keys: { followerId: 1, state: 1, targetType: 1 } },
  // A profile page shows its own follower count from the other direction.
  { collection: SOCIAL_COLLECTIONS.follows, name: 'follow_target_state', keys: { targetType: 1, targetId: 1, state: 1 } },

  // The feed walks recent posts by author in time order; the compound index carries the
  // whole sort key so the walk stays inside matching rows (PERF-010).
  { collection: SOCIAL_COLLECTIONS.posts, name: 'post_author_created', keys: { authorId: 1, createdAt: -1, _id: -1 } },
  { collection: SOCIAL_COLLECTIONS.posts, name: 'post_state_created', keys: { state: 1, createdAt: -1, _id: -1 } },
  { collection: SOCIAL_COLLECTIONS.posts, name: 'post_visibility_created', keys: { visibility: 1, state: 1, createdAt: -1 } },

  { collection: SOCIAL_COLLECTIONS.comments, name: 'comment_post_created', keys: { postId: 1, createdAt: 1, _id: 1 } },
  { collection: SOCIAL_COLLECTIONS.comments, name: 'comment_author_created', keys: { authorId: 1, createdAt: -1 } },

  // DATA-059: one active reaction per actor per target.
  {
    collection: SOCIAL_COLLECTIONS.reactions,
    name: 'reaction_actor_target_unique',
    keys: { actorId: 1, targetType: 1, targetId: 1 },
    options: { unique: true }
  },
  { collection: SOCIAL_COLLECTIONS.reactions, name: 'reaction_target', keys: { targetType: 1, targetId: 1 } },

  { collection: SOCIAL_COLLECTIONS.profiles, name: 'social_profile_account_unique', keys: { accountId: 1 }, options: { unique: true } }
];
