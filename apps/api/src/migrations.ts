import type { Migration } from './shared/db/migrations.ts';
import { foundationMigration } from './shared/db/migrations/001-foundation.ts';
import { identityMigration } from './modules/identity/migrations.ts';
import { adminMigration } from './modules/admin/migrations.ts';
import { contentMigration } from './modules/content/migrations.ts';
import { gamesMigration } from './modules/games/migrations.ts';

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
  gamesMigration
];
