/**
 * Event-to-template mapping (DRAGON-13).
 *
 * A code-owned map turns a domain event into a notification: which in-app template
 * key to show, which channels are candidates, the recipient field in the event
 * payload, and which payload fields carry through as bounded params. Only
 * transactional events are mapped here — marketing never reuses a transactional
 * mapping, and marketing consent is a separate preference class (OD-008 gated).
 */

export type NotificationChannel = 'in_app' | 'sms' | 'email';
export type NotificationCategory = 'transactional' | 'marketing';

export interface EventTemplate {
  readonly eventName: string;
  /** Stable template key: an i18n key for the in-app inbox and the logical key for SMS/email templates. */
  readonly templateKey: string;
  readonly category: NotificationCategory;
  /** Payload field holding the recipient account id. */
  readonly recipientField: 'accountId' | 'subjectId' | 'ownerId';
  readonly channels: readonly NotificationChannel[];
  /** Payload fields carried into the notification params (bounded, non-sensitive). */
  readonly paramFields: readonly string[];
}

export const EVENT_TEMPLATES: readonly EventTemplate[] = [
  { eventName: 'tournament.registration.approved', templateKey: 'registration_approved', category: 'transactional', recipientField: 'subjectId', channels: ['in_app', 'sms'], paramFields: ['tournamentId'] },
  { eventName: 'checkout.activated', templateKey: 'registration_confirmed', category: 'transactional', recipientField: 'accountId', channels: ['in_app', 'sms'], paramFields: ['tournamentId'] },
  { eventName: 'payment.purchase_succeeded', templateKey: 'coins_added', category: 'transactional', recipientField: 'accountId', channels: ['in_app'], paramFields: ['dragonCoin'] },
  { eventName: 'prize.entitlement_paid', templateKey: 'prize_paid', category: 'transactional', recipientField: 'accountId', channels: ['in_app'], paramFields: ['tournamentId'] },
  // STREAM-011: a moved or cancelled stream schedule reaches the assigned streamers. SMS
  // is a candidate channel, so it is only delivered where the OD-008 gate is on; the
  // in-app notification is always recorded, and every attempt is written either way.
  { eventName: 'stream.schedule_changed', templateKey: 'stream_schedule_changed', category: 'transactional', recipientField: 'accountId', channels: ['in_app', 'sms'], paramFields: ['streamSlug', 'scheduledStartAt'] },
  // EDU/NOTIF-010: education registers its event through this shared map rather than
  // keeping a notification table of its own. In-app only — a course completion is not
  // urgent enough to justify an SMS under the OD-008 channel policy.
  { eventName: 'course.completed', templateKey: 'course_completed', category: 'transactional', recipientField: 'accountId', channels: ['in_app'], paramFields: ['courseSlug'] },
  // NOTIF-011: a community mention notifies the mentioned account in-app only. Push is a
  // separate channel gated by OD-027 and is deliberately absent from this list, so no
  // community activity can leave the product through push while that decision is open.
  // The params carry ids and a surface name — never the post body, which would leak the
  // text of a post the recipient may not be allowed to read.
  { eventName: 'social.mentioned', templateKey: 'social_mentioned', category: 'transactional', recipientField: 'accountId', channels: ['in_app'], paramFields: ['postId', 'surface'] }
];

const BY_EVENT = new Map(EVENT_TEMPLATES.map((template) => [template.eventName, template]));

export function templateForEvent(eventName: string): EventTemplate | undefined {
  return BY_EVENT.get(eventName);
}

/** Every template key referenced by the mapping — used to validate admin SMS/email templates. */
export const KNOWN_TEMPLATE_KEYS: readonly string[] = [...new Set(EVENT_TEMPLATES.map((t) => t.templateKey))];

/** Renders a stored template body by replacing `{param}` placeholders with bounded param values. */
export function renderTemplate(body: string, params: Readonly<Record<string, string | number>>): string {
  return body.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
}
