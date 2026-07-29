import type { ClientSession, Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import { withIdempotency } from '../../shared/db/idempotency.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { normalizeQuery, applyTextSearch } from '../../shared/search.ts';
import { resolveSlug } from '../content/slug.ts';
import { toPlainText } from '../content/sanitize.ts';
import { STORE_COLLECTIONS } from './collections.ts';
import {
  addMoneyLists,
  buildVariantPrice,
  discountProblem,
  priceCart,
  settlementAmount,
  validAddress,
  validQuantity,
  type PricedCart
} from './pricing.ts';
import {
  canFulfillmentTransition,
  canProductTransition,
  isSellableProduct,
  LOCALES,
  type CartItemRecord,
  type CartRecord,
  type DiscountRecord,
  type EntitlementRecord,
  type FulfillmentRecord,
  type FulfillmentState,
  type InventoryMovementRecord,
  type Locale,
  type LocalizedText,
  type OrderItemRecord,
  type OrderRecord,
  type ProductRecord,
  type ProductState,
  type ProductType,
  type ProductVariantRecord,
  type ShippingAddress
} from './state.ts';

/**
 * Commerce: catalog, inventory, cart, checkout, orders, and fulfillment
 * (COMMERCE-001..014, UC-020).
 *
 * Invariants:
 * - Totals are recomputed from the catalog at checkout; a client price is never read.
 * - Stock is claimed by a conditional `$inc` inside the write transaction, so two
 *   concurrent buyers of the last unit cannot both succeed (BR-027).
 * - One order per idempotency key; a retry returns the original order (COMMERCE-006).
 * - A digital entitlement exists only after the price is captured (COMMERCE-007).
 * - Money is exact integers. Settlement is Dragon Coin, which is non-redeemable, so a
 *   captured store order creates no cash obligation and no refund path (DEC-024, DEC-044).
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

const TITLE_MAX = 120;
const SUMMARY_MAX = 300;
const DESCRIPTION_MAX = 4000;
const SKU = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

export interface StoreConfig {
  /**
   * OD-019 gate. Fail-closed: while false a basket containing a physical variant cannot
   * be checked out, because selling one creates a delivery obligation and no shipping
   * carrier, service region, price rule, or service level has been approved. The physical
   * catalog, its stock, and the internal fulfillment states all still exist — what is
   * withheld is taking a customer's money for a delivery nobody has agreed how to make.
   */
  readonly physicalFulfillmentEnabled: boolean;
  /** OD-020 gate. Revocation is absent, not merely disabled; this exists to report it. */
  readonly entitlementRevocationEnabled: boolean;
}

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  physicalFulfillmentEnabled: false,
  entitlementRevocationEnabled: false
};

/** What the store needs from the holds/ledger boundary. It never posts to the ledger itself. */
export interface StorePayments {
  createHold(
    context: RequestContext,
    ownerId: EntityId,
    input: { purpose: string; amount: number; businessRef: string; idempotencyKey: string; domainRef?: string }
  ): Promise<{ _id: EntityId }>;
  captureHold(context: RequestContext, holdId: EntityId, input: { amount: number; idempotencyKey: string; reason?: string }): Promise<unknown>;
  releaseHold(context: RequestContext, holdId: EntityId, input: { amount?: number; reason: string; idempotencyKey: string }): Promise<unknown>;
}

export interface ProductCard {
  id: EntityId;
  slug: string;
  type: ProductType;
  title: string;
  summary: string;
  coverImageUrl: string | null;
  /** Cheapest sellable variant price, so a card can show "from". */
  fromPrice: ReturnType<typeof addMoneyLists>;
  available: boolean;
}

export class StoreService {
  readonly #database: Database;
  readonly #config: StoreConfig;
  readonly #payments: StorePayments;

