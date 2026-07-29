import type { Migration } from './shared/db/migrations.ts';
import { foundationMigration } from './shared/db/migrations/001-foundation.ts';
import { identityMigration } from './modules/identity/migrations.ts';
import { adminMigration } from './modules/admin/migrations.ts';
import { contentMigration } from './modules/content/migrations.ts';
import { gamesMigration } from './modules/games/migrations.ts';
import { teamsMigration } from './modules/teams/migrations.ts';
import { tournamentsMigration } from './modules/tournaments/migrations.ts';
import { registrationsMigration } from './modules/registrations/migrations.ts';
import { competitionsMigration } from './modules/competitions/migrations.ts';
import { competitionsAdvancedMigration } from './modules/competitions/migrations-advanced.ts';
import { competitionsStandingsMigration } from './modules/competitions/migrations-standings.ts';
import { competitionsVersionsMigration } from './modules/competitions/migrations-versions.ts';
import { ledgerMigration } from './modules/ledger/migrations.ts';
import { paymentsMigration } from './modules/payments/migrations.ts';
import { holdsMigration } from './modules/holds/migrations.ts';
import { checkoutMigration } from './modules/checkout/migrations.ts';
import { prizesMigration } from './modules/prizes/migrations.ts';
import { notificationsMigration } from './modules/notifications/migrations.ts';
import { moderationMigration } from './modules/moderation/migrations.ts';
import { operationsMigration } from './modules/operations/migrations.ts';
import { mediaMigration } from './modules/media/migrations.ts';
import { streamsMigration } from './modules/streams/migrations.ts';
import { chatMigration } from './modules/chat/migrations.ts';
import { educationMigration } from './modules/education/migrations.ts';
import { socialMigration } from './modules/social/migrations.ts';
import { storeMigration } from './modules/store/migrations.ts';
import { economyMigration } from './modules/economy/migrations.ts';
import { perfIndexesMigration } from './migrations-perf-indexes.ts';
import { auditIndexesMigration } from './migrations-audit-indexes.ts';

/**
 * The ordered migration registry.
 *
 * It lives at application level rather than in `shared/` because it must know
 * both the shared foundation and the domain modules, while the shared kernel
 * itself must never depend on a module (section 32.1).
 */
export const allMigrations: readonly Migration[] = [
  foundationMigration,
  identityMigration,
  adminMigration,
  contentMigration,
  gamesMigration,
  teamsMigration,
  tournamentsMigration,
  registrationsMigration,
  competitionsMigration,
  competitionsAdvancedMigration,
  competitionsStandingsMigration,
  competitionsVersionsMigration,
  ledgerMigration,
  paymentsMigration,
  holdsMigration,
  checkoutMigration,
  prizesMigration,
  notificationsMigration,
  moderationMigration,
  operationsMigration,
  mediaMigration,
  perfIndexesMigration,
  auditIndexesMigration,
  streamsMigration,
  chatMigration,
  educationMigration,
  socialMigration,
  storeMigration,
  economyMigration
];
