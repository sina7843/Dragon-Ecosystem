import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { consumeRateLimit } from '../identity/rate-limit.ts';
import { toPlainText } from '../content/sanitize.ts';
import { SOCIAL_COLLECTIONS } from './collections.ts';
import {
  hasTombstone,
  isContentReadable,
  type ContentState,
  type FollowRecord,
  type FollowTargetType,
  type PostVisibility,
  type ReactionRecord,
  type ReactionTargetType,
  type SocialCommentRecord,
  type SocialPostRecord,
  type SocialProfileRecord,
  type SocialStatistic
} from './state.ts';

/**
 * Social graph and community content (SOCIAL-001..012).
 *
 * Invariants:
 * - Every read re-evaluates visibility from current state (BR-025). Nothing is fanned out.
 * - A follow and a reaction are idempotent; a duplicate is the same relation (SOCIAL-002).
 * - Post and comment bodies are stored as plain text, so nothing unsafe is ever stored.
 * - A mention only reaches a recipient the author could already see (SOCIAL-006).
 * - Reports go into the shared moderation case workflow, never a private table (SOCIAL-007).
 * - Blocking and muting are absent while OD-017 is unresolved (SOCIAL-008); there is no
 *   partially-built block table anywhere to accidentally consult.
 * - There is no direct-message or private-group path at all (SOCIAL-012).
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

const BODY_MAX = 2000;
const MAX_MEDIA = 4;
const MAX_MENTIONS = 10;
/** `@username` — the same character class the identity module allows for a username. */
const MENTION = /@([a-z0-9_]{3,30})/g;

export interface SocialConfig {
  /**
   * OD-017 gate. Fail-closed: while false there is no block or mute anywhere — not a
   * disabled endpoint, not an empty table. SOCIAL-008 requires the flag to prevent
   * *partial* activation, which is only true if nothing half-built exists.
   */
  readonly blockingEnabled: boolean;
  /** OD-024 gate. Appeals stay absent until eligibility and reviewer separation are defined. */
  readonly appealsEnabled: boolean;
  /** OD-027 gate. Push stays absent until a provider and platforms are selected. */
  readonly pushEnabled: boolean;
  readonly postsPerWindow: number;
  readonly postWindowSeconds: number;
}

export const DEFAULT_SOCIAL_CONFIG: SocialConfig = {
  blockingEnabled: false,
  appealsEnabled: false,
  pushEnabled: false,
  postsPerWindow: 10,
  postWindowSeconds: 300
};

/**
 * What social needs from identity: which accounts are publicly visible, and which
 * usernames resolve to a mentionable account. Social never reads identity's internals.
 */
export interface SocialDirectory {
  isPubliclyVisible(accountId: EntityId): Promise<boolean>;
  /** Usernames → account ids, already filtered to publicly visible profiles. */
  resolveMentionable(usernames: readonly string[]): Promise<Map<string, EntityId>>;
}

/** Report intake, satisfied by the shared moderation service (SOCIAL-007). */
export interface SocialModerationCases {
  fileReport(
    context: RequestContext,
    reporterId: EntityId,
    input: { subjectType: 'social_post' | 'social_comment'; subjectId: EntityId; reason: string; details?: string }
  ): Promise<{ _id: EntityId; caseId: EntityId | null }>;
}

/** A post as a viewer sees it. A removed post keeps its place but loses its body. */
export interface PostView {
  id: EntityId;
  authorId: EntityId;
  body: string | null;
  mediaUrls: string[];
  visibility: PostVisibility;
  state: ContentState;
  commentCount: number;
  reactionCount: number;
  viewerReacted: boolean;
  createdAt: string;
}

export class SocialService {
  readonly #database: Database;
  readonly #config: SocialConfig;
  readonly #directory: SocialDirectory;
  readonly #cases: SocialModerationCases;

