import { ValidationError, type FieldError } from '../../shared/errors.ts';
import { dragonCoin, tomanToRial, type Money } from '../../shared/money.ts';
import {
  LOCALES,
  MAX_CAPACITY,
  PARTICIPANT_TYPES,
  TOURNAMENT_FORMATS,
  type CustomQuestion,
  type Eligibility,
  type FeeDefinition,
  type FeeKind,
  type Locale,
  type ParticipantType,
  type PrizeDefinition,
  type QuestionSet,
  type QuestionType,
  type RefundPolicy,
  type RuleProfile,
  type TournamentFormat,
  type TournamentRecord,
  type TournamentTranslation
} from './state.ts';

/**
 * Pure validators and builders for tournament configuration. Each `build*` returns
 * the canonical stored shape or throws a localized `ValidationError`; money amounts
 * are enforced as exact non-negative integers (CON-002, TOURN-012).
 */

const TEXT_MAX = 4000;
const NAME_MAX = 120;

/**
 * Domain ceiling for a single money amount. Kept well under
 * `Number.MAX_SAFE_INTEGER / 10` so converting Toman to rial (×10) can never
 * overflow the safe-integer range and surface as an opaque 500 instead of a 422.
 */
const MAX_AMOUNT = 1_000_000_000_000;

function trimField(value: string | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max);
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_AMOUNT) {
    throw new ValidationError('An amount is not valid.', [
      { field, code: 'INVALID_AMOUNT', message: 'Use a whole number greater than zero.' }
    ]);
  }
  return value;
}

// --- Fees (TOURN-012) ---

export interface FeeInput {
  kind: FeeKind;
  tomanAmount?: number;
  dragonCoinAmount?: number;
}

export function buildFee(input: FeeInput | undefined): FeeDefinition {
  const kind = input?.kind ?? 'free';
  switch (kind) {
    case 'free':
      return { kind: 'free', components: [] };
    case 'toman':
      return { kind: 'toman', components: [tomanToRial(positiveInt(input?.tomanAmount, 'fee.tomanAmount'))] };
    case 'dragon_coin':
      return { kind: 'dragon_coin', components: [dragonCoin(positiveInt(input?.dragonCoinAmount, 'fee.dragonCoinAmount'))] };
    case 'mixed':
      return {
        kind: 'mixed',
        components: [
          tomanToRial(positiveInt(input?.tomanAmount, 'fee.tomanAmount')),
          dragonCoin(positiveInt(input?.dragonCoinAmount, 'fee.dragonCoinAmount'))
        ]
      };
    default:
      throw new ValidationError('The fee type is not valid.', [
        { field: 'fee.kind', code: 'INVALID_FEE_KIND', message: 'Choose free, toman, dragon_coin, or mixed.' }
      ]);
  }
}

// --- Prizes (versioned) ---

export interface PrizeInput {
  placements?: Array<{ rank: number; tomanAmount?: number; dragonCoinAmount?: number }>;
}

/** Builds a prize definition. `previousVersion` is bumped only when the placements change. */
export function buildPrizes(input: PrizeInput | undefined, previous: PrizeDefinition): PrizeDefinition {
  if (input === undefined || input.placements === undefined) return previous;
  const seenRanks = new Set<number>();
  const placements = input.placements.map((p) => {
    if (!Number.isSafeInteger(p.rank) || p.rank <= 0) {
      throw new ValidationError('A prize rank is not valid.', [
        { field: 'prizes.rank', code: 'INVALID_RANK', message: 'Use a whole rank greater than zero.' }
      ]);
    }
    if (seenRanks.has(p.rank)) {
      throw new ValidationError('Prize ranks must be unique.', [
        { field: 'prizes.rank', code: 'DUPLICATE_RANK', message: 'Each placement rank must be unique.' }
      ]);
    }
    seenRanks.add(p.rank);
    const rewards: Money[] = [];
    if (p.tomanAmount !== undefined) rewards.push(tomanToRial(positiveInt(p.tomanAmount, 'prizes.tomanAmount')));
    if (p.dragonCoinAmount !== undefined) rewards.push(dragonCoin(positiveInt(p.dragonCoinAmount, 'prizes.dragonCoinAmount')));
    if (rewards.length === 0) {
      throw new ValidationError('A prize placement needs a reward.', [
        { field: 'prizes.rewards', code: 'EMPTY_PRIZE', message: 'Add a Toman or Dragon Coin reward.' }
      ]);
    }
    return { rank: p.rank, rewards };
  });
  placements.sort((a, b) => a.rank - b.rank);
  const changed = JSON.stringify(placements) !== JSON.stringify(previous.placements);
  return changed ? { version: previous.version + 1, placements } : previous;
}

