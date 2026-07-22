import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { runMigrations } from '../../shared/db/migrations.ts';
import { allMigrations } from '../../migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { ConflictError, ValidationError } from '../../shared/errors.ts';
import { MediaService, mediaPublicUrl, type MediaReferences } from './service.ts';
import { MongoBlobStorage } from './storage.ts';
import { MEDIA_COLLECTIONS } from './collections.ts';

/**
 * Media integration coverage (DRAGON-15): content-based validation (magic bytes, not
 * filename/MIME), size/type allowlist, staged-until-published nonpublic serving,
 * content-addressed dedup, referenced-delete block, and alt text. Requires
 * `npm run db:test:up`.
 */

let fixture: TestDatabase;
let media: MediaService;
const referenced = new Set<string>();
const references: MediaReferences = { isReferenced: (url) => Promise.resolve(referenced.has(url)) };

// Minimal valid signatures padded to a few bytes.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x10, 0x20, 0x30]);
const WEBP = Buffer.concat([Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]), Buffer.from('WEBP'), Buffer.from([0x11, 0x22])]);
const b64 = (b: Buffer) => b.toString('base64');

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  media = new MediaService(fixture.database, new MongoBlobStorage(fixture.database.db), { mediaMaxBytes: 1000 }, references);
});
after(async () => {
  await fixture.dispose();
});
beforeEach(async () => {
  for (const name of [...Object.values(MEDIA_COLLECTIONS), 'audit_events']) {
    await fixture.database.db.collection(name).deleteMany({});
  }
  referenced.clear();
});

const ctx = () => createRequestContext(newId(), { kind: 'account', accountId: newId(), roles: [] });

describe('content-based validation (MEDIA-001/002)', () => {
  test('a PNG/JPEG/WEBP is accepted and typed from its bytes', async () => {
    assert.equal((await media.upload(ctx(), newId(), { data: b64(PNG) })).contentType, 'image/png');
    assert.equal((await media.upload(ctx(), newId(), { data: b64(JPEG) })).contentType, 'image/jpeg');
    assert.equal((await media.upload(ctx(), newId(), { data: b64(WEBP) })).contentType, 'image/webp');
  });

  test('a non-image (even with an image-looking base64) is rejected by signature', async () => {
    await assert.rejects(() => media.upload(ctx(), newId(), { data: b64(Buffer.from('<html>not an image</html>')) }), (e: unknown) => e instanceof ValidationError && /type is not allowed/.test((e as ValidationError).message));
  });

  test('an oversize upload is rejected before validation', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(1000)]);
    await assert.rejects(() => media.upload(ctx(), newId(), { data: b64(big) }), (e: unknown) => e instanceof ValidationError && /maximum size/.test((e as ValidationError).message));
  });

  test('an empty upload is rejected', async () => {
    await assert.rejects(() => media.upload(ctx(), newId(), { data: '' }), ValidationError);
  });
});

describe('staging, publication, and public serving (MEDIA-003/007)', () => {
  test('a staged asset is not served publicly; publishing makes it served with its real content-type', async () => {
    const staged = await media.upload(ctx(), newId(), { data: b64(PNG) });
    assert.equal(staged.state, 'staged');
    assert.equal(await media.getPublishedBytes(staged._id), null);

    const published = await media.publish(ctx(), staged._id, staged.version);
    assert.equal(published.state, 'published');
    const served = await media.getPublishedBytes(staged._id);
    assert.notEqual(served, null);
    assert.equal(served?.record.contentType, 'image/png');
    assert.deepEqual(served?.bytes, PNG);
  });

  test('identical bytes deduplicate to one content-addressed asset', async () => {
    const a = await media.upload(ctx(), newId(), { data: b64(PNG) });
    const b = await media.upload(ctx(), newId(), { data: b64(PNG) });
    assert.equal(a._id, b._id);
    assert.equal(a.sha256, b.sha256);
  });

  test('a stale publish version is rejected', async () => {
    const staged = await media.upload(ctx(), newId(), { data: b64(JPEG) });
    await assert.rejects(() => media.publish(ctx(), staged._id, staged.version + 5), ConflictError);
  });
});

describe('delete block + alt text (MEDIA-008/009/010)', () => {
  test('deleting a referenced asset is blocked; an unreferenced asset deletes and its bytes are removed', async () => {
    const asset = await media.upload(ctx(), newId(), { data: b64(PNG) });
    await media.publish(ctx(), asset._id, asset.version);
    referenced.add(mediaPublicUrl(asset._id));
    await assert.rejects(() => media.delete(ctx(), asset._id), (e: unknown) => e instanceof ConflictError && (e as ConflictError).code === 'MEDIA_IN_USE');

    referenced.clear();
    await media.delete(ctx(), asset._id);
    assert.equal(await media.getForAdmin(asset._id), null);
    // A fresh upload of the same content must re-store the bytes (they were removed).
    const again = await media.upload(ctx(), newId(), { data: b64(PNG) });
    await media.publish(ctx(), again._id, again.version);
    assert.notEqual(await media.getPublishedBytes(again._id), null);
  });

  test('alt text is stored and an empty string is allowed (decorative)', async () => {
    const asset = await media.upload(ctx(), newId(), { data: b64(WEBP), alt: { en: 'A dragon', fa: 'اژدها' } });
    assert.equal(asset.alt.en, 'A dragon');
    const cleared = await media.setAlt(ctx(), asset._id, { en: '', fa: '' }, asset.version);
    assert.equal(cleared.alt.en, '');
  });
});
