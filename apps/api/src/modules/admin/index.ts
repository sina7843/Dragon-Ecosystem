/**
 * Public surface of the administration module (section 32.1).
 */
export { AdminService } from './service.ts';
export { AuthorizationService, requirePermission } from './authorization.ts';
export { registerAdminRoutes, type AdminDeps } from './routes.ts';
export type { Actor } from './service.ts';
