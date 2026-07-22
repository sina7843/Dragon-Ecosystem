import { COLLECTIONS, type IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the operations module (DRAGON-14). `jobExecutions` is the shared foundation collection. */
export const OPERATIONS_COLLECTIONS = {
  analyticsEvents: 'analytics_events',
  analyticsErrors: 'analytics_errors',
  alerts: 'ops_alerts',
  jobExecutions: COLLECTIONS.jobExecutions
} as const;

/** Operations indexes: time-ordered event/error/alert reads and job-execution lookups. */
export const OPERATIONS_INDEXES: readonly IndexDeclaration[] = [
  { collection: OPERATIONS_COLLECTIONS.analyticsEvents, name: 'analytics_name_created', keys: { name: 1, createdAt: -1 } },
  { collection: OPERATIONS_COLLECTIONS.analyticsErrors, name: 'analytics_error_created', keys: { createdAt: -1 } },
  { collection: OPERATIONS_COLLECTIONS.alerts, name: 'alert_status_created', keys: { status: 1, createdAt: -1 } },
  { collection: OPERATIONS_COLLECTIONS.alerts, name: 'alert_category_created', keys: { category: 1, createdAt: -1 } },
  { collection: OPERATIONS_COLLECTIONS.jobExecutions, name: 'job_name_started', keys: { jobName: 1, startedAt: -1 } }
];
