import { apiFetch } from '../api.ts';

/**
 * Moderation report intake and case queue client (DRAGON-14). Mirrors
 * useNotificationsApi.ts style.
 */

export interface ModerationCaseView {
  id: string;
  subjectType: 'user' | 'content' | 'tournament';
  subjectId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  state: 'open' | 'assigned' | 'actioned' | 'dismissed';
  assignedTo: string | null;
  action: string | null;
  actionReason: string | null;
  emergency: boolean;
  reportCount: number;
  createdAt: string;
  version: number;
  /** Resolved server-side. Null unless the subject is a user with a profile. */
  subjectName: { username: string; displayName: string } | null;
  /** Resolved server-side. Null when the case is unassigned or the assignee has no profile. */
  assigneeName: { username: string; displayName: string } | null;
}

export interface ReportView {
  id: string;
  status: string;
  createdAt: string;
}

export function fileReport(body: { subjectType: 'user' | 'content' | 'tournament'; subjectId: string; reason: string; details?: string }): Promise<ReportView> {
  return apiFetch('/reports', { method: 'POST', body: JSON.stringify(body) });
}

export function listModerationCases(state?: string, cursor?: string): Promise<{ items: ModerationCaseView[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (state !== undefined && state !== 'all') params.set('state', state);
  if (cursor !== undefined) params.set('cursor', cursor);
  const q = params.toString();
  return apiFetch(`/admin/moderation/cases${q === '' ? '' : `?${q}`}`);
}

// --- Support cases: the requester's own surface (PAGE-023) ---

/** The approved support categories, matching the operator console's localized vocabulary. */
export const SUPPORT_CATEGORIES = ['account', 'payment', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** The case lifecycle the server exposes; runtime values so the locale guardrail can iterate them. */
export const SUPPORT_STATES = ['open', 'assigned', 'resolved', 'closed'] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

/**
 * A support case as its requester sees it.
 *
 * The server withholds `assignedTo` and `resolutionNote` from this projection — the staff
 * identity handling a case and the operator's working note are not the requester's to read —
 * so neither appears here.
 */
export interface SupportCaseView {
  id: string;
  category: SupportCategory;
  subject: string;
  state: SupportState;
  createdAt: string;
  version: number;
}

export function openSupportCase(body: { category: SupportCategory; subject: string; body: string }): Promise<SupportCaseView> {
  return apiFetch('/support/cases', { method: 'POST', body: JSON.stringify(body) });
}

export function listMySupportCases(cursor?: string): Promise<{ items: SupportCaseView[]; nextCursor: string | null }> {
  const query = cursor === undefined || cursor === '' ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return apiFetch(`/support/cases${query}`);
}
