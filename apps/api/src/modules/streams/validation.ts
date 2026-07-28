import { ValidationError, type FieldError } from '../../shared/errors.ts';
import { isEntityId } from '../../shared/ids.ts';
import {
  ACCESS_MODES,
  LOCALES,
  type AccessMode,
  type ArchivePolicy,
  type StreamLinks,
  type StreamRecord,
  type StreamTranslation
} from './state.ts';

/**
 * Pure validators and builders for stream configuration (FORM-016). Each `build*`
 * returns the canonical stored shape or throws, so the service never has to reason
 * about half-validated input.
 */

const TITLE_MAX = 160;
const SUMMARY_MAX = 600;
const CHANNEL_KEY_MAX = 64;
/** Bounded so a single stream cannot carry an unbounded relationship fan-out. */
const MAX_LINKS_PER_KIND = 50;
const CHANNEL_KEY = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/** Plain boolean wrapper: the `value is EntityId` guard would narrow a rejected id to `never`. */
function looksLikeId(value: string): boolean {
  return isEntityId(value);
}

function trimField(value: string | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max);
}

export function buildTranslation(
  input: Partial<StreamTranslation> | undefined,
  previous: StreamTranslation
): StreamTranslation {
  return {
    title: trimField(input?.title ?? previous.title, TITLE_MAX),
    summary: trimField(input?.summary ?? previous.summary, SUMMARY_MAX)
  };
}

export function emptyTranslation(): StreamTranslation {
  return { title: '', summary: '' };
}

export function validateAccessMode(value: unknown, fallback: AccessMode): AccessMode {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (ACCESS_MODES as readonly string[]).includes(value)) return value as AccessMode;
  throw new ValidationError('The access mode is not valid.', [
    { field: 'accessMode', code: 'INVALID_ACCESS_MODE', message: `Use one of: ${ACCESS_MODES.join(', ')}.` }
  ]);
}

/** ISO-8601 instant, or null. Times are stored in UTC (DEC-005). */
export function parseDate(value: string | null | undefined, field: string, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('A date is not valid.', [
      { field, code: 'INVALID_DATE', message: 'Use an ISO-8601 date and time.' }
    ]);
  }
  return parsed.toISOString();
}

/** The window must be ordered; an equal start and end is an empty window and is rejected. */
export function assertScheduleOrdering(startAt: string | null, endAt: string | null): void {
  if (startAt === null || endAt === null) return;
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    throw new ValidationError('The schedule is not valid.', [
      { field: 'scheduledEndAt', code: 'INVALID_RANGE', message: 'The end time must be after the start time.' }
    ]);
  }
}

function idList(values: unknown, field: string): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new ValidationError('A relationship list is not valid.', [
      { field, code: 'INVALID_LIST', message: 'Provide a list of identifiers.' }
    ]);
  }
  // Duplicates carry no meaning in a link set and would distort the reverse lookup.
  const unique = [...new Set(values.map((v) => String(v).trim()).filter((v) => v !== ''))];
  if (unique.length > MAX_LINKS_PER_KIND) {
    throw new ValidationError('Too many linked records.', [
      { field, code: 'TOO_MANY_LINKS', message: `Link at most ${String(MAX_LINKS_PER_KIND)} records.` }
    ]);
  }
  const problems: FieldError[] = unique
    .filter((value) => !looksLikeId(value))
    .map((value) => ({ field, code: 'INVALID_ID', message: `"${value.slice(0, 40)}" is not an identifier.` }));
  if (problems.length > 0) throw new ValidationError('A linked identifier is not valid.', problems);
  return unique;
}

function channelKeys(values: unknown): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new ValidationError('The channel list is not valid.', [
      { field: 'links.channelKeys', code: 'INVALID_LIST', message: 'Provide a list of channel keys.' }
    ]);
  }
  const unique = [...new Set(values.map((v) => String(v).trim().toLowerCase().slice(0, CHANNEL_KEY_MAX)).filter((v) => v !== ''))];
  if (unique.length > MAX_LINKS_PER_KIND) {
    throw new ValidationError('Too many linked channels.', [
      { field: 'links.channelKeys', code: 'TOO_MANY_LINKS', message: `Link at most ${String(MAX_LINKS_PER_KIND)} channels.` }
    ]);
  }
  const problems: FieldError[] = unique
    .filter((value) => !CHANNEL_KEY.test(value))
    .map((value) => ({ field: 'links.channelKeys', code: 'INVALID_CHANNEL_KEY', message: `"${value.slice(0, 40)}" is not a channel key.` }));
  if (problems.length > 0) throw new ValidationError('A channel key is not valid.', problems);
  return unique;
}

export interface LinksInput {
  gameIds?: unknown;
  tournamentIds?: unknown;
  matchIds?: unknown;
  channelKeys?: unknown;
  streamerAccountIds?: unknown;
}

