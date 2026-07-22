import { RIAL_PER_TOMAN } from '../../shared/money.ts';

/**
 * Code-owned, versioned Dragon Coin purchase packages (DRAGON-11b, PAY-012).
 *
 * The client never supplies an exchange rate or a credited coin amount — it selects
 * a package code and the server binds the rial price and Dragon Coin quantity from
 * this table. Pricing is explicit and versioned; there is no dynamic market pricing.
 * All amounts are exact integers (rial minor unit, whole Dragon Coin).
 */

export const PRICING_VERSION = 1;

export interface DragonCoinPackage {
  readonly code: string;
  readonly dragonCoin: number;
  readonly rial: number;
}

export const DRAGON_COIN_PACKAGES: readonly DragonCoinPackage[] = [
  { code: 'starter', dragonCoin: 100, rial: 1_000_000 },
  { code: 'plus', dragonCoin: 550, rial: 5_000_000 },
  { code: 'pro', dragonCoin: 1_200, rial: 10_000_000 }
];

const BY_CODE = new Map(DRAGON_COIN_PACKAGES.map((pkg) => [pkg.code, pkg]));

export function findPackage(code: string): DragonCoinPackage | undefined {
  return BY_CODE.get(code);
}

/** Toman display value for a package (rial ÷ 10); rial remains the stored/charged unit. */
export function packageToman(pkg: DragonCoinPackage): number {
  return Math.trunc(pkg.rial / RIAL_PER_TOMAN);
}
