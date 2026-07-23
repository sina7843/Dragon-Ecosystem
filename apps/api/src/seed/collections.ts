/**
 * Immutable / append-only domain collections the demo seeder writes to through services
 * but must NEVER carry a demo marker field or be mutated/deleted after creation. Demo
 * ownership for these is tracked only in demo_seed_registry (see registry.ts). This list
 * exists for documentation and for the immutability test, which asserts no row in any of
 * these collections ever gains a demoSeedKey field.
 */
export const DEMO_IMMUTABLE_COLLECTIONS: readonly string[] = [
  'ledger_accounts',
  'ledger_entries',
  'ledger_transactions',
  'dragon_coin_holds',
  'dragon_coin_purchases',
  'registrations',
  'registration_checkouts',
  'prize_allocations',
  'prize_entitlements',
  'competition_bracket_versions',
  'competition_result_corrections',
  'competition_matches',
  'competition_standings',
  'notifications',
  'notification_deliveries',
  'analytics_events',
  'audit_events',
  'domain_event_outbox'
];