// --- Custom questions (versioned answers, TOURN-007) ---

export interface QuestionInput {
  key?: string;
  prompt: Record<Locale, string>;
  type: QuestionType;
  required?: boolean;
  options?: Array<Record<Locale, string>>;
  page?: number;
}

const QUESTION_TYPES: readonly QuestionType[] = [
  'short_text',
  'long_text',
  'number',
  'national_id',
  'single_choice',
  'multi_choice',
  'file',
  'image'
];

/** Types that present a fixed option list and therefore need at least two of them. */
const CHOICE_TYPES: readonly QuestionType[] = ['single_choice', 'multi_choice'];

/**
 * Upper bound on form length and depth. Generous for a real entry form, but bounded so a
 * question set cannot grow without limit and every registration then has to carry it.
 */
const MAX_QUESTIONS = 60;
const MAX_PAGES = 10;

export function buildQuestions(input: QuestionInput[] | undefined, previous: QuestionSet): QuestionSet {
  if (input === undefined) return previous;
  if (input.length > MAX_QUESTIONS) {
    throw new ValidationError('The form has too many questions.', [
      { field: 'questions', code: 'TOO_MANY_QUESTIONS', message: `Use at most ${String(MAX_QUESTIONS)} questions.` }
    ]);
  }
  const seen = new Set<string>();
  const questions: CustomQuestion[] = input.map((q, index) => {
    if (!QUESTION_TYPES.includes(q.type)) {
      throw new ValidationError('A question type is not valid.', [
        { field: `questions.${String(index)}.type`, code: 'INVALID_QUESTION_TYPE', message: 'Choose a supported question type.' }
      ]);
    }
    const prompt = { fa: trimField(q.prompt?.fa, NAME_MAX), en: trimField(q.prompt?.en, NAME_MAX) };
    if (prompt.fa === '' || prompt.en === '') {
      throw new ValidationError('A question needs both languages.', [
        { field: `questions.${String(index)}.prompt`, code: 'INCOMPLETE_QUESTION', message: 'Provide the question in both languages.' }
      ]);
    }
    const key = (q.key ?? `q${String(index + 1)}`).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    if (seen.has(key)) {
      throw new ValidationError('Question keys must be unique.', [
        { field: `questions.${String(index)}.key`, code: 'DUPLICATE_QUESTION_KEY', message: 'Each question key must be unique.' }
      ]);
    }
    seen.add(key);
    const isChoice = CHOICE_TYPES.includes(q.type);
    const options = isChoice
      ? (q.options ?? []).map((o) => ({ fa: trimField(o.fa, NAME_MAX), en: trimField(o.en, NAME_MAX) }))
      : [];
    if (isChoice && options.length < 2) {
      throw new ValidationError('A choice question needs options.', [
        { field: `questions.${String(index)}.options`, code: 'INSUFFICIENT_OPTIONS', message: 'Provide at least two options.' }
      ]);
    }
    if (isChoice && options.some((o) => o.fa === '' || o.en === '')) {
      throw new ValidationError('An option needs both languages.', [
        { field: `questions.${String(index)}.options`, code: 'INCOMPLETE_OPTION', message: 'Provide each option in both languages.' }
      ]);
    }
    // Unspecified means page 1, so an existing single-page form stays valid untouched.
    const page = q.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGES) {
      throw new ValidationError('A question page is not valid.', [
        { field: `questions.${String(index)}.page`, code: 'INVALID_QUESTION_PAGE', message: `Use a page between 1 and ${String(MAX_PAGES)}.` }
      ]);
    }
    return { key, prompt, type: q.type, required: q.required ?? false, options, page };
  });

  // Pages must be contiguous from 1: a form that jumps from page 1 to page 3 would show
  // an empty step, which reads as a broken form rather than a deliberate one.
  const pages = [...new Set(questions.map((q) => q.page))].sort((a, b) => a - b);
  if (pages.some((page, i) => page !== i + 1)) {
    throw new ValidationError('Form pages must run in order from 1.', [
      { field: 'questions', code: 'NON_CONTIGUOUS_PAGES', message: 'Number the pages consecutively, starting at 1, with no gaps.' }
    ]);
  }
  const changed = JSON.stringify(questions) !== JSON.stringify(previous.questions);
  return changed ? { version: previous.version + 1, questions } : previous;
}

