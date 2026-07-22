/**
 * Editorial content lifecycle (CONTENT-001, roles ROLE-016/017/018).
 *
 * draft ⇄ in_review → published → archived, with unpublish (published → draft)
 * and restore (archived → draft). Publishing may be immediate or scheduled; a
 * scheduled item stays `in_review` until its publish time, so it is never public
 * early. Author/editor move between draft and review; only a publisher may reach
 * published/archived.
 */

export const CONTENT_STATES = ['draft', 'in_review', 'published', 'archived'] as const;

export type ContentState = (typeof CONTENT_STATES)[number];

const ALLOWED: Readonly<Record<ContentState, readonly ContentState[]>> = {
  draft: ['in_review'],
  in_review: ['draft', 'published'],
  published: ['draft', 'archived'],
  archived: ['draft']
};

export function canContentTransition(from: ContentState, to: ContentState): boolean {
  return ALLOWED[from].includes(to);
}

/** Transitions only a publisher may perform (reaching or leaving the public state). */
export function requiresPublishPermission(to: ContentState): boolean {
  return to === 'published' || to === 'archived';
}
