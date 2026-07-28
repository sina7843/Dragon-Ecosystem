import { apiFetch } from '../api.ts';
import type { Locale } from '../i18n/locale.ts';

/**
 * Typed client for the academy (EDU-001..012).
 *
 * Access is decided by the server on every learner call: the catalog and detail payloads
 * carry the curriculum outline only, and lesson bodies arrive through the enrolment routes
 * after the enrolment and entitlement are checked (BR-024). Nothing here gates content.
 */

export interface MoneyView {
  assetCode: 'IRR' | 'DRC';
  amountInteger: number;
  scale: number;
}

export type CourseState = 'draft' | 'review' | 'published' | 'unpublished' | 'archived';
export type AccessModel = 'free' | 'paid';
export type EnrollmentState = 'pending' | 'pending_payment' | 'active' | 'completed' | 'revoked' | 'refunded' | 'cancelled';

export interface CourseCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  gameId: string | null;
  accessModel: AccessModel;
  price: MoneyView[];
  coverImageUrl: string | null;
}

export interface CurriculumEntry {
  id: string;
  order: number;
  type: string;
  required: boolean;
  title: string;
}

export interface CourseDetail {
  id: string;
  slug: string;
  locale: Locale;
  title: string;
  summary: string;
  description: string;
  gameId: string | null;
  accessModel: AccessModel;
  price: MoneyView[];
  completionRule: { kind: string; thresholdPercent: number };
  coverImageUrl: string | null;
  curriculum: CurriculumEntry[];
  /** Approved public fields only (EDU-011). There is no coach page yet, so this is not linked. */
  coach: { id: string; slug: string; displayName: string; avatarUrl: string | null } | null;
  reviews: Array<{ id: string; rating: number; body: string; createdAt: string }>;
  /** The signed-in learner's own enrolment, when there is one. Drives the call to action. */
  myEnrollment: { id: string; state: EnrollmentState; entitlementState: string } | null;
}

export interface Enrollment {
  id: string;
  courseId: string;
  state: EnrollmentState;
  accessModel: AccessModel;
  entitlementState: 'none' | 'pending' | 'active' | 'revoked';
  paidAmount: MoneyView[];
  completedAt: string | null;
  createdAt: string;
}

/** One lesson as the learner sees it; a locked lesson arrives without its body or media. */
export interface LearnerLesson {
  id: string;
  order: number;
  type: string;
  required: boolean;
  title: string;
  body: string | null;
  mediaUrl: string | null;
  locked: boolean;
  percent: number;
  completed: boolean;
}

export interface LearnerCourse {
  enrollment: Enrollment;
  course: { id: string; slug: string; title: string; completionRule: { thresholdPercent: number } };
  lessons: LearnerLesson[];
}

export function listCourses(query: { locale: Locale; game?: string; accessModel?: AccessModel; q?: string }): Promise<{ items: CourseCard[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ locale: query.locale });
  for (const key of ['game', 'accessModel', 'q'] as const) {
    const value = query[key];
    if (value !== undefined && value !== '') params.set(key, value);
  }
  return apiFetch(`/courses?${params.toString()}`);
}

export function getCourse(slug: string, locale: Locale): Promise<CourseDetail> {
  return apiFetch(`/courses/${encodeURIComponent(slug)}?locale=${locale}`);
}

export function enroll(courseId: string): Promise<Enrollment> {
  return apiFetch(`/courses/${encodeURIComponent(courseId)}/enrollments`, { method: 'POST' });
}

/** Captures the reserved price for a paid enrolment. Idempotent server-side. */
export function activateEnrollment(enrollmentId: string): Promise<Enrollment> {
  return apiFetch(`/me/enrollments/${encodeURIComponent(enrollmentId)}/activate`, { method: 'POST' });
}

export function listMyEnrollments(): Promise<{ items: Enrollment[] }> {
  return apiFetch('/me/enrollments');
}

export function getLearnerCourse(enrollmentId: string, locale: Locale): Promise<LearnerCourse> {
  return apiFetch(`/me/enrollments/${encodeURIComponent(enrollmentId)}?locale=${locale}`);
}

export function recordProgress(enrollmentId: string, lessonId: string, percent: number): Promise<{ progress: { percent: number; completed: boolean }; enrollment: Enrollment }> {
  return apiFetch(`/me/enrollments/${encodeURIComponent(enrollmentId)}/lessons/${encodeURIComponent(lessonId)}/progress`, {
    method: 'PUT',
    body: JSON.stringify({ percent })
  });
}

export function reviewCourse(courseId: string, body: { rating: number; body: string }): Promise<{ id: string; state: string }> {
  return apiFetch(`/courses/${encodeURIComponent(courseId)}/reviews`, { method: 'POST', body: JSON.stringify(body) });
}

// --- Education administration (PAGE-054) ---

export interface AdminCourse {
  id: string;
  slug: string;
  state: CourseState;
  accessModel: AccessModel;
  price: MoneyView[];
  coachId: string | null;
  translations: Record<Locale, { title: string; summary: string; description: string }>;
  completionRule: { thresholdPercent: number };
  version: number;
  updatedAt: string;
}

export function getEducationConfig(): Promise<{ paidCoursesEnabled: boolean }> {
  return apiFetch('/admin/courses/config');
}

export function listAdminCourses(state?: CourseState): Promise<{ items: AdminCourse[]; nextCursor: string | null }> {
  return apiFetch(`/admin/courses${state === undefined ? '' : `?state=${state}`}`);
}

export function createCourse(body: { slug?: string; translations?: Partial<Record<Locale, { title?: string; summary?: string }>> }): Promise<AdminCourse> {
  return apiFetch('/admin/courses', { method: 'POST', body: JSON.stringify(body) });
}

export function setCourseState(id: string, body: { state: CourseState; expectedVersion: number; reason: string }): Promise<AdminCourse> {
  return apiFetch(`/admin/courses/${encodeURIComponent(id)}/state`, { method: 'POST', body: JSON.stringify(body) });
}

export function revokeEnrollment(id: string, reason: string): Promise<Enrollment> {
  return apiFetch(`/admin/enrollments/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });
}
