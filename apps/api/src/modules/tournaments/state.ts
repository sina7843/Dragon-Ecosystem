import type { Money } from '../../shared/money.ts';
import type { EntityId } from '../../shared/ids.ts';

/**
 * Tournament definition, lifecycle, fee, prize, and question shapes (TOURN-001..030
 * authoring scope). Registration, matches, brackets, and payment execution belong
 * to later prompts; this module owns the tournament *definition* and discovery.
 *
 * Lifecycle (TOURN-001, acceptance): draft → published, with cancel and archive,
 * plus a reserved `completed` state that only the competition engine (DRAGON-09)
 * may reach. A draft is never publicly visible.
 */

export const TOURNAMENT_STATES = ['draft', 'published', 'cancelled', 'completed', 'archived'] as const;
export type TournamentState = (typeof TOURNAMENT_STATES)[number];

const ALLOWED: Readonly<Record<TournamentState, readonly TournamentState[]>> = {
  draft: ['published', 'cancelled', 'archived'],
  published: ['cancelled', 'completed'],
  cancelled: ['archived'],
  completed: ['archived'],
  archived: []
};

export function canTournamentTransition(from: TournamentState, to: TournamentState): boolean {
  return ALLOWED[from].includes(to);
}

export const LOCALES = ['fa', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** DEC-046: the approved maximum tournament size. */
export const MAX_CAPACITY = 1000;

export type ParticipantType = 'individual' | 'team';
export const PARTICIPANT_TYPES: readonly ParticipantType[] = ['individual', 'team'];

/** The five required competition-format families (GOAL-003). Bracket generation is DRAGON-09/10. */
export type TournamentFormat = 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss' | 'custom';
export const TOURNAMENT_FORMATS: readonly TournamentFormat[] = [
  'single_elimination',
  'double_elimination',
  'round_robin',
  'swiss',
  'custom'
];

export type ApprovalMode = 'automatic' | 'manual';
export type WaitlistMode = 'enabled' | 'disabled';

export type FeeKind = 'free' | 'toman' | 'dragon_coin' | 'mixed';

/**
 * Canonical fee definition (TOURN-012). Components are stored as {@link Money}, so
 * Toman is held as integer rial (DEC-020) and Dragon Coin as whole units. No
 * payment is executed in this prompt; this is the priced definition only.
 */
export interface FeeDefinition {
  kind: FeeKind;
  components: Money[];
}

export type RefundKind = 'no_refund' | 'until_start' | 'custom';
export interface RefundPolicy {
  kind: RefundKind;
  text: Record<Locale, string>;
}

export interface PrizePlacement {
  rank: number;
  rewards: Money[];
}

/** Versioned prize definition (TOURN acceptance): each edit bumps `version`. */
export interface PrizeDefinition {
  version: number;
  placements: PrizePlacement[];
}

/**
 * Question types an organizer can put on a registration form.
 *
 * `national_id` is a checked identity number rather than free text, so a typo is caught
 * at submission instead of at check-in. `file` and `image` hold a reference to an already
 * uploaded asset — the answer never carries bytes, only the `/media/<id>` path the media
 * service returned, so uploads keep going through the one validated path.
 */
export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'national_id'
  | 'single_choice'
  | 'multi_choice'
  | 'file'
  | 'image';

export interface CustomQuestion {
  key: string;
  prompt: Record<Locale, string>;
  type: QuestionType;
  required: boolean;
  options: Array<Record<Locale, string>>;
  /**
   * 1-based step in a multi-page form. Every question carries one; a single-page form is
   * simply every question on page 1, so there is no separate "is this paged" flag to
   * disagree with the questions themselves.
   */
  page: number;
}

/** Versioned question set (TOURN-007): submitted answers are stamped with `version`. */
export interface QuestionSet {
  version: number;
  questions: CustomQuestion[];
}

/** Highest page number in a set; 1 when the form has no questions. */
export function questionPageCount(set: QuestionSet): number {
  return set.questions.reduce((max, question) => Math.max(max, question.page), 1);
}

export interface Eligibility {
  minAge: number | null;
  requireCompleteProfile: boolean;
  requireGameIdentity: boolean;
}

export interface TournamentTranslation {
  name: string;
  summary: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
}

export interface RuleProfile {
  /**
   * OD-006 gates approved game/publisher/federation rule profiles; until one is
   * approved only `custom` free-text rules are available, so a tournament using
   * custom rules is publishable while named profiles stay out of scope.
   */
  kind: 'custom';
  text: Record<Locale, string>;
}

export interface TournamentRecord {
  _id: EntityId;
  slug: string;
  state: TournamentState;
  translations: Record<Locale, TournamentTranslation>;
  gameId: EntityId;
  participantType: ParticipantType;
  capacity: number;
  registration: { opensAt: string | null; closesAt: string | null };
  schedule: { startAt: string | null; endAt: string | null };
  format: TournamentFormat;
  ruleProfile: RuleProfile;
  approvalMode: ApprovalMode;
  waitlistMode: WaitlistMode;
  /**
   * Whether the approved participant list is shown publicly (TOURN participant
   * visibility). Off by default so names are never exposed without an explicit
   * organizer choice; toggled from the admin panel in any state. Legacy records
   * predating this field read as private (`undefined` → not public).
   */
  participantsPublic: boolean;
  /** Poster image: a site media path (`/media/<id>`) or an https URL; null when unset. */
  coverImageUrl: string | null;
  eligibility: Eligibility;
  questionSet: QuestionSet;
  fee: FeeDefinition;
  refundPolicy: RefundPolicy;
  prizes: PrizeDefinition;
  version: number;
  organizerId: EntityId;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  cancelledAt: string | null;
}

export interface TournamentRevisionRecord {
  _id: EntityId;
  tournamentId: EntityId;
  version: number;
  snapshot: Omit<TournamentRecord, '_id'>;
  actorId: EntityId;
  reason: string;
  createdAt: string;
}