// --- Scalars ---

export function validateCapacity(value: number | undefined, previous: number): number {
  if (value === undefined) return previous;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CAPACITY) {
    throw new ValidationError('The capacity is not valid.', [
      { field: 'capacity', code: 'INVALID_CAPACITY', message: `Use between 1 and ${String(MAX_CAPACITY)} participants.` }
    ]);
  }
  return value;
}

export function validateParticipantType(value: string | undefined, previous: ParticipantType): ParticipantType {
  if (value === undefined) return previous;
  if (!PARTICIPANT_TYPES.includes(value as ParticipantType)) {
    throw new ValidationError('The participant type is not valid.', [
      { field: 'participantType', code: 'INVALID_PARTICIPANT_TYPE', message: 'Choose individual or team.' }
    ]);
  }
  return value as ParticipantType;
}

export function validateFormat(value: string | undefined, previous: TournamentFormat): TournamentFormat {
  if (value === undefined) return previous;
  if (!TOURNAMENT_FORMATS.includes(value as TournamentFormat)) {
    throw new ValidationError('The format is not valid.', [
      { field: 'format', code: 'INVALID_FORMAT', message: 'Choose a supported competition format.' }
    ]);
  }
  return value as TournamentFormat;
}

/** Parses an optional ISO date-time; returns null for blank, throws for malformed. */
export function parseDate(value: string | null | undefined, field: string, previous: string | null): string | null {
  if (value === undefined) return previous;
  if (value === null || value === '') return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new ValidationError('A date is not valid.', [
      { field, code: 'INVALID_DATE', message: 'Enter a valid date and time.' }
    ]);
  }
  return new Date(time).toISOString();
}

export function buildTranslation(
  input: Partial<TournamentTranslation> | undefined,
  previous: TournamentTranslation
): TournamentTranslation {
  const name = trimField(input?.name ?? previous.name, NAME_MAX);
  const summary = trimField(input?.summary ?? previous.summary, TEXT_MAX);
  const description = trimField(input?.description ?? previous.description, TEXT_MAX);
  return {
    name,
    summary,
    description,
    seoTitle: trimField(input?.seoTitle, NAME_MAX) || previous.seoTitle || name,
    seoDescription: trimField(input?.seoDescription, TEXT_MAX) || previous.seoDescription || summary
  };
}

export function buildRuleProfile(input: { text?: Record<Locale, string> } | undefined, previous: RuleProfile): RuleProfile {
  if (input === undefined || input.text === undefined) return previous;
  return { kind: 'custom', text: { fa: trimField(input.text.fa, TEXT_MAX), en: trimField(input.text.en, TEXT_MAX) } };
}

