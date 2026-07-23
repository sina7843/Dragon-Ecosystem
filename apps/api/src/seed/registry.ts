/**
 * Development-only demo-ownership registry.
 *
 * The seeder must never write a marker field onto a domain record — many are immutable or
 * append-only (ledger, audit, purchases, holds, notifications, outbox, bracket versions).
 * Instead, every demo record the seeder owns is tracked here, in a separate collection that
 * is NEVER authoritative for domain state and never changes a balance or lifecycle. Reset
 * and idempotency read this registry to find records without touching immutable domain rows.
 */
import type { Db } from 'mongodb';
import { utcNow } from '../shared/events.ts';

export const REGISTRY_COLLECTION = 'demo_seed_registry';
export const DEMO_SEED_VERSION = 1;

export interface DemoRegistryEntry {
  demoSeedKey: string;
  demoSeedVersion: number;
  domainType: string;
  collection: string;
  recordId: string;
  businessRef: string | null;
  /** true only for mutable demo content that reset may delete and recreate. */
  resettable: boolean;
  createdAt: string;
}

export interface RecordInput {
  demoSeedKey: string;
  domainType: string;
  collection: string;
  recordId: string;
  resettable: boolean;
  businessRef?: string;
}

export class DemoRegistry {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  #col() {
    return this.#db.collection<DemoRegistryEntry>(REGISTRY_COLLECTION);
  }

  async ensureIndex(): Promise<void> {
    await this.#col().createIndex({ demoSeedKey: 1 }, { unique: true, name: 'demo_seed_key_unique' });
  }

  async find(demoSeedKey: string): Promise<DemoRegistryEntry | null> {
    return this.#col().findOne({ demoSeedKey });
  }

  async has(demoSeedKey: string): Promise<boolean> {
    return (await this.find(demoSeedKey)) !== null;
  }

  /** Records demo ownership. Immutable core fields are written once (setOnInsert). */
  async record(input: RecordInput): Promise<void> {
    await this.#col().updateOne(
      { demoSeedKey: input.demoSeedKey },
      {
        $setOnInsert: {
          demoSeedKey: input.demoSeedKey,
          demoSeedVersion: DEMO_SEED_VERSION,
          domainType: input.domainType,
          collection: input.collection,
          recordId: input.recordId,
          businessRef: input.businessRef ?? null,
          resettable: input.resettable,
          createdAt: utcNow()
        }
      },
      { upsert: true }
    );
  }

  async resettableEntries(): Promise<DemoRegistryEntry[]> {
    return this.#col().find({ resettable: true }).toArray();
  }

  async counts(): Promise<{ resettable: number; preserved: number; total: number }> {
    const total = await this.#col().countDocuments();
    const resettable = await this.#col().countDocuments({ resettable: true });
    return { resettable, preserved: total - resettable, total };
  }

  async removeKeys(demoSeedKeys: readonly string[]): Promise<void> {
    if (demoSeedKeys.length === 0) return;
    await this.#col().deleteMany({ demoSeedKey: { $in: [...demoSeedKeys] } });
  }
}

export interface ResetReport {
  /** Mutable demo records deleted, by collection. */
  readonly mutableReset: Record<string, number>;
  /** Cascade deletes of dependent mutable rows, by collection. */
  readonly cascadeReset: Record<string, number>;
  /** Immutable/append-only demo records left in place and reused on reseed. */
  readonly preserved: number;
}

/**
 * Selective reset: deletes only mutable demo records tracked as resettable (by their
 * recordId), plus their dependent editorial rows. Immutable/append-only records are never
 * deleted — they are reused on the next seed via their registry entries and stable
 * business references. Never drops a database.
 */
export async function resetDemo(db: Db, registry: DemoRegistry): Promise<ResetReport> {
  const entries = await registry.resettableEntries();
  const byCollection = new Map<string, string[]>();
  for (const e of entries) {
    const ids = byCollection.get(e.collection) ?? [];
    ids.push(e.recordId);
    byCollection.set(e.collection, ids);
  }

  const mutableReset: Record<string, number> = {};
  for (const [collection, ids] of byCollection) {
    const res = await db.collection(collection).deleteMany({ _id: { $in: ids as never[] } });
    mutableReset[collection] = res.deletedCount ?? 0;
  }

  // Cascade: editorial history of deleted content, and reports linked to deleted cases.
  const cascadeReset: Record<string, number> = {};
  const contentIds = entries.filter((e) => e.collection === 'content_items').map((e) => e.recordId);
  if (contentIds.length > 0) {
    const r = await db.collection('content_revisions').deleteMany({ contentId: { $in: contentIds as never[] } });
    cascadeReset['content_revisions'] = r.deletedCount ?? 0;
  }
  const caseIds = entries.filter((e) => e.collection === 'moderation_cases').map((e) => e.recordId);
  if (caseIds.length > 0) {
    const r = await db.collection('moderation_reports').deleteMany({ caseId: { $in: caseIds as never[] } });
    cascadeReset['moderation_reports'] = r.deletedCount ?? 0;
  }

  await registry.removeKeys(entries.map((e) => e.demoSeedKey));
  const { preserved } = await registry.counts();
  return { mutableReset, cascadeReset, preserved };
}
