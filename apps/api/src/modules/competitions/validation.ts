import { ValidationError } from '../../shared/errors.ts';
import type { CompetitionFormat } from './state.ts';

/**
 * Competition configuration validation (BRACKET-007/011, UC-010). Rejects an
 * unsupported or internally inconsistent configuration before any generation.
 *
 * This slice (DRAGON-09a) implements single elimination and round robin only;
 * double elimination, Swiss, and manual/custom are validated as unsupported here
 * and delivered by DRAGON-09b.
 */

export const SUPPORTED_FORMATS: readonly CompetitionFormat[] = ['single_elimination', 'round_robin'];

/**
 * Per-format participant-count limits. Single elimination reaches the approved
 * 1,000 limit (DEC-046). Round robin is bounded lower here because it is generated
 * synchronously (N·(N−1)/2 matches per leg); larger round-robin at the 1,000 limit
 * is a background-job concern for DRAGON-09c.
 */
export const FORMAT_LIMITS: Readonly<Record<CompetitionFormat, { min: number; max: number }>> = {
  single_elimination: { min: 2, max: 1000 },
  round_robin: { min: 2, max: 64 }
};

const MAX_LEGS = 4;

export interface CompetitionConfig {
  format: string;
  participantIds: readonly string[];
  legs?: number;
}

/** Throws a localized ValidationError when the configuration cannot be generated. */
export function validateCompetitionConfig(config: CompetitionConfig): { format: CompetitionFormat; legs: number } {
  if (!SUPPORTED_FORMATS.includes(config.format as CompetitionFormat)) {
    throw new ValidationError('This competition format is not supported yet.', [
      { field: 'format', code: 'UNSUPPORTED_FORMAT', message: 'Choose single elimination or round robin.' }
    ]);
  }
  const format = config.format as CompetitionFormat;

  // Duplicate participants are rejected before counting (BRACKET-011).
  if (new Set(config.participantIds).size !== config.participantIds.length) {
    throw new ValidationError('The participant list contains duplicates.', [
      { field: 'participants', code: 'DUPLICATE_PARTICIPANT', message: 'Each participant may appear only once.' }
    ]);
  }

  const limit = FORMAT_LIMITS[format];
  if (config.participantIds.length < limit.min || config.participantIds.length > limit.max) {
    throw new ValidationError('The participant count is outside the allowed range for this format.', [
      { field: 'participants', code: 'INVALID_PARTICIPANT_COUNT', message: `This format allows between ${String(limit.min)} and ${String(limit.max)} participants.` }
    ]);
  }

  const legs = config.legs ?? 1;
  if (!Number.isInteger(legs) || legs < 1 || legs > MAX_LEGS) {
    throw new ValidationError('The number of legs is not valid.', [
      { field: 'legs', code: 'INVALID_LEGS', message: `Use between 1 and ${String(MAX_LEGS)} legs.` }
    ]);
  }
  if (format === 'single_elimination' && legs !== 1) {
    throw new ValidationError('Single elimination has a single leg.', [
      { field: 'legs', code: 'INVALID_LEGS', message: 'Single elimination does not support multiple legs.' }
    ]);
  }

  return { format, legs };
}
