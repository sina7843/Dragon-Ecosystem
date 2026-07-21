import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '../api.ts';

/**
 * Maps server error codes to localized messages (section 13.1).
 *
 * The API returns stable machine-readable codes; the localized wording lives in
 * the locale bundles, so no server string is ever shown to a user.
 */
export function useApiErrors(): {
  messageFor: (error: unknown) => string;
  fieldMessage: (error: unknown, field: string) => string | undefined;
} {
  const { t, te } = useI18n();

  function localize(code: string, fallbackKey: string): string {
    const key = `error.code.${code}`;
    return te(key) ? t(key) : t(fallbackKey);
  }

  function messageFor(error: unknown): string {
    if (!(error instanceof ApiRequestError)) return t('error.code.UNEXPECTED');
    return localize(error.body.code, 'error.code.UNEXPECTED');
  }

  function fieldMessage(error: unknown, field: string): string | undefined {
    if (!(error instanceof ApiRequestError)) return undefined;
    const fieldError = error.fieldError(field);
    if (fieldError === undefined) return undefined;
    return localize(fieldError.code, 'error.code.UNEXPECTED');
  }

  return { messageFor, fieldMessage };
}
