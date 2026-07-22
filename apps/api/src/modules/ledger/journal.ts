import { createHash } from 'node:crypto';
import type { AssetCode } from '../../shared/money.ts';
import { ValidationError, type FieldError } from '../../shared/errors.ts';
import { ACCOUNT_TYPES, TRANSACTION_TYPES, accountIdentityKey, type AccountRef, type LedgerTransactionType } from './accounts.ts';
import type { BoundedMetadata } from './state.ts';

/**
 * Pure journal invariants and canonical hashing (DRAGON-11a).
 *
 * Everything here is database-independent so the accounting rules — balance to
 * zero, one asset/scale, no zero entries, safe integers — can be property-tested
 * in isolation. Nothing is ever stored partially balanced: a command that fails
 * any check throws before the posting transaction opens.
 */

export const MAX_ENTRIES = 64;
export const MAX_METADATA_KEYS = 16;
const MAX_STRING = 512;
const MAX_DESCRIPTION = 500;
const MAX_BUSINESS_REF = 200;

export interface PostEntryInput {
  readonly account: AccountRef;
  readonly amount: number;
  readonly reference?: BoundedMetadata;
}

export interface PostCommand {
  readonly type: LedgerTransactionType;
  readonly businessRef: string;
  readonly idempotencyKey: string;
  readonly description: string;
  readonly entries: readonly PostEntryInput[];
  readonly metadata?: BoundedMetadata;
  readonly effectiveAt?: string;
}

export interface JournalLeg {
  readonly account: AccountRef;
  readonly identityKey: string;
  readonly amount: number;
  readonly lineNumber: number;
  readonly reference: BoundedMetadata | null;
}

export interface Journal {
  readonly assetCode: AssetCode;
  readonly scale: number;
  readonly legs: readonly JournalLeg[];
  /** Canonical semantic hash for idempotency; independent of entry order and metadata. */
  readonly canonicalHash: string;
}

function fail(code: string, message: string, field = 'entries'): never {
  throw new ValidationError('The ledger transaction is not valid.', [{ field, code, message } satisfies FieldError]);
}

function assertSafeInteger(amount: number): void {
  if (!Number.isSafeInteger(amount)) fail('UNSAFE_INTEGER', 'An amount must be a safe integer.', 'amount');
}

export function validateMetadata(metadata: BoundedMetadata | undefined, field = 'metadata'): BoundedMetadata {
  if (metadata === undefined) return {};
  const keys = Object.keys(metadata);
  if (keys.length > MAX_METADATA_KEYS) fail('METADATA_TOO_LARGE', `Use at most ${String(MAX_METADATA_KEYS)} metadata keys.`, field);
  for (const key of keys) {
    const value = metadata[key];
    const okType = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    if (!okType) fail('METADATA_INVALID', 'Metadata values must be strings, numbers, or booleans.', field);
    if (typeof value === 'string' && value.length > MAX_STRING) fail('METADATA_INVALID', 'A metadata value is too long.', field);
    if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('METADATA_INVALID', 'A numeric metadata value must be a safe integer.', field);
  }
  return metadata;
}

/**
 * Validates the journal and returns its normalized legs plus canonical hash.
 * `expectedAsset` pins the asset for a compensation (which inherits the reversed
 * transaction's asset); for ordinary types the transaction-type policy pins it.
 */
export function buildJournal(command: PostCommand, expectedAsset?: AssetCode): Journal {
  if (!(command.type in TRANSACTION_TYPES)) fail('UNSUPPORTED_TRANSACTION_TYPE', 'That ledger transaction type is not supported.', 'type');
  if (command.businessRef.trim() === '' || command.businessRef.length > MAX_BUSINESS_REF) fail('INVALID_BUSINESS_REFERENCE', 'A business reference is required.', 'businessRef');
  if (command.idempotencyKey.trim() === '') fail('INVALID_IDEMPOTENCY_KEY', 'An idempotency key is required.', 'idempotencyKey');
  if (command.description.trim() === '' || command.description.length > MAX_DESCRIPTION) fail('INVALID_DESCRIPTION', 'A description is required.', 'description');
  validateMetadata(command.metadata);

  const entries = command.entries;
  if (entries.length < 2) fail('TOO_FEW_ENTRIES', 'A transaction needs at least two entries.');
  if (entries.length > MAX_ENTRIES) fail('TOO_MANY_ENTRIES', `A transaction may not exceed ${String(MAX_ENTRIES)} entries.`);

  const policy = TRANSACTION_TYPES[command.type];
  let assetCode: AssetCode | undefined = expectedAsset ?? policy.assetCode ?? undefined;
  let scale: number | undefined;
  let sum = 0;

  const legs: JournalLeg[] = entries.map((entry, index) => {
    if (!(entry.account.accountType in ACCOUNT_TYPES)) fail('UNKNOWN_ACCOUNT_TYPE', 'An account type is not recognized.', 'account');
    const accountPolicy = ACCOUNT_TYPES[entry.account.accountType];
    if (policy.allowedAccountTypes !== 'any' && !policy.allowedAccountTypes.includes(entry.account.accountType)) {
      fail('INVALID_ACCOUNT_RELATIONSHIP', 'That account type is not allowed for this transaction type.', 'account');
    }
    assertSafeInteger(entry.amount);
    if (entry.amount === 0) fail('ZERO_ENTRY', 'A ledger entry cannot be zero.', 'amount');

    // One asset and one scale per transaction.
    if (assetCode === undefined) assetCode = accountPolicy.assetCode;
    if (scale === undefined) scale = accountPolicy.scale;
    if (accountPolicy.assetCode !== assetCode) fail('MIXED_ASSET', 'A transaction cannot mix asset codes.', 'account');
    if (accountPolicy.scale !== scale) fail('MIXED_SCALE', 'A transaction cannot mix scales.', 'account');

    sum += entry.amount;
    if (!Number.isSafeInteger(sum)) fail('AMOUNT_OVERFLOW', 'The transaction total exceeds the safe integer range.', 'amount');

    return {
      account: entry.account,
      identityKey: accountIdentityKey(entry.account),
      amount: entry.amount,
      lineNumber: index,
      reference: entry.reference === undefined ? null : validateMetadata(entry.reference, 'reference')
    };
  });

  if (assetCode === undefined || scale === undefined) fail('UNSUPPORTED_TRANSACTION_TYPE', 'The transaction asset could not be resolved.', 'type');
  if (sum !== 0) fail('UNBALANCED_TRANSACTION', 'The entries must sum to exactly zero.');

  return { assetCode, scale, legs, canonicalHash: canonicalHash(command.type, command.businessRef, assetCode, scale, legs) };
}

/**
 * Canonical semantic hash: type, business reference, asset, scale, and the legs
 * sorted by identity then amount. Entry order and volatile metadata never affect
 * it, so a genuine replay hashes identically and reordered legs are the same op.
 */
export function canonicalHash(type: string, businessRef: string, assetCode: AssetCode, scale: number, legs: readonly JournalLeg[]): string {
  const normalizedLegs = legs
    .map((leg) => ({ identityKey: leg.identityKey, amount: leg.amount }))
    .sort((a, b) => (a.identityKey < b.identityKey ? -1 : a.identityKey > b.identityKey ? 1 : a.amount - b.amount));
  const canonical = JSON.stringify({ type, businessRef, assetCode, scale, legs: normalizedLegs });
  return createHash('sha256').update(canonical).digest('hex');
}
