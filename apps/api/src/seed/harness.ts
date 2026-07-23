/**
 * Shared pure helpers for the development demo seeder: deterministic identifiers, stable
 * demo/business references, and a per-domain count summary. Demo ownership is tracked in
 * the separate demo_seed_registry (see registry.ts) — never as a marker field on a domain
 * record, so immutable and append-only rows are never mutated.
 */

/** Stable business/demo reference, e.g. demoRef('user', 'player-01') -> "demo:user:player-01". */
export function demoRef(kind: string, slug: string): string {
  return `demo:${kind}:${slug}`;
}

/** Fixed epoch base so seeded timestamps are deterministic across runs. */
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
export function demoDate(offsetDays: number, offsetMinutes = 0): Date {
  return new Date(BASE + offsetDays * 86_400_000 + offsetMinutes * 60_000);
}

/** Deterministic idempotency key so a rerun reuses (never duplicates) a posting/registration. */
export function newIdemKey(seed: string): string {
  return `demo:idem:${seed}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Accumulates a concise per-domain count summary for the CLI output. */
export class SeedSummary {
  private readonly counts = new Map<string, { created: number; reused: number }>();
  private readonly skipped: string[] = [];

  record(domain: string, created: number, reused: number): void {
    const cur = this.counts.get(domain) ?? { created: 0, reused: 0 };
    cur.created += created;
    cur.reused += reused;
    this.counts.set(domain, cur);
  }

  skip(reason: string): void {
    this.skipped.push(reason);
  }

  lines(): string[] {
    const out: string[] = [];
    for (const [domain, c] of this.counts) {
      out.push(`  ${domain.padEnd(22)} created ${String(c.created).padStart(3)}  reused ${String(c.reused).padStart(3)}`);
    }
    if (this.skipped.length > 0) {
      out.push('  feature-gated / skipped:');
      for (const s of this.skipped) out.push(`    - ${s}`);
    }
    return out;
  }
}
