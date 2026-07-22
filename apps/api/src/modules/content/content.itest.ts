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

/**
 * Content publishing integration coverage (CONTENT-001..008, section 16).
 * Requires the disposable test database: `npm run db:test:up`.
 */

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
  for (const name of ['content_items', 'content_revisions', 'categories', 'tags', 'role_assignments', 'audit_events']) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

let mobileCounter = 2_000_000;
async function login(): Promise<{ cookie: string; accountId: string }> {
  mobileCounter += 1;
  const mobile = `0912${String(mobileCounter)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie } });
  return { cookie, accountId: session.json<{ account: { id: string } }>().account.id };
}

async function loginAs(role: string): Promise<{ cookie: string; accountId: string }> {
  const s = await login();
  await roleAssignments(fixture.database.db).insertOne({
    _id: newId(),
    accountId: s.accountId,
    role,
    scopeType: GLOBAL_SCOPE_TYPE,
    scopeId: GLOBAL_SCOPE_ID,
    grantedBy: 'test',
    grantedAt: utcNow(),
    revokedAt: null
  });
  return s;
}

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

const completeDraft = {
  type: 'article',
  translations: {
    fa: { title: 'عنوان', summary: 'خلاصه', body: '<p>متن</p>' },
    en: { title: 'Title', summary: 'Summary', body: '<p>Body</p>' }
  }
};

/** Creates a published article and returns its slugs. */
async function publishArticle(publisherCookie: string, overrides: Record<string, unknown> = {}): Promise<{
  id: string;
  slugFa: string;
  slugEn: string;
}> {
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/content',
    ...auth(publisherCookie),
    payload: { ...completeDraft, ...overrides }
  });
  const draft = create.json<{ id: string; slugs: { fa: string; en: string } }>();
  await app.inject({
    method: 'POST',
    url: `/api/v1/admin/content/${draft.id}/transition`,
    ...auth(publisherCookie),
    payload: { to: 'in_review', reason: 'ready' }
  });
  const publish = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/content/${draft.id}/transition`,
    ...auth(publisherCookie),
    payload: { to: 'published', reason: 'go live' }
  });
  assert.equal(publish.statusCode, 200, publish.body);
  return { id: draft.id, slugFa: draft.slugs.fa, slugEn: draft.slugs.en };
}

describe('authoring authorization', () => {
  test('anonymous and ordinary users cannot author', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/content' })).statusCode, 401);
    const { cookie } = await login();
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/content', ...auth(cookie) })).statusCode, 403);
  });

  test('an author can draft but cannot publish; a publisher can', async () => {
    const author = await loginAs('content_author');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(author.cookie),
      payload: completeDraft
    });
    assert.equal(create.statusCode, 201);
    const draft = create.json<{ id: string }>();

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/${draft.id}/transition`,
      ...auth(author.cookie),
      payload: { to: 'in_review', reason: 'ready' }
    });
    // Author lacks content.publish: the publish transition is forbidden.
    const authorPublish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/${draft.id}/transition`,
      ...auth(author.cookie),
      payload: { to: 'published', reason: 'try' }
    });
    assert.equal(authorPublish.statusCode, 403);

    const publisher = await loginAs('content_publisher');
    const publish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/${draft.id}/transition`,
      ...auth(publisher.cookie),
      payload: { to: 'published', reason: 'go live' }
    });
    assert.equal(publish.statusCode, 200);
  });
});

describe('publication rules', () => {
  test('publishing is blocked unless both locales are complete (CONTENT-004)', async () => {
    const publisher = await loginAs('content_publisher');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(publisher.cookie),
      // English only.
      payload: { type: 'news', translations: { en: { title: 'Only English', summary: 's', body: '<p>b</p>' } } }
    });
    const draft = create.json<{ id: string }>();
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/${draft.id}/transition`,
      ...auth(publisher.cookie),
      payload: { to: 'in_review', reason: 'r' }
    });
    const publish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/${draft.id}/transition`,
      ...auth(publisher.cookie),
      payload: { to: 'published', reason: 'go' }
    });
    assert.equal(publish.statusCode, 422);
    const codes = publish.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors.map((f) => f.code);
    assert.ok(codes.includes('REQUIRED_FOR_PUBLICATION'));
  });

  test('the body is sanitised on write (CONTENT-005)', async () => {
    const publisher = await loginAs('content_publisher');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(publisher.cookie),
      payload: {
        type: 'guide',
        translations: {
          fa: { title: 'ف', summary: 'ف', body: '<p>ok</p><script>alert(1)</script>' },
          en: { title: 'E', summary: 'E', body: '<p>ok</p><img src=x onerror=alert(1)>' }
        }
      }
    });
    const item = create.json<{ translations: { en: { body: string } } }>();
    assert.ok(!item.translations.en.body.includes('onerror'));
    assert.ok(!JSON.stringify(item.translations).includes('<script'));
  });

  test('an invalid state transition is rejected', async () => {
    const publisher = await loginAs('content_publisher');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(publisher.cookie),
      payload: completeDraft
    });
    const draft = create.json<{ id: string }>();
    // draft → published skips review.
    const jump = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/${draft.id}/transition`,
      ...auth(publisher.cookie),
      payload: { to: 'published', reason: 'skip' }
    });
    assert.equal(jump.statusCode, 422);
  });

  test('optimistic concurrency: a stale update is rejected (ADMIN-005)', async () => {
    const publisher = await loginAs('content_publisher');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(publisher.cookie),
      payload: completeDraft
    });
    const draft = create.json<{ id: string; version: number }>();
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/content/${draft.id}`,
      ...auth(publisher.cookie),
      payload: { expectedVersion: draft.version + 5, translations: { en: { title: 'x' } } }
    });
    assert.equal(stale.statusCode, 409);
  });

  test('version history records every change (CONTENT-007)', async () => {
    const publisher = await loginAs('content_publisher');
    const { id } = await publishArticle(publisher.cookie);
    const revisions = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/content/${id}/revisions`,
      ...auth(publisher.cookie)
    });
    // created, in_review, published → at least 3 versions.
    assert.ok(revisions.json<unknown[]>().length >= 3);
  });
});