  constructor(database: Database, config: StoreConfig, payments: StorePayments) {
    this.#database = database;
    this.#config = config;
    this.#payments = payments;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #products(db: Db = this.#db) {
    return db.collection<ProductRecord>(STORE_COLLECTIONS.products);
  }
  #variants(db: Db = this.#db) {
    return db.collection<ProductVariantRecord>(STORE_COLLECTIONS.variants);
  }
  #movements(db: Db = this.#db) {
    return db.collection<InventoryMovementRecord>(STORE_COLLECTIONS.movements);
  }
  #carts(db: Db = this.#db) {
    return db.collection<CartRecord>(STORE_COLLECTIONS.carts);
  }
  #cartItems(db: Db = this.#db) {
    return db.collection<CartItemRecord>(STORE_COLLECTIONS.cartItems);
  }
  #discounts(db: Db = this.#db) {
    return db.collection<DiscountRecord>(STORE_COLLECTIONS.discounts);
  }
  #orders(db: Db = this.#db) {
    return db.collection<OrderRecord>(STORE_COLLECTIONS.orders);
  }
  #orderItems(db: Db = this.#db) {
    return db.collection<OrderItemRecord>(STORE_COLLECTIONS.orderItems);
  }
  #fulfillments(db: Db = this.#db) {
    return db.collection<FulfillmentRecord>(STORE_COLLECTIONS.fulfillments);
  }
  #entitlements(db: Db = this.#db) {
    return db.collection<EntitlementRecord>(STORE_COLLECTIONS.entitlements);
  }

  configView(): { physicalFulfillmentEnabled: boolean; entitlementRevocationEnabled: boolean; returnsWorkflow: 'not_offered' } {
    // COMMERCE-010: stated explicitly, so a client cannot infer a returns workflow exists.
    return {
      physicalFulfillmentEnabled: this.#config.physicalFulfillmentEnabled,
      entitlementRevocationEnabled: this.#config.entitlementRevocationEnabled,
      returnsWorkflow: 'not_offered'
    };
  }

  // --- Catalog authoring (ROLE-021, FORM-019) ---

  async createProduct(
    context: RequestContext,
    actorId: EntityId,
    input: { slug?: string; type: ProductType; translations: Record<Locale, Partial<LocalizedText>>; mediaUrls?: string[] }
  ): Promise<ProductRecord> {
    const translations = this.#translations(input.translations);
    const slug = resolveSlug(input.slug, translations.en.title);
    const now = utcNow();
    const record: ProductRecord = {
      _id: newId(),
      slug,
      type: input.type === 'physical' ? 'physical' : 'digital',
      state: 'draft',
      translations,
      categoryId: null,
      mediaUrls: this.#mediaUrls(input.mediaUrls),
      createdAt: now,
      updatedAt: now,
      version: 1
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#products(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'store.product_created', resourceType: 'store_product', resourceId: record._id, after: { slug, type: record.type }, reason: 'Product created.' });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictError('PRODUCT_SLUG_TAKEN', 'That product address is already in use.');
      }
      throw error;
    }
    void actorId;
    return record;
  }

  async transitionProduct(context: RequestContext, productId: EntityId, to: ProductState, reason: string): Promise<ProductRecord> {
    const product = await this.#products().findOne({ _id: productId });
    if (product === null) throw new NotFoundError('Unknown product.');
    if (!canProductTransition(product.state, to)) {
      throw new ConflictError('PRODUCT_STATE_INVALID', `A ${product.state} product cannot become ${to}.`);
    }
    if (to === 'published') await this.#assertSellable(product);
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#products(uow.db).updateOne(
        { _id: productId, state: product.state, version: product.version },
        { $set: { state: to, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('PRODUCT_STALE', 'This product changed. Reload and retry.');
      uow.audit({ action: `store.product_${to}`, resourceType: 'store_product', resourceId: productId, before: { state: product.state }, after: { state: to }, reason });
      return { ...product, state: to, updatedAt: now, version: product.version + 1 };
    });
  }

  /** A product is publishable only with at least one active, priced variant (COMMERCE-001). */
  async #assertSellable(product: ProductRecord): Promise<void> {
    const variants = await this.#variants().find({ productId: product._id, state: 'active' }).toArray();
    if (variants.length === 0) {
      throw new ValidationError('This product has no sellable variant.', [
        { field: 'variants', code: 'NO_ACTIVE_VARIANT', message: 'Add at least one active variant before publishing.' }
      ]);
    }
    if (product.type === 'physical' && variants.some((v) => v.stockOnHand === null)) {
      throw new ValidationError('A physical variant must track stock.', [
        { field: 'variants', code: 'STOCK_REQUIRED', message: 'Set a stock quantity on every physical variant.' }
      ]);
    }
  }

  async createVariant(
    context: RequestContext,
    productId: EntityId,
    input: { sku: string; translations: Record<Locale, { name?: string }>; price: { dragonCoinAmount?: number; tomanAmount?: number }; stockOnHand?: number }
  ): Promise<ProductVariantRecord> {
    const product = await this.#products().findOne({ _id: productId });
    if (product === null) throw new NotFoundError('Unknown product.');
    const sku = input.sku.trim().toUpperCase();
    if (!SKU.test(sku)) {
      throw new ValidationError('That SKU is not valid.', [{ field: 'sku', code: 'INVALID_SKU', message: 'Use 3-32 uppercase letters, digits, or hyphens.' }]);
    }
    // A digital variant is unlimited by nature; a physical one must declare its stock.
    let stockOnHand: number | null = null;
    if (product.type === 'physical') {
      const declared = input.stockOnHand ?? 0;
      if (!Number.isSafeInteger(declared) || declared < 0) {
        throw new ValidationError('That stock quantity is not valid.', [{ field: 'stockOnHand', code: 'INVALID_STOCK', message: 'Use zero or a positive whole number.' }]);
      }
      stockOnHand = declared;
    }
    const now = utcNow();
    const record: ProductVariantRecord = {
      _id: newId(),
      productId,
      sku,
      translations: {
        fa: { name: toPlainText(input.translations.fa.name ?? '').slice(0, TITLE_MAX) },
        en: { name: toPlainText(input.translations.en.name ?? '').slice(0, TITLE_MAX) }
      },
      price: buildVariantPrice(input.price),
      stockOnHand,
      state: 'active',
      createdAt: now,
      updatedAt: now
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#variants(uow.db).insertOne(record, { session: uow.session });
        if (stockOnHand !== null && stockOnHand > 0) {
          await this.#recordMovement(uow, record._id, stockOnHand, 'adjustment', context.actor.accountId ?? null, 'Opening stock.', stockOnHand, null);
        }
        uow.audit({ action: 'store.variant_created', resourceType: 'store_variant', resourceId: record._id, after: { sku, productId }, reason: 'Variant created.' });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('SKU_TAKEN', 'That SKU already exists.');
      throw error;
    }
    return record;
  }

  /** Auditable stock adjustment (COMMERCE-013). Never lets stock fall below zero (BR-027). */
  async adjustInventory(context: RequestContext, variantId: EntityId, quantityDelta: number, reason: string): Promise<ProductVariantRecord> {
    if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) {
      throw new ValidationError('That adjustment is not valid.', [{ field: 'quantityDelta', code: 'INVALID_DELTA', message: 'Use a non-zero whole number.' }]);
    }
    if (reason.trim() === '') {
      throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Say why stock changed.' }]);
    }
    const variant = await this.#variants().findOne({ _id: variantId });
    if (variant === null) throw new NotFoundError('Unknown variant.');
    if (variant.stockOnHand === null) throw new ConflictError('VARIANT_NOT_STOCKED', 'A digital variant does not track stock.');

    return runUnitOfWork(this.#database, context, async (uow) => {
      // The `$gte` guard is what keeps the invariant: a decrement larger than the balance
      // matches nothing rather than writing a negative quantity.
      const filter = quantityDelta < 0 ? { _id: variantId, stockOnHand: { $gte: -quantityDelta } } : { _id: variantId };
      const updated = await this.#variants(uow.db).findOneAndUpdate(
        filter,
        { $inc: { stockOnHand: quantityDelta }, $set: { updatedAt: utcNow() } },
        { session: uow.session, returnDocument: 'after' }
      );
      if (updated === null) throw new ConflictError('INSUFFICIENT_STOCK', 'That adjustment would take stock below zero.');
      await this.#recordMovement(uow, variantId, quantityDelta, 'adjustment', context.actor.accountId ?? null, reason, updated.stockOnHand ?? 0, null);
      uow.audit({ action: 'store.inventory_adjusted', resourceType: 'store_variant', resourceId: variantId, before: { stockOnHand: variant.stockOnHand }, after: { stockOnHand: updated.stockOnHand }, reason });
      return updated;
    });
  }

  async listMovements(variantId: EntityId, limit = 50): Promise<InventoryMovementRecord[]> {
    return this.#movements().find({ variantId }).sort({ createdAt: -1, _id: -1 }).limit(clampLimit(limit)).toArray();
  }

  // --- Discounts (COMMERCE-005) ---

  async createDiscount(
    context: RequestContext,
    input: { code: string; percentOff: number; startsAt: string; endsAt: string; productIds?: string[]; maxRedemptions?: number }
  ): Promise<DiscountRecord> {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,24}$/.test(code)) {
      throw new ValidationError('That discount code is not valid.', [{ field: 'code', code: 'INVALID_CODE', message: 'Use 3-24 uppercase letters or digits.' }]);
    }
    if (!Number.isSafeInteger(input.percentOff) || input.percentOff < 1 || input.percentOff > 90) {
      throw new ValidationError('That discount is not valid.', [{ field: 'percentOff', code: 'INVALID_PERCENT', message: 'Use a whole percent between 1 and 90.' }]);
    }
    if (input.endsAt <= input.startsAt) {
      throw new ValidationError('The discount period is not valid.', [{ field: 'endsAt', code: 'INVALID_PERIOD', message: 'The end must be after the start.' }]);
    }
    const now = utcNow();
    const record: DiscountRecord = {
      _id: newId(),
      code,
      version: 1,
      percentOff: input.percentOff,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      productIds: input.productIds ?? [],
      maxRedemptions: input.maxRedemptions ?? null,
      redemptionCount: 0,
      state: 'active',
      createdAt: now,
      updatedAt: now
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#discounts(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'store.discount_created', resourceType: 'store_discount', resourceId: record._id, after: { code, percentOff: record.percentOff }, reason: 'Discount created.' });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('DISCOUNT_CODE_TAKEN', 'That discount code already exists.');
      throw error;
    }
    return record;
  }

  // --- Public catalog (API-089, API-090, PAGE-037, PAGE-038) ---

  async listProducts(query: { locale: Locale; type?: ProductType; q?: string; availableOnly?: boolean; cursor?: string; limit?: number }): Promise<Page<ProductCard>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { state: 'published' };
    if (query.type !== undefined) filter['type'] = query.type;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $lt: cursor.id } }];
    }
    const search = normalizeQuery(query.q);
    // Mutates the filter in place and composes with the cursor `$or` under `$and`, so a
    // search never silently drops the pagination window.
    if (search !== null) applyTextSearch(filter, search, [`translations.${query.locale}.title`, 'slug']);

    const rows = await this.#products().find(filter).sort({ createdAt: -1, _id: -1 }).limit((limit + 1) * 2).toArray();
    const cards: ProductCard[] = [];
    for (const row of rows) {
      if (cards.length > limit) break;
      const card = await this.#card(row, query.locale);
      // COMMERCE-014: availability is a real property of the row, so filtering on it
      // cannot disagree with what the card shows.
      if (query.availableOnly === true && !card.available) continue;
      cards.push(card);
    }
    const page = toPage(cards.map((c) => ({ ...c, sortValue: rows.find((r) => r._id === c.id)?.createdAt ?? '', id: c.id })), limit);
    return { items: page.items.map(({ sortValue, ...rest }) => rest as unknown as ProductCard), nextCursor: page.nextCursor };
  }

  async getProduct(slug: string, locale: Locale): Promise<{
    id: EntityId; slug: string; type: ProductType; title: string; summary: string; description: string; mediaUrls: string[];
    variants: Array<{ id: EntityId; sku: string; name: string; price: ProductVariantRecord['price']; available: boolean; stockOnHand: number | null }>;
    purchasable: boolean; purchasableReason: string | null;
  } | null> {
    const product = await this.#products().findOne({ slug: slug.trim().toLowerCase() });
    if (product === null || !isSellableProduct(product.state)) return null;
    const variants = await this.#variants().find({ productId: product._id, state: 'active' }).sort({ sku: 1 }).toArray();
    const text = product.translations[locale];
    // Stated on the payload rather than inferred by the client, so the storefront cannot
    // offer a checkout the server will refuse (OD-019).
    const blocked = product.type === 'physical' && !this.#config.physicalFulfillmentEnabled;
    return {
      id: product._id,
      slug: product.slug,
      type: product.type,
      title: text.title,
      summary: text.summary,
      description: text.description,
      mediaUrls: product.mediaUrls,
      variants: variants.map((v) => ({
        id: v._id,
        sku: v.sku,
        name: v.translations[locale].name,
        price: v.price,
        available: v.stockOnHand === null || v.stockOnHand > 0,
        stockOnHand: v.stockOnHand
      })),
      purchasable: !blocked,
      purchasableReason: blocked ? 'PHYSICAL_FULFILLMENT_DISABLED' : null
    };
  }

  // --- Cart (API-091, PAGE-039) ---

  async getCart(accountId: EntityId, locale: Locale): Promise<{ id: EntityId; version: number; discountCode: string | null; discountProblem: string | null; items: Array<{ id: EntityId; variantId: EntityId; sku: string; name: string; quantity: number; unitPrice: ProductVariantRecord['price']; lineTotal: ProductVariantRecord['price'] }>; totals: PricedCart; blocked: string | null; requiresAddress: boolean }> {
    const cart = await this.#openCart(accountId);
    const items = await this.#cartItems().find({ cartId: cart._id }).sort({ createdAt: 1 }).toArray();
    const variants = await this.#variants().find({ _id: { $in: items.map((i) => i.variantId) } }).toArray();
    const byId = new Map(variants.map((v) => [v._id, v]));
    const products = await this.#products().find({ _id: { $in: variants.map((v) => v.productId) } }).toArray();
    const productById = new Map(products.map((p) => [p._id, p]));

    const entries = items
      .map((item) => ({ item, variant: byId.get(item.variantId) }))
      .filter((e): e is { item: CartItemRecord; variant: ProductVariantRecord } => e.variant !== undefined)
      .map((e) => ({ variant: e.variant, productId: e.variant.productId, quantity: e.item.quantity }));

    const discount = cart.discountCode === null ? null : await this.#discounts().findOne({ code: cart.discountCode });
    const now = utcNow();
    const totals = priceCart(entries, discount, now);
    const problem = cart.discountCode === null ? null : discountProblem(discount, now, entries.map((e) => e.productId));

    // A physical line needs a delivery address, and blocks checkout entirely while OD-019
    // is unresolved. Both are reported here so the customer learns at the cart rather than
    // at the payment step.
    const hasPhysical = entries.some((e) => productById.get(e.variant.productId)?.type === 'physical');
    const blocked = hasPhysical && !this.#config.physicalFulfillmentEnabled ? 'PHYSICAL_FULFILLMENT_DISABLED' : null;

    return {
      id: cart._id,
      version: cart.version,
      discountCode: cart.discountCode,
      discountProblem: problem,
      items: items.flatMap((item) => {
        const variant = byId.get(item.variantId);
        if (variant === undefined) return [];
        const line = totals.lines.find((l) => l.variantId === variant._id);
        return [{
          id: item._id,
          variantId: variant._id,
          sku: variant.sku,
          name: variant.translations[locale].name,
          quantity: item.quantity,
          unitPrice: variant.price,
          lineTotal: line?.lineTotal ?? []
        }];
      }),
      totals,
      blocked,
      requiresAddress: hasPhysical
    };
  }

  async setCartItem(context: RequestContext, accountId: EntityId, variantId: EntityId, quantity: number): Promise<void> {
    const variant = await this.#variants().findOne({ _id: variantId, state: 'active' });
    if (variant === null) throw new NotFoundError('Unknown variant.');
    const product = await this.#products().findOne({ _id: variant.productId });
    if (product === null || !isSellableProduct(product.state)) throw new NotFoundError('Unknown variant.');
    // COMMERCE-014 / PAGE-038: an unavailable variant cannot be added at all.
    if (variant.stockOnHand !== null && variant.stockOnHand <= 0 && quantity > 0) {
      throw new ConflictError('OUT_OF_STOCK', 'That item is out of stock.');
    }
    const cart = await this.#openCart(accountId);
    await runUnitOfWork(this.#database, context, async (uow) => {
      if (quantity <= 0) {
        await this.#cartItems(uow.db).deleteOne({ cartId: cart._id, variantId }, { session: uow.session });
      } else {
        const safe = validQuantity(quantity);
        await this.#cartItems(uow.db).updateOne(
          { cartId: cart._id, variantId },
          { $set: { quantity: safe, unitPricePreview: variant.price }, $setOnInsert: { _id: newId(), cartId: cart._id, variantId, createdAt: utcNow() } },
          { session: uow.session, upsert: true }
        );
      }
      // Every mutation bumps the version, so a checkout priced against an older cart is
      // rejected rather than silently charging for a basket the customer never saw.
      await this.#carts(uow.db).updateOne({ _id: cart._id }, { $inc: { version: 1 }, $set: { updatedAt: utcNow() } }, { session: uow.session });
    });
  }

  async setCartDiscount(context: RequestContext, accountId: EntityId, code: string | null): Promise<void> {
    const cart = await this.#openCart(accountId);
    const normalized = code === null || code.trim() === '' ? null : code.trim().toUpperCase();
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#carts(uow.db).updateOne({ _id: cart._id }, { $set: { discountCode: normalized, updatedAt: utcNow() }, $inc: { version: 1 } }, { session: uow.session });
    });
  }

  async #openCart(accountId: EntityId): Promise<CartRecord> {
    const existing = await this.#carts().findOne({ accountId, state: 'open' });
    if (existing !== null) return existing;
    const now = utcNow();
    const record: CartRecord = { _id: newId(), accountId, state: 'open', version: 1, discountCode: null, createdAt: now, updatedAt: now };
    try {
      await this.#carts().insertOne(record);
      return record;
    } catch (error) {
      if (isDuplicateKey(error)) {
        const raced = await this.#carts().findOne({ accountId, state: 'open' });
        if (raced !== null) return raced;
      }
      throw error;
    }
  }

  // --- Checkout (API-092, UC-020, FORM-020) ---

  /**
   * Creates one order per idempotency key.
   *
   * Order of operations matters and is deliberate: price from the catalog, claim stock,
   * reserve the money, write the order, then capture. If the capture fails the stock is
   * returned and the order is marked failed, so a customer never loses an item to a
   * payment that did not happen (PERF-013: correctness over optimistic completion).
   */
  async checkout(
    context: RequestContext,
    accountId: EntityId,
    input: { cartVersion: number; idempotencyKey: string; address?: Partial<ShippingAddress>; consent: boolean }
  ): Promise<OrderRecord> {
    if (input.consent !== true) {
      throw new ValidationError('Consent is required to place an order.', [{ field: 'consent', code: 'CONSENT_REQUIRED', message: 'Accept the terms to continue.' }]);
    }
    const outcome = await withIdempotency(
      this.#db,
      { scope: `store_checkout:${accountId}`, key: input.idempotencyKey, request: { cartVersion: input.cartVersion } },
      async () => this.#placeOrder(context, accountId, input)
    );
    return outcome.result;
  }

  async #placeOrder(
    context: RequestContext,
    accountId: EntityId,
    input: { cartVersion: number; address?: Partial<ShippingAddress>; consent: boolean }
  ): Promise<OrderRecord> {
    const cart = await this.#openCart(accountId);
    if (cart.version !== input.cartVersion) {
      throw new ConflictError('CART_STALE', 'Your cart changed. Review it and try again.');
    }
    const items = await this.#cartItems().find({ cartId: cart._id }).sort({ createdAt: 1 }).toArray();
    if (items.length === 0) throw new ValidationError('Your cart is empty.');

    const variants = await this.#variants().find({ _id: { $in: items.map((i) => i.variantId) }, state: 'active' }).toArray();
    const variantById = new Map(variants.map((v) => [v._id, v]));
    if (variants.length !== items.length) throw new ConflictError('CART_ITEM_UNAVAILABLE', 'An item in your cart is no longer available.');
    const products = await this.#products().find({ _id: { $in: variants.map((v) => v.productId) } }).toArray();
    const productById = new Map(products.map((p) => [p._id, p]));
    for (const product of products) {
      if (!isSellableProduct(product.state)) throw new ConflictError('CART_ITEM_UNAVAILABLE', 'An item in your cart is no longer available.');
    }

    const hasPhysical = products.some((p) => p.type === 'physical');
    if (hasPhysical && !this.#config.physicalFulfillmentEnabled) {
      // Refused before any money moves: selling a physical item commits us to delivering
      // it, and no carrier, region, price rule, or service level is approved (OD-019).
      throw new ConflictError('PHYSICAL_FULFILLMENT_DISABLED', 'Physical items cannot be purchased yet.');
    }
    const address = hasPhysical ? validAddress(input.address) : null;

    // Priced from the catalog rows, never from the cart preview (COMMERCE-004).
    const entries = items.map((item) => {
      const variant = variantById.get(item.variantId) as ProductVariantRecord;
      return { variant, productId: variant.productId, quantity: item.quantity };
    });
    const discount = cart.discountCode === null ? null : await this.#discounts().findOne({ code: cart.discountCode });
    const now = utcNow();
    const totals = priceCart(entries, discount, now);
    const payable = settlementAmount(totals.grandTotal);
    if (payable <= 0) throw new ValidationError('That order has no payable total.');

    const orderId = newId();
    const reference = `DS-${orderId.slice(0, 8).toUpperCase()}`;

    // 1. Claim stock and write the order inside one transaction. A conditional `$inc`
    //    means a losing concurrent buyer matches nothing and is rejected (BR-027).
    const order = await runUnitOfWork(this.#database, context, async (uow) => {
      for (const entry of entries) {
        if (entry.variant.stockOnHand === null) continue;
        const claimed = await this.#variants(uow.db).findOneAndUpdate(
          { _id: entry.variant._id, stockOnHand: { $gte: entry.quantity } },
          { $inc: { stockOnHand: -entry.quantity }, $set: { updatedAt: now } },
          { session: uow.session, returnDocument: 'after' }
        );
        if (claimed === null) throw new ConflictError('INSUFFICIENT_STOCK', 'Someone bought the last one. Adjust your cart and try again.');
        await this.#recordMovement(uow, entry.variant._id, -entry.quantity, 'order_claim', accountId, `Order ${reference}`, claimed.stockOnHand ?? 0, orderId);
      }

      const record: OrderRecord = {
        _id: orderId,
        accountId,
        state: 'pending_payment',
        reference,
        itemSubtotal: totals.itemSubtotal,
        discountTotal: totals.discountTotal,
        shippingTotal: totals.shippingTotal,
        grandTotal: totals.grandTotal,
        discountSnapshot: totals.discountApplied,
        addressSnapshot: address,
        holdId: null,
        paidAt: null,
        failureReason: null,
        createdAt: now,
        updatedAt: now
      };
      await this.#orders(uow.db).insertOne(record, { session: uow.session });

      for (const line of totals.lines) {
        const variant = variantById.get(line.variantId) as ProductVariantRecord;
        const product = productById.get(variant.productId) as ProductRecord;
        const orderItemId = newId();
        await this.#orderItems(uow.db).insertOne(
          {
            _id: orderItemId,
            orderId,
            variantId: variant._id,
            productId: product._id,
            type: product.type,
            // Snapshots, so a later catalog edit cannot rewrite history (COMMERCE-012).
            titleSnapshot: { fa: product.translations.fa.title, en: product.translations.en.title },
            skuSnapshot: variant.sku,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineSubtotal: line.lineSubtotal,
            lineDiscount: line.lineDiscount,
            lineTotal: line.lineTotal,
            createdAt: now
          },
          { session: uow.session }
        );
        await this.#fulfillments(uow.db).insertOne(
          {
            _id: newId(),
            orderId,
            orderItemId,
            type: product.type,
            state: 'pending',
            addressSnapshot: product.type === 'physical' ? address : null,
            history: [{ state: 'pending', at: now, actorId: null, reason: 'Order placed.' }],
            createdAt: now,
            updatedAt: now
          },
          { session: uow.session }
        );
      }

      if (totals.discountApplied !== null && discount !== null) {
        // Usage is counted on the order that used it, so the limit is enforced against
        // real redemptions rather than against how often the code was typed.
        await this.#discounts(uow.db).updateOne({ _id: discount._id }, { $inc: { redemptionCount: 1 } }, { session: uow.session });
      }
      await this.#carts(uow.db).updateOne({ _id: cart._id }, { $set: { state: 'ordered', updatedAt: now } }, { session: uow.session });
      uow.audit({ action: 'store.order_placed', resourceType: 'store_order', resourceId: orderId, after: { reference, payable }, reason: 'Checkout.' });
      return record;
    });

    // 2. Reserve and capture the Dragon Coin price. Outside the order transaction because
    //    the holds service owns its own transactional boundary; a failure here rolls the
    //    order forward to `failed` and returns the stock rather than leaving it claimed.
    try {
      const hold = await this.#payments.createHold(context, accountId, {
        purpose: 'store_order',
        amount: payable,
        businessRef: `store_order:${orderId}`,
        idempotencyKey: `store_order_hold:${orderId}`,
        domainRef: orderId
      });
      await this.#payments.captureHold(context, hold._id, { amount: payable, idempotencyKey: `store_order_capture:${orderId}`, reason: `Order ${reference}` });
      return await this.#markPaid(context, order, hold._id);
    } catch (error) {
      await this.#failOrder(context, order, error instanceof Error ? error.message : 'Payment failed.');
      throw error;
    }
  }

  async #markPaid(context: RequestContext, order: OrderRecord, holdId: EntityId): Promise<OrderRecord> {
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#orders(uow.db).updateOne(
        { _id: order._id, state: 'pending_payment' },
        { $set: { state: 'paid', holdId, paidAt: now, updatedAt: now } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('ORDER_STALE', 'This order changed. Reload and retry.');

      // COMMERCE-007: entitlements are created here and nowhere else — after the price is
      // captured, never before. The unique index on orderItemId makes a replay a no-op.
      const digital = await this.#orderItems(uow.db).find({ orderId: order._id, type: 'digital' }, { session: uow.session }).toArray();
      for (const item of digital) {
        await this.#entitlements(uow.db).updateOne(
          { orderItemId: item._id },
          {
            $setOnInsert: {
              _id: newId(),
              accountId: order.accountId,
              orderId: order._id,
              orderItemId: item._id,
              productId: item.productId,
              variantId: item.variantId,
              state: 'active',
              grantedAt: now
            }
          },
          { session: uow.session, upsert: true }
        );
        await this.#fulfillments(uow.db).updateOne(
          { orderItemId: item._id },
          { $set: { state: 'delivered', updatedAt: now }, $push: { history: { state: 'delivered', at: now, actorId: null, reason: 'Digital entitlement granted.' } } },
          { session: uow.session }
        );
      }
      uow.audit({ action: 'store.order_paid', resourceType: 'store_order', resourceId: order._id, before: { state: 'pending_payment' }, after: { state: 'paid', holdId }, reason: 'Price captured.' });
      return { ...order, state: 'paid' as const, holdId, paidAt: now, updatedAt: now };
    });
  }

  /** Returns claimed stock and records the failure, so a failed payment costs nothing. */
  async #failOrder(context: RequestContext, order: OrderRecord, reason: string): Promise<void> {
    const now = utcNow();
    await runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#orders(uow.db).updateOne(
        { _id: order._id, state: 'pending_payment' },
        { $set: { state: 'failed', failureReason: reason.slice(0, 300), updatedAt: now } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) return; // already resolved
      const items = await this.#orderItems(uow.db).find({ orderId: order._id }, { session: uow.session }).toArray();
      for (const item of items) {
        const variant = await this.#variants(uow.db).findOne({ _id: item.variantId }, { session: uow.session });
        if (variant === null || variant.stockOnHand === null) continue;
        const restored = await this.#variants(uow.db).findOneAndUpdate(
          { _id: item.variantId },
          { $inc: { stockOnHand: item.quantity }, $set: { updatedAt: now } },
          { session: uow.session, returnDocument: 'after' }
        );
        await this.#recordMovement(uow, item.variantId, item.quantity, 'order_release', order.accountId, `Order ${order.reference} failed`, restored?.stockOnHand ?? 0, order._id);
      }
      await this.#fulfillments(uow.db).updateMany(
        { orderId: order._id },
        { $set: { state: 'cancelled', updatedAt: now }, $push: { history: { state: 'cancelled', at: now, actorId: null, reason: 'Payment failed.' } } },
        { session: uow.session }
      );
      uow.audit({ action: 'store.order_failed', resourceType: 'store_order', resourceId: order._id, after: { state: 'failed' }, reason });
    });
  }

  // --- Orders and receipts (API-093, API-094, PAGE-041, COMMERCE-009) ---

  async listMyOrders(accountId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<OrderRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { accountId };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $lt: cursor.id } }];
    }
    const rows = await this.#orders().find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items as unknown as OrderRecord[], nextCursor: page.nextCursor };
  }

  /**
   * One order with its receipt. The reconciliation figures are computed from the stored
   * line items rather than copied from the order, so a receipt that does not add up is a
   * visible mismatch instead of a plausible-looking lie (COMMERCE-009).
   */
  async getMyOrder(accountId: EntityId, orderId: EntityId): Promise<{
    order: OrderRecord;
    items: OrderItemRecord[];
    fulfillments: FulfillmentRecord[];
    entitlements: EntitlementRecord[];
    receipt: { lineTotal: OrderRecord['grandTotal']; reconciles: boolean };
  } | null> {
    const order = await this.#orders().findOne({ _id: orderId });
    // Someone else's order is indistinguishable from a missing one.
    if (order === null || order.accountId !== accountId) return null;
    const [items, fulfillments, entitlements] = await Promise.all([
      this.#orderItems().find({ orderId }).sort({ createdAt: 1 }).toArray(),
      this.#fulfillments().find({ orderId }).toArray(),
      this.#entitlements().find({ orderId }).toArray()
    ]);
    const summed = items.reduce<OrderRecord['grandTotal']>((acc, item) => addMoneyLists(acc, item.lineTotal), []);
    const reconciles = settlementAmount(summed) === settlementAmount(order.grandTotal);
    return { order, items, fulfillments, entitlements, receipt: { lineTotal: summed, reconciles } };
  }

  async listMyEntitlements(accountId: EntityId): Promise<EntitlementRecord[]> {
    return this.#entitlements().find({ accountId }).sort({ grantedAt: -1 }).limit(200).toArray();
  }

  // --- Order operations (PAGE-057, COMMERCE-008) ---

  async listOrdersForOperator(query: { state?: string; limit?: number } = {}): Promise<OrderRecord[]> {
    const filter: Record<string, unknown> = {};
    if (query.state !== undefined) filter['state'] = query.state;
    return this.#orders().find(filter).sort({ createdAt: -1, _id: -1 }).limit(clampLimit(query.limit)).toArray();
  }

  async listFulfillments(orderId: EntityId): Promise<FulfillmentRecord[]> {
    return this.#fulfillments().find({ orderId }).toArray();
  }

  /**
   * Advances an internal fulfillment state. No carrier is booked and no external call is
   * made: OD-019 has selected no carrier, so this records what staff did, nothing more.
   */
  async transitionFulfillment(context: RequestContext, fulfillmentId: EntityId, to: FulfillmentState, actorId: EntityId, reason: string): Promise<FulfillmentRecord> {
    if (reason.trim() === '') {
      throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Say why the state changed.' }]);
    }
    const fulfillment = await this.#fulfillments().findOne({ _id: fulfillmentId });
    if (fulfillment === null) throw new NotFoundError('Unknown fulfillment.');
    if (fulfillment.type === 'physical' && !this.#config.physicalFulfillmentEnabled) {
      throw new ConflictError('PHYSICAL_FULFILLMENT_DISABLED', 'Physical fulfillment is not activated.');
    }
    if (!canFulfillmentTransition(fulfillment.state, to)) {
      throw new ConflictError('FULFILLMENT_STATE_INVALID', `A ${fulfillment.state} fulfillment cannot become ${to}.`);
    }
    const order = await this.#orders().findOne({ _id: fulfillment.orderId });
    if (order === null || order.state !== 'paid') {
      throw new ConflictError('ORDER_NOT_PAID', 'Only a paid order can be fulfilled.');
    }
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#fulfillments(uow.db).updateOne(
        { _id: fulfillmentId, state: fulfillment.state },
        { $set: { state: to, updatedAt: now }, $push: { history: { state: to, at: now, actorId, reason } } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('FULFILLMENT_STALE', 'This fulfillment changed. Reload and retry.');
      uow.audit({ action: 'store.fulfillment_transitioned', resourceType: 'store_fulfillment', resourceId: fulfillmentId, before: { state: fulfillment.state }, after: { state: to }, reason });
      return { ...fulfillment, state: to, updatedAt: now };
    });
  }

  /**
   * Financial reconciliation over paid orders (COMMERCE-009, ANALYTICS-006 precondition).
   *
   * Recomputed from order items every time rather than stored, so a stored total that
   * drifted from its lines shows up as a difference instead of agreeing with itself.
   */
  async reconcile(): Promise<{ paidOrders: number; itemSum: number; orderSum: number; differences: Array<{ orderId: EntityId; reference: string; itemSum: number; orderSum: number; kind?: string }> }> {
    const orders = await this.#orders().find({ state: 'paid' }).limit(1000).toArray();
    const items = await this.#orderItems().find({ orderId: { $in: orders.map((o) => o._id) } }).toArray();
    const byOrder = new Map<EntityId, number>();
    for (const item of items) {
      byOrder.set(item.orderId, (byOrder.get(item.orderId) ?? 0) + settlementAmount(item.lineTotal));
    }
    let itemSum = 0;
    let orderSum = 0;
    const differences: Array<{ orderId: EntityId; reference: string; itemSum: number; orderSum: number; kind?: string }> = [];
    for (const order of orders) {
      const lines = byOrder.get(order._id) ?? 0;
      const stored = settlementAmount(order.grandTotal);
      itemSum += lines;
      orderSum += stored;
      if (lines !== stored) differences.push({ orderId: order._id, reference: order.reference, itemSum: lines, orderSum: stored });
      // The reverse direction for money: an order that claims to be settled must carry the
      // reservation that settled it. Walking orders alone would never notice one that was
      // marked paid without any financial evidence behind it.
      if (order.holdId === null) {
        differences.push({ orderId: order._id, reference: order.reference, itemSum: lines, orderSum: stored, kind: 'paid_without_reservation' });
      }
    }

    // The reverse direction for line items: a line pointing at an order that is missing or
    // not paid. Checking only order → items cannot see these, because the walk never
    // visits them.
    // Sampled newest-first over the primary key rather than filtered with `$nin`. A `$nin`
    // over the paid-order ids cannot use an index, so it scanned every order item ever
    // written, and its budget was consumed by the ordinary items of legitimately unpaid
    // orders before it ever reached a genuine orphan. This walks a bounded, indexed slice
    // and then asks only about the parents it actually saw.
    const recentItems = await this.#orderItems()
      .find({}, { projection: { _id: 1, orderId: 1 } })
      .sort({ _id: -1 })
      .limit(1000)
      .toArray();
    const orphanOrderIds = [...new Set(recentItems.map((item) => item.orderId))];
    const liveOrders = orphanOrderIds.length === 0
      ? []
      : await this.#orders().find({ _id: { $in: orphanOrderIds } }, { projection: { _id: 1 } }).toArray();
    const liveIds = new Set(liveOrders.map((o) => o._id));
    for (const orderId of orphanOrderIds) {
      // A line under an unpaid order is ordinary; a line under *no* order is evidence of a
      // write that lost its parent.
      if (!liveIds.has(orderId)) {
        differences.push({ orderId, reference: '(missing order)', itemSum: 0, orderSum: 0, kind: 'item_without_order' });
      }
    }

    return { paidOrders: orders.length, itemSum, orderSum, differences };
  }

  // --- Internals ---

  async #card(product: ProductRecord, locale: Locale): Promise<ProductCard> {
    const variants = await this.#variants().find({ productId: product._id, state: 'active' }).toArray();
    const cheapest = variants
      .slice()
      .sort((a, b) => settlementAmount(a.price) - settlementAmount(b.price))[0];
    const text = product.translations[locale];
    return {
      id: product._id,
      slug: product.slug,
      type: product.type,
      title: text.title,
      summary: text.summary,
      coverImageUrl: product.mediaUrls[0] ?? null,
      fromPrice: cheapest?.price ?? [],
      available: variants.some((v) => v.stockOnHand === null || v.stockOnHand > 0)
    };
  }

  async #recordMovement(
    uow: { db: Db; session: ClientSession },
    variantId: EntityId,
    quantityDelta: number,
    source: InventoryMovementRecord['source'],
    actorId: EntityId | null,
    reason: string,
    resultingQuantity: number,
    orderId: EntityId | null
  ): Promise<void> {
    await this.#movements(uow.db).insertOne(
      { _id: newId(), variantId, quantityDelta, source, actorId, reason: reason.slice(0, 300), resultingQuantity, orderId, createdAt: utcNow() },
      { session: uow.session }
    );
  }

  #translations(raw: Record<Locale, Partial<LocalizedText>>): Record<Locale, LocalizedText> {
    const out = {} as Record<Locale, LocalizedText>;
    for (const locale of LOCALES) {
      const entry = raw[locale] ?? {};
      const title = toPlainText(entry.title ?? '').slice(0, TITLE_MAX);
      if (title === '') {
        throw new ValidationError('Both locales need a title.', [{ field: `translations.${locale}.title`, code: 'REQUIRED', message: 'A title is required.' }]);
      }
      out[locale] = {
        title,
        summary: toPlainText(entry.summary ?? '').slice(0, SUMMARY_MAX),
        description: toPlainText(entry.description ?? '').slice(0, DESCRIPTION_MAX)
      };
    }
    return out;
  }

  #mediaUrls(raw: string[] | undefined): string[] {
    const urls = [...new Set(raw ?? [])].slice(0, 8);
    for (const url of urls) {
      // Site media only, so product imagery stays inside the moderated pipeline (MEDIA-014).
      if (!url.startsWith('/media/')) {
        throw new ValidationError('That media reference is not allowed.', [
          { field: 'mediaUrls', code: 'INVALID_MEDIA_REF', message: 'Upload the image first and use its site path.' }
        ]);
      }
    }
    return urls;
  }

  /** OD-020: there is no revocation path. This exists so a caller gets a clear answer. */
  revokeEntitlement(): never {
    throw new ForbiddenError('Entitlement revocation is not available (OD-020).');
  }
}
