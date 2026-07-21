/**
 * Public surface of the identity module. Other modules import from here, never
 * from the module's internal files (section 32.1).
 */
export { IdentityService } from './service.ts';
export { MockSmsAdapter } from './sms.ts';
export { registerIdentityRoutes } from './routes.ts';
export { createSessionGuards, requireIdentity, SESSION_COOKIE } from './session-guard.ts';
export type { SessionGuards } from './session-guard.ts';
export type { AccountRecord, AccountState, SessionRecord } from './store.ts';
export type { AdminAccountSummary } from './service.ts';
