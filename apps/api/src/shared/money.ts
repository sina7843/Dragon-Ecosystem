/**
 * Money value contract (DATA-061, section 15.1).
 *
 * CON-002: no monetary calculation may use binary floating-point arithmetic.
 * Every amount is a safe integer in the asset's minor unit; `scale` records how
 * many decimal places that minor unit represents.
 *
 * DEC-020: Toman values are stored as integer Iranian rial and displayed in Toman.
 * ASM-006 / DEC-049: Dragon Coin uses whole integer units.
 */

export const ASSET_CODES = ['IRR', 'DRC'] as const;

export type AssetCode = (typeof ASSET_CODES)[number];

export interface Money {
  readonly assetCode: AssetCode;
  readonly amountInteger: number;
  readonly scale: number;
}

/** Both supported assets are whole-unit: rial has no sub-unit, Dragon Coin has no fractional coin. */
const ASSET_SCALE: Readonly<Record<AssetCode, number>> = { IRR: 0, DRC: 0 };

/** 1 Toman = 10 rial. The user-facing convention only; rial remains the stored unit. */
export const RIAL_PER_TOMAN = 10;

export function isAssetCode(value: unknown): value is AssetCode {
  return typeof value === 'string' && (ASSET_CODES as readonly string[]).includes(value);
}

function assertSafeInteger(amount: number, label: string): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`${label} must be a safe integer, received ${String(amount)}`);
  }
}

export function money(assetCode: AssetCode, amountInteger: number): Money {
  if (!isAssetCode(assetCode)) throw new TypeError(`Unknown asset code ${String(assetCode)}`);
  assertSafeInteger(amountInteger, 'amountInteger');
  return { assetCode, amountInteger, scale: ASSET_SCALE[assetCode] };
}

export const rial = (amountInteger: number): Money => money('IRR', amountInteger);
export const dragonCoin = (amountInteger: number): Money => money('DRC', amountInteger);

function assertSameAsset(a: Money, b: Money): void {
  if (a.assetCode !== b.assetCode) {
    throw new TypeError(`Cannot combine ${a.assetCode} with ${b.assetCode}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameAsset(a, b);
  return money(a.assetCode, a.amountInteger + b.amountInteger);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameAsset(a, b);
  return money(a.assetCode, a.amountInteger - b.amountInteger);
}

/** Quantity multiplication, e.g. unit price by item count. Fractional factors are rejected. */
export function multiplyMoney(value: Money, factor: number): Money {
  assertSafeInteger(factor, 'factor');
  return money(value.assetCode, value.amountInteger * factor);
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameAsset(a, b);
  if (a.amountInteger < b.amountInteger) return -1;
  return a.amountInteger > b.amountInteger ? 1 : 0;
}

export function isNegative(value: Money): boolean {
  return value.amountInteger < 0;
}

export function isZero(value: Money): boolean {
  return value.amountInteger === 0;
}

/** Converts a user-entered Toman amount into the stored rial value. */
export function tomanToRial(toman: number): Money {
  assertSafeInteger(toman, 'toman');
  return rial(toman * RIAL_PER_TOMAN);
}

/**
 * Splits a stored rial amount into Toman for display plus any rial remainder.
 * Returning the remainder keeps the conversion lossless: callers must decide how
 * to present it instead of silently rounding money away.
 */
export function rialToTomanParts(value: Money): { toman: number; rialRemainder: number } {
  if (value.assetCode !== 'IRR') throw new TypeError(`Expected IRR, received ${value.assetCode}`);
  const sign = value.amountInteger < 0 ? -1 : 1;
  const magnitude = Math.abs(value.amountInteger);
  return {
    toman: sign * Math.trunc(magnitude / RIAL_PER_TOMAN),
    rialRemainder: sign * (magnitude % RIAL_PER_TOMAN)
  };
}