export function buildRefundPolicy(
  input: { kind?: RefundPolicy['kind']; text?: Record<Locale, string> } | undefined,
  previous: RefundPolicy
): RefundPolicy {
  if (input === undefined) return previous;
  const kind = input.kind ?? previous.kind;
  if (!['no_refund', 'until_start', 'custom'].includes(kind)) {
    throw new ValidationError('The refund policy is not valid.', [
      { field: 'refundPolicy.kind', code: 'INVALID_REFUND_KIND', message: 'Choose a supported refund policy.' }
    ]);
  }
  const text = input.text === undefined ? previous.text : { fa: trimField(input.text.fa, TEXT_MAX), en: trimField(input.text.en, TEXT_MAX) };
  return { kind, text };
}

export function buildEligibility(
  input: Partial<Eligibility> | undefined,
  previous: Eligibility
): Eligibility {
  if (input === undefined) return previous;
  let minAge = previous.minAge;
  if (input.minAge !== undefined) {
    if (input.minAge === null) minAge = null;
    else if (Number.isSafeInteger(input.minAge) && input.minAge >= 13 && input.minAge <= 120) minAge = input.minAge;
    else {
      throw new ValidationError('The minimum age is not valid.', [
        { field: 'eligibility.minAge', code: 'INVALID_MIN_AGE', message: 'Use an age between 13 and 120.' }
      ]);
    }
  }
  return {
    minAge,
    requireCompleteProfile: input.requireCompleteProfile ?? previous.requireCompleteProfile,
    requireGameIdentity: input.requireGameIdentity ?? previous.requireGameIdentity
  };
}

/**
 * Cross-field date ordering (TOURN-002, acceptance "invalid cross-field dates").
 * Enforced whenever the affected dates are present; publication additionally
 * requires them all to be set (see {@link publicationProblems}).
 */
export function dateOrderingProblems(record: Pick<TournamentRecord, 'registration' | 'schedule'>): FieldError[] {
  const { opensAt, closesAt } = record.registration;
  const { startAt, endAt } = record.schedule;
  const problems: FieldError[] = [];
  const outOfOrder = (a: string | null, b: string | null): boolean => a !== null && b !== null && Date.parse(a) >= Date.parse(b);
  if (outOfOrder(opensAt, closesAt)) problems.push({ field: 'registration.closesAt', code: 'DATE_ORDER', message: 'Registration must close after it opens.' });
  if (outOfOrder(closesAt, startAt)) problems.push({ field: 'schedule.startAt', code: 'DATE_ORDER', message: 'The tournament must start on or after registration closes.' });
  if (outOfOrder(startAt, endAt)) problems.push({ field: 'schedule.endAt', code: 'DATE_ORDER', message: 'The tournament must end after it starts.' });
  return problems;
}

export function assertDateOrdering(record: Pick<TournamentRecord, 'registration' | 'schedule'>): void {
  const problems = dateOrderingProblems(record);
  if (problems.length > 0) throw new ValidationError('The dates are out of order.', problems);
}

/**
 * TOURN-002: publication validation lists every missing or invalid mandatory value.
 * Returns an empty array when the tournament is publishable.
 */
export function publicationProblems(t: TournamentRecord): FieldError[] {
  const problems: FieldError[] = [];
  for (const locale of LOCALES) {
    const tr = t.translations[locale];
    for (const field of ['name', 'summary'] as const) {
      if (tr[field].trim() === '') {
        problems.push({ field: `translations.${locale}.${field}`, code: 'REQUIRED_FOR_PUBLICATION', message: `The ${locale} ${field} is required before publishing.` });
      }
    }
    if (t.ruleProfile.text[locale].trim() === '') {
      problems.push({ field: `ruleProfile.text.${locale}`, code: 'REQUIRED_FOR_PUBLICATION', message: `The ${locale} rules are required before publishing.` });
    }
  }
  const required: Array<[unknown, string]> = [
    [t.registration.opensAt, 'registration.opensAt'],
    [t.registration.closesAt, 'registration.closesAt'],
    [t.schedule.startAt, 'schedule.startAt'],
    [t.schedule.endAt, 'schedule.endAt']
  ];
  for (const [value, field] of required) {
    if (value === null) problems.push({ field, code: 'REQUIRED_FOR_PUBLICATION', message: `${field} is required before publishing.` });
  }
  return problems;
}
