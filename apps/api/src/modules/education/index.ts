/** Public surface of the education module (section 32.1). */
export { EducationService, type EducationConfig, type CourseInput, type LessonInput, type LearnerLessonView } from './service.ts';
export { registerEducationRoutes, type EducationDeps } from './routes.ts';
export { educationMigration } from './migrations.ts';
export { EDUCATION_COLLECTIONS, EDUCATION_INDEXES } from './collections.ts';
export {
  ACCESS_MODELS,
  ACTIVE_ENROLLMENT_STATES,
  COURSE_STATES,
  ENROLLMENT_STATES,
  LESSON_TYPES,
  REVIEW_STATES,
  canCourseTransition,
  canEnrollmentTransition,
  grantsCourseAccess,
  isCourseComplete,
  isCoursePubliclyReadable,
  type AccessModel,
  type CoachProfileRecord,
  type CourseRecord,
  type CourseReviewRecord,
  type CourseState,
  type EnrollmentRecord,
  type EnrollmentState,
  type LessonRecord,
  type LessonProgressRecord
} from './state.ts';
