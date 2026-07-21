/**
 * One-time super-administrator bootstrap (deployment step, not an HTTP route).
 *
 * Usage:
 *   npm run bootstrap:superadmin --workspace @dragon/api -- --mobile 09123456789
 *
 * Safety properties:
 * - No HTTP surface: this is a separate CLI entry point, like migrations.
 * - One-time: it refuses to run once any active super administrator exists, so it
 *   cannot be used to mint additional super admins — those go through the console.
 * - No identity backdoor: it grants the role to an account that must already
 *   exist. The designated person signs in once via mobile OTP first; this only
 *   assigns the role.
 * - Audited: the grant is written as an emergency audit event in the same
 *   transaction as the assignment (ADMIN-010).
 *
 * Exit codes: 0 on success, 1 on any refusal or error.
 */
import { loadConfig } from './config.ts';
import { Database } from './shared/db/client.ts';
import { createRequestContext, SYSTEM_ACTOR } from './shared/context.ts';
import { newId } from './shared/ids.ts';
import { AppError } from './shared/errors.ts';
import { maskMobile } from './modules/identity/mobile.ts';
import { buildAdmin, buildIdentity, prepareDatabase } from './server.ts';

function parseMobile(argv: readonly string[]): string {
  const flagIndex = argv.indexOf('--mobile');
  const value = flagIndex >= 0 ? argv[flagIndex + 1] : argv[0];
  if (value === undefined || value.trim() === '') {
    throw new Error('Provide the target mobile number: -- --mobile 09123456789');
  }
  return value;
}

async function main(): Promise<void> {
  const mobile = parseMobile(process.argv.slice(2));
  const config = loadConfig();
  const database = await Database.connect(config.mongoUri);

  try {
    // Ensure collections, indexes, and the role catalogue exist before granting.
    await prepareDatabase(database);

    const { service: identity } = buildIdentity(database, config);
    const { service: admin } = buildAdmin(database);

    if (await admin.hasSuperAdmin()) {
      console.error(
        'Refused: a super administrator already exists. Grant further super admins from the admin console.'
      );
      process.exitCode = 1;
      return;
    }

    const accountId = await identity.findAccountIdByMobile(mobile);
    if (accountId === null) {
      console.error(
        `Refused: no account exists for ${maskMobile(mobile.startsWith('+') ? mobile : `+98${mobile.replace(/^0/, '')}`)}. ` +
          'Have the designated person sign in once via mobile OTP first, then re-run this command.'
      );
      process.exitCode = 1;
      return;
    }

    // System-actor context so the audit event names the bootstrap as its source.
    const context = createRequestContext(newId(), SYSTEM_ACTOR);
    const assignment = await admin.bootstrapFirstSuperAdmin(accountId, context);

    console.log('Super administrator bootstrapped.');
    console.log(`  account:    ${accountId}`);
    console.log(`  assignment: ${assignment._id}`);
    console.log('  An emergency audit event (superadmin.bootstrapped) was recorded.');
  } catch (error) {
    // AppError messages are user-safe; anything else is reported generically.
    console.error(`Bootstrap failed: ${error instanceof AppError ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}

await main();
