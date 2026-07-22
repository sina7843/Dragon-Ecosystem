/** Public surface of the operations module (section 32.1). */
export { OperationsService, type JobRunner, type OperationsConfigView } from './service.ts';
export { registerOperationsRoutes, type OperationsDeps } from './routes.ts';
export { operationsMigration } from './migrations.ts';
export { OPERATIONS_COLLECTIONS, OPERATIONS_INDEXES } from './collections.ts';
export type { AnalyticsEventRecord, AlertRecord, JobExecutionRecord, AlertCategory } from './state.ts';