  constructor(database: Database, config: SocialConfig, directory: SocialDirectory, cases: SocialModerationCases) {
    this.#database = database;
    this.#config = config;
    this.#directory = directory;
    this.#cases = cases;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #follows(db: Db = this.#db) {
    return db.collection<FollowRecord>(SOCIAL_COLLECTIONS.follows);
  }
  #posts(db: Db = this.#db) {
    return db.collection<SocialPostRecord>(SOCIAL_COLLECTIONS.posts);
  }
  #comments(db: Db = this.#db) {
    return db.collection<SocialCommentRecord>(SOCIAL_COLLECTIONS.comments);
  }
  #reactions(db: Db = this.#db) {
    return db.collection<ReactionRecord>(SOCIAL_COLLECTIONS.reactions);
  }
  #profiles(db: Db = this.#db) {
    return db.collection<SocialProfileRecord>(SOCIAL_COLLECTIONS.profiles);
  }

  /** What a client may show about the gated capabilities, without guessing. */
  configView(): { blockingEnabled: boolean; appealsEnabled: boolean; pushEnabled: boolean } {
    return { blockingEnabled: this.#config.blockingEnabled, appealsEnabled: this.#config.appealsEnabled, pushEnabled: this.#config.pushEnabled };
  }

  // --- Follows (SOCIAL-002, API-083) ---

  async follow(context: RequestContext, followerId: EntityId, targetType: FollowTargetType, targetId: EntityId): Promise<FollowRecord> {
    if (targetType === 'user' && targetId === followerId) {
      throw new ValidationError('You cannot follow yourself.', [{ field: 'targetId', code: 'SELF_FOLLOW', message: 'Choose someone else.' }]);
    }
    // Following a user who is not publicly visible would leak that the account exists.
    if (targetType === 'user' && !(await this.#directory.isPubliclyVisible(targetId))) {
      throw new NotFoundError('Unknown account.');
    }
    const existing = await this.#follows().findOne({ followerId, targetType, targetId, state: 'active' });
    if (existing !== null) return existing; // idempotent

    const now = utcNow();
    const record: FollowRecord = { _id: newId(), followerId, targetType, targetId, state: 'active', createdAt: now, updatedAt: now };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#follows(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'social.followed', resourceType: 'social_follow', resourceId: record._id, after: { targetType, targetId }, reason: 'Followed.' });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        const raced = await this.#follows().findOne({ followerId, targetType, targetId, state: 'active' });
        if (raced !== null) return raced;
      }
      throw error;
    }
    return record;
  }

  async unfollow(context: RequestContext, followerId: EntityId, targetType: FollowTargetType, targetId: EntityId): Promise<{ removed: boolean }> {
    const now = utcNow();
    const result = await runUnitOfWork(this.#database, context, async (uow) => {
      const updated = await this.#follows(uow.db).updateOne(
        { followerId, targetType, targetId, state: 'active' },
        { $set: { state: 'withdrawn', updatedAt: now } },
        { session: uow.session }
      );
      if (updated.matchedCount > 0) {
        uow.audit({ action: 'social.unfollowed', resourceType: 'social_follow', resourceId: `${targetType}:${targetId}`, after: { followerId }, reason: 'Unfollowed.' });
      }
      return updated.matchedCount > 0;
    });
    // Idempotent: unfollowing something you do not follow is a no-op, not an error.
    return { removed: result };
  }

  async listFollowing(followerId: EntityId, targetType?: FollowTargetType): Promise<FollowRecord[]> {
    const filter: Record<string, unknown> = { followerId, state: 'active' };
    if (targetType !== undefined) filter['targetType'] = targetType;
    return this.#follows().find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  }

  async countFollowers(targetType: FollowTargetType, targetId: EntityId): Promise<number> {
    return this.#follows().countDocuments({ targetType, targetId, state: 'active' });
  }

  // --- Posts (SOCIAL-004, API-085) ---

  async createPost(
    context: RequestContext,
    authorId: EntityId,
    input: { body: string; mediaUrls?: string[]; visibility?: string }
  ): Promise<SocialPostRecord> {
    const body = this.#plainBody(input.body);
    const mediaUrls = this.#mediaUrls(input.mediaUrls);
    const visibility = this.#visibility(input.visibility);

    // MEDIA-013 / FORM-018: social writing is rate limited, refused rather than queued.
    const decision = await consumeRateLimit(this.#db, `social_post:${authorId}`, this.#config.postsPerWindow, this.#config.postWindowSeconds);
    if (!decision.allowed) throw new RateLimitError('You are posting too quickly. Wait a moment and try again.');

    const mentionedAccountIds = await this.#resolveMentions(body);
    const now = utcNow();
    const record: SocialPostRecord = {
      _id: newId(),
      authorId,
      body,
      mediaUrls,
      visibility,
      state: 'published',
      mentionedAccountIds,
      commentCount: 0,
      reactionCount: 0,
      removedBy: null,
      removedReason: null,
      createdAt: now,
      updatedAt: now
    };
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#posts(uow.db).insertOne(record, { session: uow.session });
      uow.audit({ action: 'social.post_created', resourceType: 'social_post', resourceId: record._id, after: { visibility }, reason: 'Post published.' });
      this.#publishMentions(uow, record.mentionedAccountIds, authorId, record._id, 'post');
    });
    return record;
  }

  // --- Comments (SOCIAL-005, API-086) ---

  async createComment(context: RequestContext, postId: EntityId, authorId: EntityId, input: { body: string }): Promise<SocialCommentRecord> {
    const body = this.#plainBody(input.body);
    // A comment is only possible where the post itself is visible, so a private thread
    // cannot be probed by posting into it.
    const post = await this.#requireVisiblePost(postId, authorId);

    const decision = await consumeRateLimit(this.#db, `social_comment:${authorId}`, this.#config.postsPerWindow, this.#config.postWindowSeconds);
    if (!decision.allowed) throw new RateLimitError('You are commenting too quickly. Wait a moment and try again.');

    const mentionedAccountIds = await this.#resolveMentions(body);
    const now = utcNow();
    const record: SocialCommentRecord = {
      _id: newId(),
      postId,
      authorId,
      body,
      state: 'published',
      mentionedAccountIds,
      removedBy: null,
      removedReason: null,
      createdAt: now,
      updatedAt: now
    };
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#comments(uow.db).insertOne(record, { session: uow.session });
      await this.#posts(uow.db).updateOne({ _id: postId }, { $inc: { commentCount: 1 }, $set: { updatedAt: now } }, { session: uow.session });
      uow.audit({ action: 'social.comment_created', resourceType: 'social_comment', resourceId: record._id, after: { postId }, reason: 'Comment published.' });
      this.#publishMentions(uow, record.mentionedAccountIds, authorId, post._id, 'comment');
    });
    return record;
  }

  async listComments(postId: EntityId, viewerId: EntityId | null): Promise<Array<{ id: EntityId; authorId: EntityId; body: string | null; state: ContentState; createdAt: string }>> {
    await this.#requireVisiblePost(postId, viewerId);
    const rows = await this.#comments().find({ postId }).sort({ createdAt: 1 }).limit(200).toArray();
    return rows
      .filter((row) => isContentReadable(row.state) || hasTombstone(row.state))
      .map((row) => ({
        id: row._id,
        authorId: row.authorId,
        // A removed or deleted comment keeps its place so replies stay anchored, but its
        // body is never served (SOCIAL-005 tombstone behaviour).
        body: isContentReadable(row.state) ? row.body : null,
        state: row.state,
        createdAt: row.createdAt
      }));
  }

  // --- Reactions (SOCIAL-005, API-087) ---

  async react(context: RequestContext, actorId: EntityId, targetType: ReactionTargetType, targetId: EntityId): Promise<{ reacted: boolean }> {
    await this.#requireVisibleTarget(targetType, targetId, actorId);
    const existing = await this.#reactions().findOne({ actorId, targetType, targetId });
    if (existing !== null) return { reacted: true }; // idempotent

    const record: ReactionRecord = { _id: newId(), actorId, targetType, targetId, type: 'like', createdAt: utcNow() };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#reactions(uow.db).insertOne(record, { session: uow.session });
        if (targetType === 'post') {
          await this.#posts(uow.db).updateOne({ _id: targetId }, { $inc: { reactionCount: 1 } }, { session: uow.session });
        }
      });
    } catch (error) {
      if (isDuplicateKey(error)) return { reacted: true };
      throw error;
    }
    return { reacted: true };
  }

  async unreact(context: RequestContext, actorId: EntityId, targetType: ReactionTargetType, targetId: EntityId): Promise<{ reacted: boolean }> {
    await runUnitOfWork(this.#database, context, async (uow) => {
      const removed = await this.#reactions(uow.db).deleteOne({ actorId, targetType, targetId }, { session: uow.session });
      if (removed.deletedCount > 0 && targetType === 'post') {
        await this.#posts(uow.db).updateOne({ _id: targetId }, { $inc: { reactionCount: -1 } }, { session: uow.session });
      }
    });
    return { reacted: false };
  }

  // --- Feed (SOCIAL-003, BR-025, API-084) ---

  /**
   * The viewer's feed, assembled at read time.
   *
   * Follows are resolved now, and each candidate post's visibility and moderation state
   * are checked now, so a post that has since been made followers-only, removed, or
   * written by an account that has since gone private cannot appear — which a stored
   * fan-out could not promise (BR-025).
   */
  async feed(viewerId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<PostView>> {
    const limit = clampLimit(query.limit);
    const following = await this.listFollowing(viewerId, 'user');
    // A viewer always sees their own posts, whatever their audience.
    const authorIds = [...new Set([viewerId, ...following.map((f) => f.targetId)])];

    const filter: Record<string, unknown> = { authorId: { $in: authorIds }, state: 'published' };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $lt: cursor.id } }];
    }
    // Over-read so that posts dropped by the visibility check below still leave a full page.
    const rows = await this.#posts().find(filter).sort({ createdAt: -1, _id: -1 }).limit((limit + 1) * 2).toArray();

    const visible: SocialPostRecord[] = [];
    for (const row of rows) {
      if (visible.length > limit) break;
      if (await this.#canView(row, viewerId)) visible.push(row);
    }
    const page = toPage(visible.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    const reacted = await this.#reactedIds(viewerId, 'post', page.items.map((r) => r._id));
    return {
      items: page.items.map((row) => this.#postView(row as unknown as SocialPostRecord, reacted)),
      nextCursor: page.nextCursor
    };
  }

  async getPost(postId: EntityId, viewerId: EntityId | null): Promise<PostView> {
    const post = await this.#requireVisiblePost(postId, viewerId);
    const reacted = viewerId === null ? new Set<string>() : await this.#reactedIds(viewerId, 'post', [post._id]);
    return this.#postView(post, reacted);
  }

  /** An account's own posts, filtered to what this viewer may see. */
  async listAuthorPosts(authorId: EntityId, viewerId: EntityId | null, limit = 20): Promise<PostView[]> {
    if (!(await this.#directory.isPubliclyVisible(authorId)) && viewerId !== authorId) return [];
    const rows = await this.#posts().find({ authorId, state: 'published' }).sort({ createdAt: -1 }).limit(limit * 2).toArray();
    const visible: SocialPostRecord[] = [];
    for (const row of rows) {
      if (visible.length >= limit) break;
      if (await this.#canView(row, viewerId)) visible.push(row);
    }
    const reacted = viewerId === null ? new Set<string>() : await this.#reactedIds(viewerId, 'post', visible.map((r) => r._id));
    return visible.map((row) => this.#postView(row, reacted));
  }

  // --- Reports (SOCIAL-007, API-088) ---

  async report(
    context: RequestContext,
    reporterId: EntityId,
    input: { targetType: 'post' | 'comment'; targetId: EntityId; reason: string; details?: string }
  ): Promise<{ reportId: EntityId; caseId: EntityId | null }> {
    // Only reportable from something the reporter can actually see.
    const evidenceBody =
      input.targetType === 'post'
        ? (await this.#requireVisiblePost(input.targetId, reporterId)).body
        : await this.#commentEvidence(input.targetId, reporterId);

    const report = await this.#cases.fileReport(context, reporterId, {
      subjectType: input.targetType === 'post' ? 'social_post' : 'social_comment',
      subjectId: input.targetId,
      reason: input.reason,
      details: [`social ${input.targetType} ${input.targetId}`, `body at report time: ${evidenceBody}`, input.details ?? '']
        .filter((line) => line !== '')
        .join('\n')
    });
    return { reportId: report._id, caseId: report.caseId };
  }

  // --- Moderator and author removal (SOCIAL-005) ---

  async removePost(context: RequestContext, postId: EntityId, actorId: EntityId, input: { reason: string; asModerator: boolean }): Promise<SocialPostRecord> {
    const post = await this.#posts().findOne({ _id: postId });
    if (post === null) throw new NotFoundError('Unknown post.');
    if (!input.asModerator && post.authorId !== actorId) throw new ForbiddenError('You can only remove your own post.');
    if (post.state !== 'published') return post;
    const state: ContentState = input.asModerator ? 'removed' : 'deleted';
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const updated = await this.#posts(uow.db).updateOne(
        { _id: postId, state: 'published' },
        { $set: { state, removedBy: actorId, removedReason: input.reason.slice(0, 500), updatedAt: now } },
        { session: uow.session }
      );
      if (updated.matchedCount === 0) throw new ConflictError('SOCIAL_POST_STALE', 'This post changed. Reload and retry.');
      uow.audit({ action: `social.post_${state}`, resourceType: 'social_post', resourceId: postId, before: { state: 'published' }, after: { state }, reason: input.reason });
      return { ...post, state, removedBy: actorId, removedReason: input.reason, updatedAt: now };
    });
  }

  async removeComment(context: RequestContext, commentId: EntityId, actorId: EntityId, input: { reason: string; asModerator: boolean }): Promise<SocialCommentRecord> {
    const comment = await this.#comments().findOne({ _id: commentId });
    if (comment === null) throw new NotFoundError('Unknown comment.');
    if (!input.asModerator && comment.authorId !== actorId) throw new ForbiddenError('You can only remove your own comment.');
    if (comment.state !== 'published') return comment;
    const state: ContentState = input.asModerator ? 'removed' : 'deleted';
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const updated = await this.#comments(uow.db).updateOne(
        { _id: commentId, state: 'published' },
        { $set: { state, removedBy: actorId, removedReason: input.reason.slice(0, 500), updatedAt: now } },
        { session: uow.session }
      );
      if (updated.matchedCount === 0) throw new ConflictError('SOCIAL_COMMENT_STALE', 'This comment changed. Reload and retry.');
      uow.audit({ action: `social.comment_${state}`, resourceType: 'social_comment', resourceId: commentId, before: { state: 'published' }, after: { state }, reason: input.reason });
      return { ...comment, state, removedBy: actorId, removedReason: input.reason, updatedAt: now };
    });
  }

  /** Moderator view: the retained body of a removed item, for reviewing a case. */
  async getPostForModerator(postId: EntityId): Promise<SocialPostRecord | null> {
    return this.#posts().findOne({ _id: postId });
  }
  async listRecentPostsForModerator(limit = 50): Promise<SocialPostRecord[]> {
    return this.#posts().find({}).sort({ createdAt: -1 }).limit(clampLimit(limit)).toArray();
  }

  // --- Social profile (SOCIAL-001, SOCIAL-010) ---

  async upsertProfile(context: RequestContext, accountId: EntityId, input: { headline?: string; links?: Array<{ label?: string; url?: string }>; statisticsVisible?: boolean }): Promise<SocialProfileRecord> {
    const existing = await this.#profiles().findOne({ accountId });
    const now = utcNow();
    const links = (input.links ?? existing?.links ?? []).slice(0, 5).map((link) => {
      const url = (link.url ?? '').trim();
      if (url !== '' && !url.startsWith('https://')) {
        throw new ValidationError('A profile link is not allowed.', [{ field: 'links', code: 'INVALID_LINK', message: 'Use an https URL.' }]);
      }
      return { label: (link.label ?? '').trim().slice(0, 40), url };
    });
    const record: SocialProfileRecord = {
      _id: existing?._id ?? newId(),
      accountId,
      headline: (input.headline ?? existing?.headline ?? '').trim().slice(0, 160),
      links,
      // Privacy-by-default: statistics stay hidden until the owner opts in.
      statisticsVisible: input.statisticsVisible ?? existing?.statisticsVisible ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#profiles(uow.db).replaceOne({ accountId }, record, { session: uow.session, upsert: true });
      uow.audit({ action: 'social.profile_updated', resourceType: 'social_profile', resourceId: record._id, after: { statisticsVisible: record.statisticsVisible }, reason: 'Social profile saved.' });
    });
    return record;
  }

  /**
   * Public social profile. Returns null when the underlying Phase 1 profile is not
   * public, so the Phase 4 layer can never widen Phase 1's privacy decision.
   *
   * Statistics carry their source and period so a displayed number is reproducible
   * (SOCIAL-010), and are omitted entirely when the owner has not opted in.
   */
  /**
   * Resolves a public username to its account id, so the player page can reach the social
   * profile without the account id being published anywhere it is not already visible.
   * A private or unknown username resolves to null and is therefore indistinguishable.
   */
  async resolveUsername(username: string): Promise<EntityId | null> {
    const resolved = await this.#directory.resolveMentionable([username.trim().toLowerCase()]);
    return resolved.get(username.trim().toLowerCase()) ?? null;
  }

  async getPublicProfile(accountId: EntityId, viewerId: EntityId | null): Promise<{ headline: string; links: Array<{ label: string; url: string }>; statistics: SocialStatistic[] } | null> {
    const isSelf = viewerId === accountId;
    if (!isSelf && !(await this.#directory.isPubliclyVisible(accountId))) return null;
    const profile = await this.#profiles().findOne({ accountId });
    const base = { headline: profile?.headline ?? '', links: profile?.links ?? [] };
    if (profile?.statisticsVisible !== true && !isSelf) return { ...base, statistics: [] };

    const calculatedAt = utcNow();
    const [followers, following, posts] = await Promise.all([
      this.#follows().countDocuments({ targetType: 'user', targetId: accountId, state: 'active' }),
      this.#follows().countDocuments({ followerId: accountId, state: 'active' }),
      this.#posts().countDocuments({ authorId: accountId, state: 'published' })
    ]);
    return {
      ...base,
      statistics: [
        { key: 'followers', value: followers, source: SOCIAL_COLLECTIONS.follows, periodStart: null, calculatedAt },
        { key: 'following', value: following, source: SOCIAL_COLLECTIONS.follows, periodStart: null, calculatedAt },
        { key: 'posts', value: posts, source: SOCIAL_COLLECTIONS.posts, periodStart: null, calculatedAt }
      ]
    };
  }

  // --- Internals ---

  #plainBody(raw: string): string {
    // Plain text only: markup is stripped rather than escaped, so nothing unsafe is
    // stored and every renderer can treat the value as text (SOCIAL-004).
    const body = toPlainText(raw);
    if (body === '') {
      throw new ValidationError('Write something first.', [{ field: 'body', code: 'REQUIRED', message: 'A body is required.' }]);
    }
    // Rejected rather than truncated: silently storing the first 2000 characters would
    // publish a post the author did not write, and they would never be told.
    if (body.length > BODY_MAX) {
      throw new ValidationError('That is too long.', [
        { field: 'body', code: 'BODY_TOO_LONG', message: `Use at most ${String(BODY_MAX)} characters.` }
      ]);
    }
    return body;
  }

  #mediaUrls(raw: string[] | undefined): string[] {
    const urls = [...new Set(raw ?? [])].slice(0, MAX_MEDIA);
    for (const url of urls) {
      // Site media only: an uploaded asset the media module already validated and can
      // moderate, never an arbitrary remote URL (MEDIA-013).
      if (!url.startsWith('/media/')) {
        throw new ValidationError('That media reference is not allowed.', [
          { field: 'mediaUrls', code: 'INVALID_MEDIA_REF', message: 'Upload the image first and use its site path.' }
        ]);
      }
    }
    return urls;
  }

  #visibility(raw: string | undefined): PostVisibility {
    if (raw === undefined) return 'followers'; // privacy-by-default
    if (raw === 'followers' || raw === 'public') return raw;
    throw new ValidationError('That audience is not valid.', [{ field: 'visibility', code: 'INVALID_VISIBILITY', message: 'Use "followers" or "public".' }]);
  }

  /**
   * Mentions resolve only to accounts whose profile is publicly visible (SOCIAL-006).
   * An author therefore cannot force a notification to someone they could not already
   * see, and an unresolvable handle is dropped rather than stored as a dangling name.
   */
  async #resolveMentions(body: string): Promise<EntityId[]> {
    const usernames = [...new Set([...body.matchAll(MENTION)].map((match) => (match[1] as string).toLowerCase()))].slice(0, MAX_MENTIONS);
    if (usernames.length === 0) return [];
    const resolved = await this.#directory.resolveMentionable(usernames);
    return [...new Set(resolved.values())];
  }

  /** Queues one notification event per eligible mention through the shared outbox. */
  #publishMentions(uow: { publish: (input: { eventName: string; eventVersion: number; aggregateId: EntityId; payload: unknown }) => void }, recipients: readonly EntityId[], actorId: EntityId, postId: EntityId, surface: 'post' | 'comment'): void {
    for (const accountId of recipients) {
      if (accountId === actorId) continue; // never notify yourself
      uow.publish({ eventName: 'social.mentioned', eventVersion: 1, aggregateId: postId, payload: { accountId, postId, surface } });
    }
  }

  async #reactedIds(viewerId: EntityId, targetType: ReactionTargetType, targetIds: readonly EntityId[]): Promise<Set<string>> {
    if (targetIds.length === 0) return new Set();
    const rows = await this.#reactions().find({ actorId: viewerId, targetType, targetId: { $in: [...targetIds] } }).toArray();
    return new Set(rows.map((row) => row.targetId));
  }

  #postView(post: SocialPostRecord, reacted: Set<string>): PostView {
    return {
      id: post._id,
      authorId: post.authorId,
      body: isContentReadable(post.state) ? post.body : null,
      mediaUrls: isContentReadable(post.state) ? post.mediaUrls : [],
      visibility: post.visibility,
      state: post.state,
      commentCount: post.commentCount,
      reactionCount: post.reactionCount,
      viewerReacted: reacted.has(post._id),
      createdAt: post.createdAt
    };
  }

  /**
   * Whether this viewer may see this post *right now* (BR-025).
   *
   * Three current facts decide it: the post's moderation state, the author's profile
   * visibility, and — for a followers-only post — whether the viewer follows the author.
   * None of them is cached on the post.
   */
  async #canView(post: SocialPostRecord, viewerId: EntityId | null): Promise<boolean> {
    if (!isContentReadable(post.state)) return false;
    if (viewerId !== null && post.authorId === viewerId) return true;
    if (!(await this.#directory.isPubliclyVisible(post.authorId))) return false;
    if (post.visibility === 'public') return true;
    if (viewerId === null) return false;
    const follows = await this.#follows().findOne({ followerId: viewerId, targetType: 'user', targetId: post.authorId, state: 'active' });
    return follows !== null;
  }

  async #requireVisiblePost(postId: EntityId, viewerId: EntityId | null): Promise<SocialPostRecord> {
    const post = await this.#posts().findOne({ _id: postId });
    // A post the viewer may not see is indistinguishable from one that does not exist,
    // so probing for a private post's id tells the caller nothing.
    if (post === null || !(await this.#canView(post, viewerId))) throw new NotFoundError('Unknown post.');
    return post;
  }

  async #requireVisibleTarget(targetType: ReactionTargetType, targetId: EntityId, viewerId: EntityId): Promise<void> {
    if (targetType === 'post') {
      await this.#requireVisiblePost(targetId, viewerId);
      return;
    }
    const comment = await this.#comments().findOne({ _id: targetId });
    if (comment === null || !isContentReadable(comment.state)) throw new NotFoundError('Unknown comment.');
    await this.#requireVisiblePost(comment.postId, viewerId);
  }

  async #commentEvidence(commentId: EntityId, viewerId: EntityId): Promise<string> {
    const comment = await this.#comments().findOne({ _id: commentId });
    if (comment === null) throw new NotFoundError('Unknown comment.');
    await this.#requireVisiblePost(comment.postId, viewerId);
    return comment.body;
  }
}
