import type { EntityId } from '../../shared/ids.ts';

/**
 * Moderation, support, and account-recovery contracts (DRAGON-14).
 *
 * Reports feed moderation cases (severity, assignment, action, emergency review,
 * dismissal) with a searchable audit history. Support cases and recovery review keep
 * strict boundaries: recovery is triage-only (no approval under OD-029) and never
 * bypasses authentication or exposes sensitive evidence.
 */

export type ModerationSubjectType = 'user' | 'content' | 'tournament' | 'chat_message' | 'social_post' | 'social_comment';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type CaseState = 'open' | 'assigned' | 'actioned' | 'dismissed';
export type ModerationAction = 'suspend' | 'remove' | 'dismiss';

export interface ReportRecord {
  _id: EntityId;
  reporterId: EntityId;
  subjectType: ModerationSubjectType;
  subjectId: EntityId;
  reason: string;
  /** Bounded reporter-supplied detail; never rendered as HTML. */
  details: string;
  status: 'pending' | 'linked' | 'dismissed';
  caseId: EntityId | null;
  correlationId: string;
  createdAt: string;
}

export interface ModerationCaseRecord {
  _id: EntityId;
  subjectType: ModerationSubjectType;
  subjectId: EntityId;
  severity: Severity;
  state: CaseState;
  assignedTo: EntityId | null;
  action: ModerationAction | null;
  actionReason: string | null;
  /** Emergency review flag for expedited handling (auditable). */
  emergency: boolean;
  reportCount: number;
  correlationId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type SupportCaseState = 'open' | 'assigned' | 'resolved' | 'closed';

export interface SupportCaseRecord {
  _id: EntityId;
  requesterId: EntityId;
  category: string;
  subject: string;
  body: string;
  state: SupportCaseState;
  assignedTo: EntityId | null;
  resolutionNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Recovery review is triage-only (OD-029): pending → reviewed | rejected. No approval. */
export type RecoveryState = 'pending' | 'reviewed' | 'rejected';

export interface RecoveryRequestRecord {
  _id: EntityId;
  /** The account under review; stored by id, exposed only masked to support. */
  accountId: EntityId;
  reason: string;
  state: RecoveryState;
  reviewedBy: EntityId | null;
  reviewNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const CASE_TRANSITIONS: Readonly<Record<CaseState, readonly CaseState[]>> = {
  open: ['assigned', 'actioned', 'dismissed'],
  assigned: ['actioned', 'dismissed'],
  actioned: [],
  dismissed: []
};
export function canCaseTransition(from: CaseState, to: CaseState): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

const SUPPORT_TRANSITIONS: Readonly<Record<SupportCaseState, readonly SupportCaseState[]>> = {
  open: ['assigned', 'resolved', 'closed'],
  assigned: ['resolved', 'closed'],
  resolved: ['closed'],
  closed: []
};
export function canSupportTransition(from: SupportCaseState, to: SupportCaseState): boolean {
  return SUPPORT_TRANSITIONS[from].includes(to);
}

/** Masks an opaque account id for support-facing recovery output (never the full id). */
export function maskAccountId(accountId: EntityId): string {
  return accountId.length <= 8 ? '***' : `${accountId.slice(0, 4)}…${accountId.slice(-4)}`;
}