/** STREAM-004: every relationship kind is optional, so an unlinked stream is valid. */
export function buildLinks(input: LinksInput | undefined, previous: StreamLinks): StreamLinks {
  if (input === undefined) return previous;
  return {
    gameIds: input.gameIds === undefined ? previous.gameIds : idList(input.gameIds, 'links.gameIds'),
    tournamentIds: input.tournamentIds === undefined ? previous.tournamentIds : idList(input.tournamentIds, 'links.tournamentIds'),
    matchIds: input.matchIds === undefined ? previous.matchIds : idList(input.matchIds, 'links.matchIds'),
    channelKeys: input.channelKeys === undefined ? previous.channelKeys : channelKeys(input.channelKeys),
    streamerAccountIds:
      input.streamerAccountIds === undefined ? previous.streamerAccountIds : idList(input.streamerAccountIds, 'links.streamerAccountIds')
  };
}

export function emptyLinks(): StreamLinks {
  return { gameIds: [], tournamentIds: [], matchIds: [], channelKeys: [], streamerAccountIds: [] };
}

const MAX_RETENTION_DAYS = 3650;

export interface ArchivePolicyInput {
  mode?: string;
  retentionDays?: number | null;
}

/**
 * STREAM-009. `rightsPolicyApproved` is the OD-014 gate: until the rights, retention,
 * takedown, and geographic policy is approved there is no approved archive duration to
 * store, so the policy is forced to `disabled` rather than guessed.
 */
export function buildArchivePolicy(
  input: ArchivePolicyInput | undefined,
  previous: ArchivePolicy,
  rightsPolicyApproved: boolean
): ArchivePolicy {
  if (!rightsPolicyApproved) {
    if (input?.mode === 'retain') {
      throw new ValidationError('Archive publication is not available yet.', [
        {
          field: 'archivePolicy.mode',
          code: 'ARCHIVE_POLICY_NOT_APPROVED',
          message: 'Stream rights, retention, and takedown policy (OD-014) has not been approved.'
        }
      ]);
    }
    return { mode: 'disabled', retentionDays: null };
  }
  if (input === undefined) return previous;
  const mode = input.mode ?? previous.mode;
  if (mode !== 'disabled' && mode !== 'retain') {
    throw new ValidationError('The archive policy is not valid.', [
      { field: 'archivePolicy.mode', code: 'INVALID_ARCHIVE_MODE', message: 'Use "disabled" or "retain".' }
    ]);
  }
  if (mode === 'disabled') return { mode, retentionDays: null };
  const retentionDays = input.retentionDays === undefined ? previous.retentionDays : input.retentionDays;
  if (retentionDays !== null && (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS)) {
    throw new ValidationError('The retention period is not valid.', [
      { field: 'archivePolicy.retentionDays', code: 'INVALID_RETENTION', message: `Use 1 to ${String(MAX_RETENTION_DAYS)} days.` }
    ]);
  }
  return { mode, retentionDays: retentionDays ?? null };
}

/** Poster reference: a site media path or an https URL (mirrors games/tournaments, MEDIA-006). */
export function validateCoverImage(url: string | null | undefined, fallback: string | null): string | null {
  if (url === undefined) return fallback;
  if (url === null || url === '') return null;
  const value = url.trim();
  if (value.startsWith('/') || value.startsWith('https://')) return value;
  throw new ValidationError('The cover image reference is not allowed.', [
    { field: 'coverImageUrl', code: 'INVALID_MEDIA_REF', message: 'Use a site path or an https URL.' }
  ]);
}

/**
 * Everything a stream needs before it can leave draft, reported together so an operator
 * fixes one form rather than rediscovering the next missing field on each attempt.
 *
 * Rights confirmation is in this list because section 27 requires it for publication and
 * OD-014 has not delegated that judgement to the platform.
 */
export function schedulingProblems(stream: StreamRecord): FieldError[] {
  const problems: FieldError[] = [];
  for (const locale of LOCALES) {
    if (stream.translations[locale].title.trim() === '') {
      problems.push({
        field: `translations.${locale}.title`,
        code: 'REQUIRED_FOR_SCHEDULING',
        message: `The ${locale} title is required before scheduling.`
      });
    }
  }
  if (stream.scheduledStartAt === null) {
    problems.push({ field: 'scheduledStartAt', code: 'REQUIRED_FOR_SCHEDULING', message: 'A scheduled start time is required.' });
  }
  if (!stream.rights.confirmed) {
    problems.push({
      field: 'rights.confirmed',
      code: 'RIGHTS_NOT_CONFIRMED',
      message: 'Confirm broadcast rights before scheduling this stream.'
    });
  }
  return problems;
}
