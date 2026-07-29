/** Public surface of the economy module (REWARD-002..008). */
export { EconomyService, DEFAULT_ECONOMY_LIMITS, type EconomyDirectory } from './service.ts';
export { registerEconomyRoutes, type EconomyDeps } from './routes.ts';
export { economyMigration } from './migrations.ts';
export { ECONOMY_COLLECTIONS, ECONOMY_INDEXES } from './collections.ts';
export {
  decideTransfer,
  REWARD_SOURCES,
  TRANSFER_STATES,
  type CoinTransferRecord,
  type EconomyLimits,
  type RewardGrantRecord,
  type RewardRuleRecord,
  type RewardSource,
  type TransferDecision,
  type TransferState
} from './state.ts';
