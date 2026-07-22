import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the moderation module (DRAGON-14). */
export const MODERATION_COLLECTIONS = {
  reports: 'moderation_reports',
  cases: 'moderation_cases',
  supportCases: 'support_cases',
  recovery: 'recovery_requests'
} as const;

/**
 * Moderation safeguards. One open case per subject (a partial-unique index) so
 * concurrent reports collapse into one case; searchable case/report/support indexes.
 */
export const MODERATION_INDEXES: readonly IndexDeclaration[] = [
  { collection: MODERATION_COLLECTIONS.cases, name: 'case_open_subject_unique', keys: { subjectType: 1, subjectId: 1 }, options: { unique: true, partialFilterExpression: { state: { $in: ['open', 'assigned'] } } } },
  { collection: MODERATION_COLLECTIONS.cases, name: 'case_state_severity', keys: { state: 1, severity: 1, createdAt: -1 } },
  { collection: MODERATION_COLLECTIONS.cases, name: 'case_subject', keys: { subjectType: 1, subjectId: 1, createdAt: -1 } },
  { collection: MODERATION_COLLECTIONS.reports, name: 'report_case', keys: { caseId: 1, createdAt: 1 } },
  { collection: MODERATION_COLLECTIONS.reports, name: 'report_reporter', keys: { reporterId: 1, createdAt: -1 } },
  { collection: MODERATION_COLLECTIONS.supportCases, name: 'support_requester_created', keys: { requesterId: 1, createdAt: -1 } },
  { collection: MODERATION_COLLECTIONS.supportCases, name: 'support_state', keys: { state: 1, createdAt: -1 } },
  { collection: MODERATION_COLLECTIONS.recovery, name: 'recovery_state', keys: { state: 1, createdAt: -1 } }
];
