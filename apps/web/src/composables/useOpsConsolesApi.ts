import { apiFetch } from '../api.ts';

/**
 * Clients for the finance, support, and operations consoles — three server-side surfaces
 * that had no screen at all.
 *
 * Every authorization, dual-control, and fail-closed rule lives on the server. Notably:
 * approving a cash entitlement needs `finance.manage`, but marking one **paid** needs
 * `finance.approve`, so the two steps cannot be taken by the same permission. Nothing
 * here re-implements or relaxes that; the calls simply surface what an operator may do
 * and report the server's refusal when they may not.
 */

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const s = search.toString();
  return s === '' ? '' : `?${s}`;
}

/** Idempotency keys are required by the money-moving routes so a retry cannot double-apply. */
function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// --- Finance (FEATURE-010) ---

export interface HoldView {
  id: string;
  ownerId: string;
  purpose: string;
  originalAmount: number;
  remainingAmount: number;
  state: string;
  businessRef: string;
  createdAt: string;
  expiresAt: string | null;
  version: number;
}

export interface EntitlementView {
  id: string;
  tournamentId: string;
  accountId: string;
  rank: number;
  amount: number;
  tomanAmount: number;
  state: 'pending' | 'approved' | 'paid' | 'failed' | 'superseded';
  reason: string | null;
  settlementEvidence: string | null;
  createdAt: string;
  version: number;
}

export function listHolds(params: { state?: string; purpose?: string; cursor?: string } = {}): Promise<{ items: HoldView[]; nextCursor: string | null }> {
  return apiFetch(`/admin/holds${query({ ...params, limit: '50' })}`);
}

export function captureHold(id: string, amount: number, reason: string): Promise<HoldView> {
  return apiFetch(`/admin/holds/${encodeURIComponent(id)}/capture`, {
    method: 'POST',
    body: JSON.stringify({ amount, reason, idempotencyKey: idempotencyKey('capture') })
  });
}

export function releaseHold(id: string, reason: string, amount?: number): Promise<HoldView> {
  return apiFetch(`/admin/holds/${encodeURIComponent(id)}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason, ...(amount === undefined ? {} : { amount }), idempotencyKey: idempotencyKey('release') })
  });
}

export function expireHolds(): Promise<{ expired: number }> {
  return apiFetch('/admin/holds/expire', { method: 'POST', body: JSON.stringify({ limit: 100 }) });
}

export function listEntitlements(params: { state?: string; cursor?: string } = {}): Promise<{ items: EntitlementView[]; nextCursor: string | null }> {
  return apiFetch(`/admin/entitlements${query({ ...params, limit: '50' })}`);
}

export function approveEntitlement(id: string, expectedVersion: number, reason: string): Promise<EntitlementView> {
  return apiFetch(`/admin/entitlements/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ expectedVersion, reason }) });
}

/** Requires `finance.approve`, a different permission from approving — dual control. */
export function payEntitlement(id: string, expectedVersion: number, reason: string, settlementEvidence: string): Promise<EntitlementView> {
  return apiFetch(`/admin/entitlements/${encodeURIComponent(id)}/pay`, { method: 'POST', body: JSON.stringify({ expectedVersion, reason, settlementEvidence }) });
}

export function failEntitlement(id: string, expectedVersion: number, reason: string): Promise<EntitlementView> {
  return apiFetch(`/admin/entitlements/${encodeURIComponent(id)}/fail`, { method: 'POST', body: JSON.stringify({ expectedVersion, reason }) });
}

// --- Support (FEATURE-011) ---

export interface SupportCaseView {
  id: string;
  category: string;
  subject: string;
  body: string;
  state: 'open' | 'assigned' | 'resolved' | 'closed';
  assignedTo: string | null;
  resolutionNote: string | null;
  requesterId: string;
  createdAt: string;
  version: number;
}

export interface RecoveryRequestView {
  _id: string;
  accountIdMasked?: string;
  accountId?: string;
  state: string;
  reason: string;
  note: string | null;
  createdAt: string;
  version: number;
}

export function listSupportCases(params: { state?: string; cursor?: string } = {}): Promise<{ items: SupportCaseView[]; nextCursor: string | null }> {
  return apiFetch(`/admin/support/cases${query({ ...params, limit: '50' })}`);
}

/** `to` maps onto the three transition routes; the server owns the state machine. */
export function transitionSupportCase(
  id: string,
  to: 'assigned' | 'resolved' | 'closed',
  body: { expectedVersion: number; assignee?: string; note?: string }
): Promise<SupportCaseView> {
  const path = to === 'assigned' ? 'assign' : to === 'resolved' ? 'resolve' : 'close';
  return apiFetch(`/admin/support/cases/${encodeURIComponent(id)}/${path}`, { method: 'POST', body: JSON.stringify(body) });
}

export function listRecoveryRequests(params: { state?: string; cursor?: string } = {}): Promise<{ items: RecoveryRequestView[]; nextCursor: string | null }> {
  return apiFetch(`/admin/recovery${query({ ...params, limit: '50' })}`);
}

/**
 * Triage only. Account recovery has no approval path by design — an operator records that
 * a request was reviewed or rejected, and never restores access from this screen.
 */
export function reviewRecovery(id: string, body: { expectedVersion: number; decision: 'reviewed' | 'rejected'; note: string }): Promise<RecoveryRequestView> {
  return apiFetch(`/admin/recovery/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(body) });
}

// --- Operations (FEATURE-012) ---

export interface AlertView {
  id: string;
  category: string;
  severity: string;
  message: string;
  status: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface JobExecutionView {
  id: string;
  jobName: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export function listAlerts(params: { status?: string; category?: string; cursor?: string } = {}): Promise<{ items: AlertView[]; nextCursor: string | null }> {
  return apiFetch(`/admin/ops/alerts${query({ ...params, limit: '50' })}`);
}

export function acknowledgeAlert(id: string): Promise<AlertView> {
  return apiFetch(`/admin/ops/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
}

export function listJobExecutions(params: { jobName?: string } = {}): Promise<{ jobs: JobExecutionView[] }> {
  return apiFetch(`/admin/ops/jobs${query({ ...params, limit: '50' })}`);
}

export function opsMetrics(): Promise<Record<string, unknown>> {
  return apiFetch('/admin/ops/metrics');
}

export function runJobs(): Promise<Record<string, unknown>> {
  return apiFetch('/admin/ops/run-jobs', { method: 'POST', body: JSON.stringify({ limit: 100 }) });
}

/** Inspects failure signals and raises alerts; read-then-alert, never a mutation of data. */
export function runHealthCheck(): Promise<Record<string, unknown>> {
  return apiFetch('/admin/ops/health-check', { method: 'POST' });
}
