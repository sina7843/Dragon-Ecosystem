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
