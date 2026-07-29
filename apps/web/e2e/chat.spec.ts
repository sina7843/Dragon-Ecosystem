import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { uniqueMobile, uniqueSuffix } from './helpers.ts';

/**
 * Live chat journey (DRAGON-19, CHAT-001..008, PAGE-028/053).
 *
 * The API suite covers the permission and delivery matrix exhaustively. These tests prove
 * the browser honours the same boundaries in both locales and at every viewport: a signed
 * out visitor cannot send, a timed-out viewer is refused by the server and told so, a
 * removed message loses its body on screen, and the moderation console is guarded.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

async function apiWithRoles(browser: Browser, roles: string[]): Promise<APIRequestContext> {
  const api = (await browser.newContext()).request;
  const mobile = uniqueMobile();
  await api.post('/api/v1/auth/otp/request', { data: { mobile } });
  const inbox = await api.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await api.post('/api/v1/auth/otp/verify', { data: { mobile, code } });
  for (const role of roles) {
    expect((await api.post('/api/v1/dev/grant-role', { data: { mobile, role } })).ok()).toBe(true);
  }
  return api;
}

/** Signs the page in and returns the account id, so a moderator can target this viewer. */
async function signIn(page: Page, locale: 'fa' | 'en', roles: string[] = []): Promise<string> {
  const mobile = uniqueMobile();
  await page.goto(`/${locale}/auth/mobile`);
  await page.locator('#auth-mobile').fill(mobile);
  await page.getByTestId('request-code').click();
  await expect(page.getByTestId('code-sent')).toBeVisible();
  const inbox = await page.request.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await page.locator('#auth-code').fill(code);
  await page.getByTestId('verify-code').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/account(?:/profile)?$`));
  for (const role of roles) {
    expect((await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role } })).ok()).toBe(true);
  }
  const session = await page.request.get('/api/v1/auth/session');
  return ((await session.json()) as { account: { id: string } }).account.id;
}

interface Row {
  id: string;
  slug: string;
  version: number;
}

/** Drives a stream to live and opens its chat room; returns the stream slug/id and room id. */
async function liveStreamWithChat(
  api: APIRequestContext,
  accessMode: 'public' | 'authenticated' = 'public'
): Promise<{ slug: string; streamId: string; roomId: string }> {
  const slug = `chat-e2e-${uniqueSuffix()}`;
  const created = await api.post('/api/v1/admin/streams', {
    data: {
      slug,
      accessMode,
      scheduledStartAt: '2026-09-01T18:00:00.000Z',
      translations: { fa: { title: 'پخش گفت‌وگو', summary: 'توضیح' }, en: { title: 'Chat stream', summary: 'Summary' } }
    }
  });
  expect(created.ok()).toBe(true);
  let stream = (await created.json()) as Row;

  const rights = await api.post(`/api/v1/admin/streams/${stream.id}/rights`, {
    data: { expectedVersion: stream.version, reference: 'E2E-CHAT-RIGHTS' }
  });
  stream = (await rights.json()) as Row;
  const provisioned = await api.post(`/api/v1/admin/streams/${stream.id}/provision`);
  stream = (await provisioned.json()) as Row;
  for (const state of ['scheduled', 'live'] as const) {
    const moved = await api.post(`/api/v1/admin/streams/${stream.id}/state`, {
      data: { state, expectedVersion: stream.version, reason: `Moving to ${state}.` }
    });
    expect(moved.ok()).toBe(true);
    stream = (await moved.json()) as Row;
  }

  const room = await api.post('/api/v1/admin/chat/rooms', { data: { streamId: stream.id } });
  expect(room.ok()).toBe(true);
  return { slug, streamId: stream.id, roomId: ((await room.json()) as { id: string }).id };
}

for (const locale of ['fa', 'en'] as const) {
  test(`a signed-in viewer sends a chat message and sees it in the log (${locale})`, async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['streaming_operator', 'live_chat_moderator']);
    const { slug } = await liveStreamWithChat(api);

    await signIn(page, locale);
    await page.goto(`/${locale}/streams/${slug}`);

    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByTestId('chat-empty')).toBeVisible();

    const text = `hello ${uniqueSuffix()}`;
    await page.getByTestId('chat-input').fill(text);
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-log')).toContainText(text);

    const main = await page.locator('main').innerText();
    expect(main).not.toMatch(RAW_KEY_PATTERN);
  });

  test(`a signed-out visitor can read chat but is told to sign in to send (${locale})`, async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['streaming_operator', 'live_chat_moderator']);
    const { slug } = await liveStreamWithChat(api);

    await page.goto(`/${locale}/streams/${slug}`);
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByTestId('chat-sign-in')).toBeVisible();
    // No send control is offered, and the server would refuse one anyway.
    await expect(page.getByTestId('chat-input')).toHaveCount(0);

    const main = await page.locator('main').innerText();
    expect(main).not.toMatch(RAW_KEY_PATTERN);
  });
}

test('a timed-out viewer is refused by the server and shown why', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['streaming_operator', 'live_chat_moderator']);
  const { slug, roomId } = await liveStreamWithChat(api);

  const accountId = await signIn(page, 'en');
  await page.goto(`/en/streams/${slug}`);
  await page.getByTestId('chat-input').fill('before the timeout');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-log')).toContainText('before the timeout');

  const timeout = await api.post(`/api/v1/admin/chat/users/${accountId}/timeouts`, {
    data: { roomId, reason: 'Spamming the room.', durationSeconds: 600 }
  });
  expect(timeout.ok()).toBe(true);

  await page.getByTestId('chat-input').fill('during the timeout');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-send-error')).toBeVisible();
  await expect(page.getByTestId('chat-log')).not.toContainText('during the timeout');
});

test('a removed message loses its body on screen but stays in the moderator feed', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['streaming_operator', 'live_chat_moderator']);
  const { slug, streamId, roomId } = await liveStreamWithChat(api);

  await signIn(page, 'en');
  await page.goto(`/en/streams/${slug}`);
  const text = `removable ${uniqueSuffix()}`;
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-log')).toContainText(text);

  const feed = await api.get(`/api/v1/streams/${streamId}/chat/messages`);
  const messageId = ((await feed.json()) as { items: Array<{ id: string; body: string }> }).items.find((m) => m.body === text)?.id ?? '';
  expect(messageId).not.toBe('');

  const removed = await api.post(`/api/v1/admin/chat/rooms/${roomId}/messages/${messageId}/remove`, {
    data: { reason: 'Removed during the browser test.' }
  });
  expect(removed.ok()).toBe(true);

  // The panel polls, so the already-rendered message is replaced by a tombstone.
  await expect(page.getByTestId(`chat-removed-${messageId}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat-log')).not.toContainText(text);

  // The evidence is still readable to a moderator (CHAT-005).
  const evidence = await api.get(`/api/v1/admin/chat/messages/${messageId}`);
  expect(((await evidence.json()) as { body: string }).body).toBe(text);
});

