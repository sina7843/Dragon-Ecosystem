import { ValidationError } from '../../shared/errors.ts';
import { addMoney, dragonCoin, money, multiplyMoney, rial, type AssetCode, type Money } from '../../shared/money.ts';
import type { DiscountRecord, ProductVariantRecord, ShippingAddress } from './state.ts';

/**
 * Server-side pricing (COMMERCE-004, COMMERCE-005, COMMERCE-009).
 *
 * Every total here is recomputed from the catalog at checkout. A client-supplied price is
 * never read — the cart's `unitPricePreview` exists to render a page, and the order is
 * priced from the variant row regardless of what the client believed.
 *
 * Arithmetic is exact integers per asset. Discounts are whole-percent so the reduction is
 * an integer division with an explicit rounding rule rather than a float.
 */

/** Settlement asset. Dragon Coin is what a store order is actually charged in. */
export const SETTLEMENT_ASSET: AssetCode = 'DRC';

const MAX_QUANTITY = 99;
const MAX_LINE_ITEMS = 50;

export interface PricedLine {
  variantId: string;
  quantity: number;
  unitPrice: Money[];
  lineSubtotal: Money[];
  lineDiscount: Money[];
  lineTotal: Money[];
}

export interface PricedCart {
  lines: PricedLine[];
  itemSubtotal: Money[];
  discountTotal: Money[];
  /** Always zero: OD-019 has approved no shipping-price rule, so none is charged. */
  shippingTotal: Money[];
  grandTotal: Money[];
  discountApplied: { code: string; version: number; percentOff: number } | null;
}

/** The settlement component of a money list, or zero when the list carries none. */
export function settlementAmount(amounts: readonly Money[]): number {
  return amounts.find((m) => m.assetCode === SETTLEMENT_ASSET)?.amountInteger ?? 0;
}

/** Sums two money lists per asset, so IRR and DRC components never mix. */
export function addMoneyLists(a: readonly Money[], b: readonly Money[]): Money[] {
  const byAsset = new Map<AssetCode, Money>();
  for (const value of [...a, ...b]) {
    const existing = byAsset.get(value.assetCode);
    byAsset.set(value.assetCode, existing === undefined ? value : addMoney(existing, value));
  }
  return [...byAsset.values()].sort((x, y) => x.assetCode.localeCompare(y.assetCode));
}

function zeroLike(amounts: readonly Money[]): Money[] {
  return amounts.map((m) => money(m.assetCode, 0));
}

/**
 * Applies a whole-percent discount to one money list.
 *
 * Rounds the *discount* down, which rounds the customer's total up by at most one minor
 * unit per line. That direction is deliberate: it can never produce a total below the sum
 * the merchant expects, and it keeps every figure an exact integer.
 */
function percentOf(amounts: readonly Money[], percent: number): Money[] {
  return amounts.map((m) => money(m.assetCode, Math.floor((m.amountInteger * percent) / 100)));
}

export function validQuantity(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 1 || (raw as number) > MAX_QUANTITY) {
    throw new ValidationError('That quantity is not valid.', [
      { field: 'quantity', code: 'INVALID_QUANTITY', message: `Use a whole number between 1 and ${String(MAX_QUANTITY)}.` }
    ]);
  }
  return raw as number;
}

/** Builds a variant price from operator input. Dragon Coin is required; IRR is optional. */
export function buildVariantPrice(input: { dragonCoinAmount?: number; tomanAmount?: number }): Money[] {
  const drc = input.dragonCoinAmount;
  if (!Number.isSafeInteger(drc) || (drc as number) <= 0) {
    throw new ValidationError('The variant price is not valid.', [
      { field: 'price.dragonCoinAmount', code: 'INVALID_AMOUNT', message: 'Use a whole number of Dragon Coin greater than zero.' }
    ]);
  }
  const price: Money[] = [dragonCoin(drc as number)];
  if (input.tomanAmount !== undefined) {
    if (!Number.isSafeInteger(input.tomanAmount) || input.tomanAmount < 0) {
      throw new ValidationError('The Toman list price is not valid.', [
        { field: 'price.tomanAmount', code: 'INVALID_AMOUNT', message: 'Use a whole number of Toman.' }
      ]);
    }
    // Stored in rial, the smallest unit, so the receipt's rial representation is exact
    // (COMMERCE-009). It is a displayed list price and is never charged.
    price.push(rial(input.tomanAmount * 10));
  }
  return price;
}

/** Whether a discount may be applied to this basket right now (COMMERCE-005). */
export function discountProblem(
  discount: DiscountRecord | null,
  now: string,
  productIds: readonly string[]
): string | null {
  if (discount === null) return 'UNKNOWN_DISCOUNT';
  if (discount.state !== 'active') return 'DISCOUNT_DISABLED';
  if (now < discount.startsAt) return 'DISCOUNT_NOT_STARTED';
  if (now >= discount.endsAt) return 'DISCOUNT_EXPIRED';
  if (discount.maxRedemptions !== null && discount.redemptionCount >= discount.maxRedemptions) return 'DISCOUNT_EXHAUSTED';
  if (discount.productIds.length > 0 && !productIds.some((id) => discount.productIds.includes(id))) return 'DISCOUNT_NOT_APPLICABLE';
  return null;
}