describe('public read side never leaks drafts', () => {
  test('a published article is readable by localized slug; the alternate locale is exposed', async () => {
    const publisher = await loginAs('content_publisher');
    const { slugFa, slugEn } = await publishArticle(publisher.cookie);

    const en = await app.inject({ method: 'GET', url: `/api/v1/content/article/${slugEn}?locale=en` });
    assert.equal(en.statusCode, 200);
    const body = en.json<{ title: string; alternateSlugs: { fa: string; en: string } }>();
    assert.equal(body.title, 'Title');
    // hreflang needs the alternate-locale slug.
    assert.equal(body.alternateSlugs.fa, slugFa);

    const fa = await app.inject({ method: 'GET', url: `/api/v1/content/article/${slugFa}?locale=fa` });
    assert.equal(fa.json<{ title: string }>().title, 'عنوان');
  });

  test('a draft is not public and returns 404, indistinguishable from unknown', async () => {
    const publisher = await loginAs('content_publisher');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(publisher.cookie),
      payload: completeDraft
    });
    const draft = create.json<{ slugs: { en: string } }>();

    const publicRead = await app.inject({ method: 'GET', url: `/api/v1/content/article/${draft.slugs.en}?locale=en` });
    assert.equal(publicRead.statusCode, 404);
    const unknown = await app.inject({ method: 'GET', url: '/api/v1/content/article/no-such-slug?locale=en' });
    assert.equal(unknown.statusCode, 404);
  });

  test('a scheduled (future) publish is not visible yet', async () => {
    const publisher = await loginAs('content_publisher');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(publisher.cookie),
      payload: completeDraft
    });
    const draft = create.json<{ id: string; slugs: { en: string } }>();
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/${draft.id}/transition`,
      ...auth(publisher.cookie),
      payload: { to: 'in_review', reason: 'r' }
    });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const publish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/content/${draft.id}/transition`,
      ...auth(publisher.cookie),
      payload: { to: 'published', reason: 'schedule', publishAt: future }
    });
    assert.equal(publish.statusCode, 200);

    // State is published but the publish time is in the future → not visible.
    const publicRead = await app.inject({ method: 'GET', url: `/api/v1/content/article/${draft.slugs.en}?locale=en` });
    assert.equal(publicRead.statusCode, 404);
    const list = await app.inject({ method: 'GET', url: '/api/v1/content?locale=en' });
    assert.equal(list.json<{ items: unknown[] }>().items.length, 0);
  });

  test('listing and filtering return only published items', async () => {
    const publisher = await loginAs('content_publisher');
    await publishArticle(publisher.cookie);
    // A second, unpublished draft must not appear.
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(publisher.cookie),
      payload: { ...completeDraft, type: 'news' }
    });

    const list = await app.inject({ method: 'GET', url: '/api/v1/content?locale=en' });
    const items = list.json<{ items: Array<{ type: string }> }>().items;
    assert.equal(items.length, 1);
    assert.equal(items[0]?.type, 'article');

    // Filtering by a type with no published items is empty, not an error.
    const news = await app.inject({ method: 'GET', url: '/api/v1/content?locale=en&type=news' });
    assert.equal(news.json<{ items: unknown[] }>().items.length, 0);
  });

  test('a duplicate slug for the same type is rejected', async () => {
    const publisher = await loginAs('content_publisher');
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(publisher.cookie),
      payload: { ...completeDraft, slugs: { fa: 'ثابت', en: 'fixed-slug' } }
    });
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/content',
      ...auth(publisher.cookie),
      payload: { ...completeDraft, slugs: { fa: 'ثابت۲', en: 'fixed-slug' } }
    });
    assert.equal(dup.statusCode, 422);
    assert.equal(dup.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'SLUG_TAKEN');
  });
});
