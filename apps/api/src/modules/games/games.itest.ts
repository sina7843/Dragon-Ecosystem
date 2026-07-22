import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildContent, buildGames, buildIdentity, buildServer } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../admin/store.ts';

/** Games catalog integration coverage. Requires the disposable test database. */

let fixture: TestDatabase;
let app: FastifyInstance;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  const config = loadConfig({ NODE_ENV: 'test' });
  const identity = buildIdentity(fixture.database, config);
  app = buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    content: buildContent(fixture.database),
    games: buildGames(fixture.database)
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await fixture.dispose();
});

beforeEach(async () => {
  for (const name of ['games', 'role_assignments', 'audit_events']) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

let counter = 3_000_000;
async function loginAs(role?: string): Promise<{ cookie: string; accountId: string }> {
  counter += 1;
  const mobile = `0912${String(counter)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie } });
  const accountId = session.json<{ account: { id: string } }>().account.id;
  if (role !== undefined) {
    await roleAssignments(fixture.database.db).insertOne({
      _id: newId(),
      accountId,
      role,
      scopeType: GLOBAL_SCOPE_TYPE,
      scopeId: GLOBAL_SCOPE_ID,
      grantedBy: 'test',
      grantedAt: utcNow(),
      revokedAt: null
    });
  }
  return { cookie, accountId };
}

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

const validGame = {
  slug: 'dragon-legends',
  translations: { fa: { name: 'افسانه اژدها' }, en: { name: 'Dragon Legends' } }
};

async function publishGame(cookie: string): Promise<string> {
  const create = await app.inject({ method: 'POST', url: '/api/v1/admin/games', ...auth(cookie), payload: validGame });
  assert.equal(create.statusCode, 201, create.body);
  const game = create.json<{ id: string }>();
  const publish = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/games/${game.id}/status`,
    ...auth(cookie),
    payload: { status: 'published', reason: 'launch' }
  });
  assert.equal(publish.statusCode, 200, publish.body);
  return validGame.slug;
}

describe('games authorization', () => {
  test('only games.manage may administer the catalog', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/games' })).statusCode, 401);
    const user = await loginAs();
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/games', ...auth(user.cookie) })).statusCode, 403);
    const publisher = await loginAs('content_publisher');
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/games', ...auth(publisher.cookie) })).statusCode, 200);
  });
});

describe('games publication', () => {
  test('publishing requires both localized names', async () => {
    const publisher = await loginAs('content_publisher');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/games',
      ...auth(publisher.cookie),
      payload: { slug: 'partial', translations: { en: { name: 'English only' } } }
    });
    const game = create.json<{ id: string }>();
    const publish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/games/${game.id}/status`,
      ...auth(publisher.cookie),
      payload: { status: 'published', reason: 'go' }
    });
    assert.equal(publish.statusCode, 422);
  });

  test('a published game is public by slug and localized; a draft is 404', async () => {
    const publisher = await loginAs('content_publisher');

    // Create one game; while it is a draft it is not public.
    const create = await app.inject({ method: 'POST', url: '/api/v1/admin/games', ...auth(publisher.cookie), payload: validGame });
    const game = create.json<{ id: string; slug: string }>();
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/games/${game.slug}` })).statusCode, 404);

    // Publish the same game, then it becomes public and localized.
    const publish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/games/${game.id}/status`,
      ...auth(publisher.cookie),
      payload: { status: 'published', reason: 'launch' }
    });
    assert.equal(publish.statusCode, 200, publish.body);

    const en = await app.inject({ method: 'GET', url: `/api/v1/games/${game.slug}?locale=en` });
    assert.equal(en.statusCode, 200);
    assert.equal(en.json<{ name: string }>().name, 'Dragon Legends');
    const fa = await app.inject({ method: 'GET', url: `/api/v1/games/${game.slug}?locale=fa` });
    assert.equal(fa.json<{ name: string }>().name, 'افسانه اژدها');
  });

  test('archiving removes a game from the public catalog but keeps it resolvable to admin', async () => {
    const publisher = await loginAs('content_publisher');
    const slug = await publishGame(publisher.cookie);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/games' })).json<{ items: unknown[] }>().items.length, 1);

    const game = await app.inject({ method: 'GET', url: '/api/v1/admin/games', ...auth(publisher.cookie) });
    const id = game.json<{ items: Array<{ id: string }> }>().items[0]?.id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/games/${id}/status`,
      ...auth(publisher.cookie),
      payload: { status: 'archived', reason: 'retired' }
    });

    // Public catalog and detail no longer show it.
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/games' })).json<{ items: unknown[] }>().items.length, 0);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/games/${slug}` })).statusCode, 404);
    // Admin can still see it (archived, not deleted).
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/games', ...auth(publisher.cookie) })).json<{ items: unknown[] }>()
        .items.length,
      1
    );
  });
});
