import { apiFetch } from '../api.ts';

/**
 * Clients for three administration surfaces that were fully implemented server-side and
 * had no screen at all: the media library, versioned configuration, and notification
 * templates + deliveries.
 *
 * Every rule — who may call, optimistic concurrency, dual-control approval, whether an
 * asset is still referenced — is enforced by the server. These functions only shape
 * requests; nothing here decides whether an operation is allowed.
 */

// --- Media library (FEATURE-005) ---

export interface MediaAsset {
  id: string;
  state: 'staged' | 'published';
  url: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  alt: { fa: string; en: string };
  version: number;
  createdAt: string;
  publishedAt: string | null;
}

export function listMedia(params: { state?: string; cursor?: string } = {}): Promise<{ items: MediaAsset[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ limit: '50' });
  if (params.state !== undefined && params.state !== '') q.set('state', params.state);
  if (params.cursor !== undefined) q.set('cursor', params.cursor);
  return apiFetch(`/admin/media?${q.toString()}`);
}

export function publishMedia(id: string, expectedVersion: number): Promise<MediaAsset> {
  return apiFetch(`/admin/media/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({ expectedVersion }) });
}

export function setMediaAlt(id: string, alt: { fa: string; en: string }, expectedVersion: number): Promise<MediaAsset> {
  return apiFetch(`/admin/media/${encodeURIComponent(id)}/alt`, { method: 'POST', body: JSON.stringify({ expectedVersion, alt }) });
}

/** The server refuses to delete an asset something still points at; that 409 is the guard. */
export function deleteMedia(id: string): Promise<void> {
  return apiFetch(`/admin/media/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- Configuration (FEATURE-006) ---

export interface ConfigVersion {
  id: string;
  key: string;
  version: number;
  value: unknown;
  state: 'active' | 'pending_approval' | 'superseded' | 'rejected';
  highRisk: boolean;
  reason: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
}

export interface ConfigEntry {
  key: string;
  active: ConfigVersion | null;
  pending: ConfigVersion | null;
}

export function listConfiguration(): Promise<{ items: ConfigEntry[] }> {
  return apiFetch('/admin/configuration');
}

export function listConfigurationHistory(key: string): Promise<ConfigVersion[]> {
  return apiFetch(`/admin/configuration/${encodeURIComponent(key)}`);
}

/**
 * Proposes a value. A high-risk key (finance/security/payout) lands as
 * `pending_approval` and a *different* operator must approve it — the server decides
 * that, so the form never pre-judges which path a key takes.
 */
export function proposeConfiguration(input: { key: string; value: unknown; reason: string }): Promise<ConfigVersion> {
  return apiFetch('/admin/configuration', { method: 'POST', body: JSON.stringify(input) });
}

export function approveConfiguration(id: string, reason: string): Promise<ConfigVersion> {
  return apiFetch(`/admin/configuration/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// --- Notification templates and deliveries (FEATURE-007) ---

export interface NotificationTemplate {
  id: string;
  templateKey: string;
  channel: 'sms' | 'email';
  version: number;
  category: 'transactional' | 'marketing';
  status: 'draft' | 'approved';
  locales: Record<'fa' | 'en', { subject: string; body: string }>;
  createdAt: string;
}

export interface NotificationDelivery {
  id: string;
  channel: 'sms' | 'email';
  templateKey: string;
  category: string;
  recipientMasked: string;
  status: 'pending' | 'sent' | 'failed' | 'dead' | 'suppressed';
  attempts: number;
  suppressedReason: string | null;
  createdAt: string;
}

export function listNotificationTemplates(): Promise<{ templates: NotificationTemplate[] }> {
  return apiFetch('/admin/notification-templates');
}

export function approveNotificationTemplate(id: string): Promise<NotificationTemplate> {
  return apiFetch(`/admin/notification-templates/${encodeURIComponent(id)}/approve`, { method: 'POST' });
}

export function listNotificationDeliveries(params: { status?: string; cursor?: string } = {}): Promise<{ items: NotificationDelivery[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ limit: '50' });
  if (params.status !== undefined && params.status !== '') q.set('status', params.status);
  if (params.cursor !== undefined) q.set('cursor', params.cursor);
  return apiFetch(`/admin/notification-deliveries?${q.toString()}`);
}

/** Runs one bounded consume + deliver pass. Never sends anything the gates disallow. */
export function processNotifications(): Promise<{ consumed: unknown; delivered: unknown }> {
  return apiFetch('/admin/notifications/process', { method: 'POST', body: JSON.stringify({ limit: 100 }) });
}