/**
 * Prices a basket from authoritative catalog rows.
 *
 * An invalid coupon produces **no price change** rather than an error, because the basket
 * is still purchasable without it; the caller reports the reason separately.
 */
export function priceCart(
  entries: ReadonlyArray<{ variant: ProductVariantRecord; productId: string; quantity: number }>,
  discount: DiscountRecord | null,
  now: string
): PricedCart {
  if (entries.length > MAX_LINE_ITEMS) {
    throw new ValidationError('That cart has too many lines.', [
      { field: 'items', code: 'TOO_MANY_ITEMS', message: `Use at most ${String(MAX_LINE_ITEMS)} different items.` }
    ]);
  }
  const applicable = discountProblem(discount, now, entries.map((e) => e.productId)) === null ? discount : null;
  const eligibleProducts = applicable?.productIds ?? [];

  const lines: PricedLine[] = [];
  let itemSubtotal: Money[] = [];
  let discountTotal: Money[] = [];

  for (const entry of entries) {
    const quantity = validQuantity(entry.quantity);
    const unitPrice = entry.variant.price;
    const lineSubtotal = unitPrice.map((m) => multiplyMoney(m, quantity));
    const qualifies =
      applicable !== null && (eligibleProducts.length === 0 || eligibleProducts.includes(entry.productId));
    const lineDiscount = qualifies ? percentOf(lineSubtotal, applicable.percentOff) : zeroLike(lineSubtotal);
    const lineTotal = lineSubtotal.map((m, index) => {
      const off = lineDiscount[index];
      return money(m.assetCode, m.amountInteger - (off?.amountInteger ?? 0));
    });

    lines.push({ variantId: entry.variant._id, quantity, unitPrice, lineSubtotal, lineDiscount, lineTotal });
    itemSubtotal = addMoneyLists(itemSubtotal, lineSubtotal);
    discountTotal = addMoneyLists(discountTotal, lineDiscount);
  }

  // Zero, and stated rather than omitted: the receipt must reconcile line by line, and a
  // missing shipping row reads as "forgotten" instead of "not charged" (OD-019).
  const shippingTotal = zeroLike(itemSubtotal);
  const grandTotal = itemSubtotal.map((m, index) =>
    money(m.assetCode, m.amountInteger - (discountTotal[index]?.amountInteger ?? 0))
  );

  return {
    lines,
    itemSubtotal,
    discountTotal,
    shippingTotal,
    grandTotal,
    discountApplied: applicable === null ? null : { code: applicable.code, version: applicable.version, percentOff: applicable.percentOff }
  };
}

/**
 * Provinces the store delivers to (COMMERCE-003, BR-026, CON-008).
 *
 * A code-owned domestic list, not an operator-editable one: OD-019 has not approved
 * service regions, so this is the conservative full-country set used only to reject
 * anything outside Iran. It is not a shipping-rate table and implies no carrier.
 */
export const DOMESTIC_PROVINCES: readonly string[] = [
  'alborz', 'ardabil', 'bushehr', 'chaharmahal_bakhtiari', 'east_azerbaijan', 'fars', 'gilan', 'golestan',
  'hamadan', 'hormozgan', 'ilam', 'isfahan', 'kerman', 'kermanshah', 'khuzestan', 'kohgiluyeh_boyerahmad',
  'kurdistan', 'lorestan', 'markazi', 'mazandaran', 'north_khorasan', 'qazvin', 'qom', 'razavi_khorasan',
  'semnan', 'sistan_baluchestan', 'south_khorasan', 'tehran', 'west_azerbaijan', 'yazd', 'zanjan'
];

const POSTAL_CODE = /^\d{10}$/;
const MOBILE = /^09\d{9}$/;

/** Validates a delivery address, rejecting anything outside the domestic list before payment. */
export function validAddress(raw: Partial<ShippingAddress> | undefined): ShippingAddress {
  const value = raw ?? {};
  const problems: Array<{ field: string; code: string; message: string }> = [];
  const text = (field: keyof ShippingAddress, min: number, max: number): string => {
    const candidate = (value[field] ?? '').toString().trim();
    if (candidate.length < min || candidate.length > max) {
      problems.push({ field: `address.${field}`, code: 'INVALID_LENGTH', message: `Use between ${String(min)} and ${String(max)} characters.` });
    }
    return candidate;
  };

  const fullName = text('fullName', 3, 100);
  const city = text('city', 2, 60);
  const line1 = text('line1', 5, 200);
  const mobile = (value.mobile ?? '').toString().trim();
  if (!MOBILE.test(mobile)) problems.push({ field: 'address.mobile', code: 'INVALID_MOBILE', message: 'Use an Iranian mobile number.' });
  const postalCode = (value.postalCode ?? '').toString().trim();
  if (!POSTAL_CODE.test(postalCode)) problems.push({ field: 'address.postalCode', code: 'INVALID_POSTAL_CODE', message: 'Use a 10-digit postal code.' });
  const province = (value.province ?? '').toString().trim().toLowerCase();
  if (!DOMESTIC_PROVINCES.includes(province)) {
    // Rejected here, before any payment is taken (COMMERCE-003).
    problems.push({ field: 'address.province', code: 'UNSUPPORTED_REGION', message: 'Delivery is available inside Iran only.' });
  }

  if (problems.length > 0) throw new ValidationError('That delivery address is not valid.', problems);
  return { fullName, mobile, province, city, postalCode, line1 };
}
