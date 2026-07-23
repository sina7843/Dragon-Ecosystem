/**
 * Wallet demo data through the real ledger, payments, and holds services — never by
 * writing balance fields directly. Dragon Coin is issued via a balanced double-entry
 * posting; purchases go through the mock provider (success/failed/pending); one active
 * admin_correction hold is created. No negative balances, no live provider, no disabled
 * transfer (refund/withdrawal/payout stay fail-closed).
 */
import type { RawCallback } from '../modules/payments/provider.ts';
import type { SeedSummary } from './harness.ts';
import { demoRef, newIdemKey } from './harness.ts';
import type { UserRegistry } from './users.ts';
import type { DemoRegistry } from './registry.ts';
import { accountContext, sysContext, type Services } from './wiring.ts';

// player key -> Dragon Coin to issue (0/absent = deliberately empty wallet).
const BALANCES: readonly [string, number][] = [
  ['player-01', 5000], ['player-02', 1200], ['player-03', 300], ['player-04', 800],
  ['player-08', 2500], ['player-09', 150], ['player-10', 640], ['player-11', 90],
  ['player-12', 4300], ['player-16', 75]
];

// Immutable ledger/purchase/hold rows are tracked in the registry by their stable business
// reference — never by mutating the financial row.
async function issueCoins(services: Services, registry: DemoRegistry, accountId: string, key: string, amount: number): Promise<boolean> {
  const businessRef = `dragon_coin_issue:${demoRef('coin', key)}`;
  const existing = await services.db.collection('ledger_transactions').findOne({ businessRef } as never);
  if (existing !== null) return false;
  const posted = await services.ledger.post(sysContext(), {
    type: 'dragon_coin_issue',
    businessRef,
    idempotencyKey: newIdemKey(`coin:${key}`),
    description: 'Demo Dragon Coin grant (development only).',
    entries: [
      { account: { kind: 'system', accountType: 'platform_dragon_coin_treasury' }, amount: -amount },
      { account: { kind: 'user', ownerId: accountId, accountType: 'user_dragon_coin' }, amount: amount }
    ]
  });
  await registry.record({ demoSeedKey: demoRef('coin', key), domainType: 'ledger_transaction', collection: 'ledger_transactions', recordId: posted.transaction._id, resettable: false, businessRef });
  return true;
}

export async function seedEconomy(services: Services, registry: DemoRegistry, summary: SeedSummary, users: UserRegistry): Promise<void> {
  let issued = 0;
  let reused = 0;
  for (const [key, amount] of BALANCES) {
    const user = users.get(key);
    if (user === undefined || amount <= 0) continue;
    if (await issueCoins(services, registry, user.accountId, key, amount)) issued += 1;
    else reused += 1;
  }
  summary.record('wallet balances', issued, reused);

  // Mock purchases (only when the mock provider is enabled off-production).
  if (!services.paymentsMockEnabled) {
    summary.skip('mock purchases (PAYMENTS_MOCK_ENABLED disabled)');
  } else {
    const plan: { key: string; pkg: 'starter' | 'plus' | 'pro'; outcome: 'success' | 'failed' | null }[] = [
      { key: 'player-05', pkg: 'starter', outcome: 'success' },
      { key: 'player-06', pkg: 'plus', outcome: 'failed' },
      { key: 'player-07', pkg: 'pro', outcome: null } // left pending -> shows a pending purchase
    ];
    let purchases = 0;
    let purchasesReused = 0;
    for (const p of plan) {
      const user = users.get(p.key);
      if (user === undefined) continue;
      const purchaseKey = demoRef('purchase', p.key);
      if (await registry.has(purchaseKey)) {
        purchasesReused += 1;
        continue;
      }
      const ctx = accountContext(user.accountId);
      const idempotencyKey = newIdemKey(`purchase:${p.key}`);
      const purchase = await services.payments.createPurchase(ctx, user.accountId, { packageCode: p.pkg, idempotencyKey });
      // Purchase is immutable financial history — tracked in the registry, never mutated.
      await registry.record({ demoSeedKey: purchaseKey, domainType: 'purchase', collection: 'dragon_coin_purchases', recordId: purchase._id, resettable: false, businessRef: `dragon_coin_purchase:${purchase._id}` });
      purchases += 1;
      if (p.outcome !== null && (purchase.state === 'payment_pending' || purchase.state === 'created')) {
        const provider = services.payments.provider as unknown as { sign(f: Omit<RawCallback, 'signature'>): string };
        const fields: Omit<RawCallback, 'signature'> = {
          provider: purchase.provider,
          providerRequestId: purchase.providerRequestId,
          purchaseId: purchase._id,
          rialAmount: purchase.rialAmount,
          asset: 'IRR',
          eventType: p.outcome,
          eventId: `demo_mockevt_${purchase._id}_${p.outcome}`
        };
        const raw: RawCallback = { ...fields, signature: provider.sign(fields) };
        const verified = services.payments.provider.verifyCallback(raw);
        await services.payments.handleVerifiedCallback(verified);
      }
    }
    summary.record('mock purchases', purchases, purchasesReused);
  }

  // One active admin_correction hold on a funded account (finance-visible reservation).
  const holder = users.get('player-01');
  if (holder !== undefined) {
    const businessRef = `hold:${demoRef('hold', 'player-01')}`;
    const existing = await services.db.collection('dragon_coin_holds').findOne({ businessRef } as never);
    if (existing === null) {
      try {
        const hold = await services.holds.createHold(sysContext(), holder.accountId, {
          purpose: 'admin_correction',
          amount: 500,
          businessRef,
          idempotencyKey: newIdemKey('hold:player-01'),
          metadata: { note: 'demo seed hold example' }
        });
        await registry.record({ demoSeedKey: demoRef('hold', 'player-01'), domainType: 'hold', collection: 'dragon_coin_holds', recordId: hold._id, resettable: false, businessRef });
        summary.record('holds', 1, 0);
      } catch {
        summary.skip('active hold (insufficient available balance)');
      }
    } else {
      summary.record('holds', 0, 1);
    }
  }
}