test('chat is not offered for a stream that has no room', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['streaming_operator']);
  const slug = `no-room-${uniqueSuffix()}`;
  const created = await api.post('/api/v1/admin/streams', {
    data: {
      slug,
      scheduledStartAt: '2026-09-01T18:00:00.000Z',
      translations: { fa: { title: 'بدون گفت‌وگو' }, en: { title: 'No chat stream' } }
    }
  });
  let stream = (await created.json()) as Row;
  const rights = await api.post(`/api/v1/admin/streams/${stream.id}/rights`, { data: { expectedVersion: stream.version, reference: 'R' } });
  stream = (await rights.json()) as Row;
  const scheduled = await api.post(`/api/v1/admin/streams/${stream.id}/state`, {
    data: { state: 'scheduled', expectedVersion: stream.version, reason: 'Publishing.' }
  });
  expect(scheduled.ok()).toBe(true);

  await page.goto(`/en/streams/${slug}`);
  await expect(page.getByTestId('chat-unavailable')).toBeVisible();
  await expect(page.getByTestId('chat-input')).toHaveCount(0);
});

test('the chat moderation console is guarded, and a moderator can act in it', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['streaming_operator', 'live_chat_moderator']);
  const { slug, roomId } = await liveStreamWithChat(api);

  // An ordinary signed-in user sees the forbidden state and no console.
  await signIn(page, 'en');
  await page.goto('/en/admin/chat');
  await expect(page.getByTestId('chat-forbidden')).toBeVisible();
  await expect(page.getByTestId('chat-room-list')).toHaveCount(0);

  // Post a message as that viewer so the moderator has something to act on.
  await page.goto(`/en/streams/${slug}`);
  const text = `moderate me ${uniqueSuffix()}`;
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-log')).toContainText(text);

  // A live-chat moderator sees the console and the room.
  const moderatorPage = await (await browser.newContext()).newPage();
  await signIn(moderatorPage, 'en', ['live_chat_moderator']);
  await moderatorPage.goto('/en/admin/chat');
  await expect(moderatorPage.getByTestId('chat-room-list')).toBeVisible();
  await moderatorPage.getByTestId(`select-room-${roomId}`).click();
  await expect(moderatorPage.getByTestId('chat-message-list')).toContainText(text);

  const main = await moderatorPage.locator('main').innerText();
  expect(main).not.toMatch(RAW_KEY_PATTERN);
  await moderatorPage.close();
});
