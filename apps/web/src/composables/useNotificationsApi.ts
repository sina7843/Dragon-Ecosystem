import { apiFetch } from '../api.ts';

/**
 * In-app notification client (DRAGON-13). Notifications are localized client-side
 * from `templateKey` + `params`; the server never sends a rendered string or any
 * recipient contact detail.
 */

export interface NotificationView {
  id: string;
  templateKey: string;
  category: 'transactional' | 'marketing';
  params: Record<string, string | number>;
  read: boolean;
  createdAt: string;
}

export function listNotifications(cursor?: string): Promise<{ items: NotificationView[]; nextCursor: string | null }> {
  const q = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return apiFetch(`/notifications${q}`);
}

export function unreadCount(): Promise<{ unread: number }> {
  return apiFetch('/notifications/unread-count');
}

export function markNotificationRead(id: string): Promise<NotificationView> {
  return apiFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch('/notifications/read-all', { method: 'POST' });
}
