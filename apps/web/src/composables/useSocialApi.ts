import { apiFetch } from '../api.ts';

/**
 * Typed client for the community (SOCIAL-001..012).
 *
 * Visibility is never decided here. The server re-evaluates it on every read (BR-025), so
 * a post that vanishes between two calls is the expected outcome, not an error to retry.
 */

export type PostVisibility = 'followers' | 'public';
export type ContentState = 'published' | 'removed' | 'deleted';
export type FollowTargetType = 'user' | 'team' | 'game';

export interface PostView {
  id: string;
  authorId: string;
  /** Null once removed: the record keeps its place in the thread but loses its body. */
  body: string | null;
  mediaUrls: string[];
  visibility: PostVisibility;
  state: ContentState;
  commentCount: number;
  reactionCount: number;
  viewerReacted: boolean;
  createdAt: string;
}

export interface CommentView {
  id: string;
  postId: string;
  authorId: string;
  body: string | null;
  state: ContentState;
  createdAt: string;
}

export interface SocialConfig {
  blockingEnabled: boolean;
  appealsEnabled: boolean;
  pushEnabled: boolean;
}

export interface SocialStatistic {
  key: string;
  value: number;
  /** Where the number was counted from, so a displayed figure can be reproduced (SOCIAL-010). */
  source: string;
  periodStart: string | null;
  calculatedAt: string;
}

export interface SocialProfileView {
  headline: string;
  links: Array<{ label: string; url: string }>;
  statistics: SocialStatistic[];
  posts: PostView[];
  /** Whether the signed-in viewer already follows this account; false when anonymous. */
  viewerFollows: boolean;
}

export function getSocialConfig(): Promise<SocialConfig> {
  return apiFetch('/social/config');
}

export function feed(cursor?: string): Promise<{ items: PostView[]; nextCursor: string | null }> {
  return apiFetch(`/feed${cursor === undefined || cursor === '' ? '' : `?cursor=${encodeURIComponent(cursor)}`}`);
}

export function createPost(body: { body: string; visibility?: PostVisibility; mediaUrls?: string[] }): Promise<PostView> {
  return apiFetch('/posts', { method: 'POST', body: JSON.stringify(body) });
}

export function getPost(id: string): Promise<{ post: PostView; comments: CommentView[] }> {
  return apiFetch(`/posts/${encodeURIComponent(id)}`);
}

export function deleteOwnPost(id: string): Promise<PostView> {
  return apiFetch(`/posts/${encodeURIComponent(id)}/remove`, { method: 'POST', body: JSON.stringify({}) });
}

export function comment(postId: string, body: string): Promise<CommentView> {
  return apiFetch(`/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}

export function react(targetType: 'post' | 'comment', targetId: string): Promise<unknown> {
  return apiFetch(`/reactions/${targetType}/${encodeURIComponent(targetId)}`, { method: 'PUT' });
}

export function unreact(targetType: 'post' | 'comment', targetId: string): Promise<unknown> {
  return apiFetch(`/reactions/${targetType}/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
}

export function follow(targetType: FollowTargetType, targetId: string): Promise<unknown> {
  return apiFetch(`/follows/${targetType}/${encodeURIComponent(targetId)}`, { method: 'POST' });
}

export function unfollow(targetType: FollowTargetType, targetId: string): Promise<unknown> {
  return apiFetch(`/follows/${targetType}/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
}

export function listFollowing(): Promise<{ items: Array<{ id: string; targetType: FollowTargetType; targetId: string; state: string }> }> {
  return apiFetch('/me/following');
}

export function report(body: { targetType: 'post' | 'comment'; targetId: string; reason: string; details?: string }): Promise<{ reportId: string; caseId: string | null }> {
  return apiFetch('/social/reports', { method: 'POST', body: JSON.stringify(body) });
}

export function getSocialProfile(accountId: string): Promise<SocialProfileView> {
  return apiFetch(`/social/profiles/${encodeURIComponent(accountId)}`);
}

/** The same profile reached from the player page, which knows a username and not an id. */
export function getSocialProfileByUsername(username: string): Promise<SocialProfileView & { accountId: string }> {
  return apiFetch(`/social/profiles/by-username/${encodeURIComponent(username)}`);
}

export function saveSocialProfile(body: { headline?: string; statisticsVisible?: boolean; links?: Array<{ label: string; url: string }> }): Promise<unknown> {
  return apiFetch('/me/social-profile', { method: 'PUT', body: JSON.stringify(body) });
}

// --- Community moderation (PAGE-055) ---

export interface ModeratorPostView extends Omit<PostView, 'viewerReacted'> {
  removedBy: string | null;
  removedReason: string | null;
}

export function listCommunityPosts(): Promise<{ items: ModeratorPostView[] }> {
  return apiFetch('/admin/community/posts');
}

export function removeCommunityPost(id: string, reason: string): Promise<unknown> {
  return apiFetch(`/admin/community/posts/${encodeURIComponent(id)}/remove`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function removeCommunityComment(id: string, reason: string): Promise<unknown> {
  return apiFetch(`/admin/community/comments/${encodeURIComponent(id)}/remove`, { method: 'POST', body: JSON.stringify({ reason }) });
}
