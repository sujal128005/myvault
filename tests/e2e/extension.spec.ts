/**
 * Loads the built extension (dist/extension) into Chromium.
 *
 * Test-only harness changes (never shipped): the copy loaded here gets a host permission
 * for http://127.0.0.1 and the popup's chrome.tabs.query is pointed at the fixture tab,
 * because automated tests cannot click the toolbar button that grants `activeTab`.
 */
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fillLoginInPage } from '../../src/extension/pageScripts';

const PINNED_ID = 'fjajonfdjlelioggldgljngpccipocad';
const MP = 'Velvet-Harbor-Quartz-58!';
const DIST = resolve('dist/extension');

let ctx: BrowserContext;
let sw: Worker;
let extId: string;
let server: Server;
let origin: string;
let workDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!existsSync(join(DIST, 'manifest.json'))) throw new Error('Run `npm run build:ext` first');
  const fixture = readFileSync(resolve('tests/fixtures/login.html'));
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(fixture);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  workDir = mkdtempSync(join(tmpdir(), 'myvault-e2e-'));
  const extDir = join(workDir, 'ext');
  cpSync(DIST, extDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest));

  ctx = await chromium.launchPersistentContext(join(workDir, 'profile'), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  extId = new URL(sw.url()).host;
});

test.afterAll(async () => {
  await ctx?.close();
  server?.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function openPopup(): Promise<Page> {
  const popup = await ctx.newPage();
  // Point "the active tab" at the fixture login page (see header comment).
  await popup.addInitScript(() => {
    const orig = chrome.tabs.query.bind(chrome.tabs);
    (chrome.tabs as { query: unknown }).query = async (q: chrome.tabs.QueryInfo) => (q.active ? orig({ url: 'http://127.0.0.1/*' }) : orig(q));
  });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  return popup;
}

test('shipped manifest is minimal: no host permissions, no content scripts, strict CSP, pinned ID', () => {
  const m = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
  expect(m.manifest_version).toBe(3);
  expect(m.host_permissions).toBeUndefined();
  expect(m.content_scripts).toBeUndefined();
  expect(m.externally_connectable).toBeUndefined();
  expect(m.web_accessible_resources).toBeUndefined();
  expect(m.permissions.sort()).toEqual(['activeTab', 'alarms', 'clipboardWrite', 'idle', 'offscreen', 'scripting', 'storage', 'unlimitedStorage']);
  expect(m.content_security_policy.extension_pages).toContain("connect-src 'none'");
  expect(m.content_security_policy.extension_pages).not.toContain("'unsafe-eval'");
  expect(m.content_security_policy.extension_pages).not.toContain("'unsafe-inline'");
  expect(extId).toBe(PINNED_ID);
});

test('create vault in the full-page manager and save a login', async () => {
  const vault = await ctx.newPage();
  await vault.goto(`chrome-extension://${extId}/vault.html`);
  await vault.getByRole('button', { name: 'Create Your Vault' }).click();
  await vault.getByLabel('Master password', { exact: true }).fill(MP);
  await vault.getByLabel('Confirm master password', { exact: true }).fill(MP);
  await vault.getByRole('checkbox').check();
  await vault.getByRole('button', { name: 'Create Vault' }).click();
  await expect(vault.getByText('Your vault is empty')).toBeVisible();
  for (const [title, url, user, pw] of [
    ['Fixture Site', origin, 'alice@example.com', 'Fixture-Pass-123!'],
    ['Other Site', 'https://other.example.net', 'bob', 'Other-Pass-456!'],
  ]) {
    await vault.getByRole('button', { name: 'New item', exact: true }).click();
    await vault.getByLabel('Title', { exact: true }).fill(title!);
    await vault.getByPlaceholder('Username').fill(user!);
    await vault.getByLabel('Password', { exact: true }).fill(pw!);
    await vault.getByLabel('Website', { exact: true }).first().fill(url!);
    await vault.getByRole('button', { name: 'Add Item' }).click();
    await expect(vault.getByRole('heading', { name: title, level: 2 })).toBeVisible();
  }
});

test('popup shares the unlock, suggests only matching logins, and fills after a click', async () => {
  const site = await ctx.newPage();
  await site.goto(`${origin}/login`);
  const popup = await openPopup();
  await expect(popup.locator('.site-chip')).toContainText('127.0.0.1');
  await expect(popup.locator('.pop-item')).toHaveCount(1);
  await expect(popup.locator('.pop-item')).toContainText('Fixture Site');
  await expect(popup.getByText('Other Site')).toHaveCount(0);
  // Nothing is filled until the user clicks.
  await expect(site.locator('#pass')).toHaveValue('');
  await Promise.all([popup.waitForEvent('close'), popup.getByRole('button', { name: 'Fill', exact: true }).click()]);
  await expect(site.locator('#user')).toHaveValue('alice@example.com');
  await expect(site.locator('#pass')).toHaveValue('Fixture-Pass-123!');
  await expect(site.locator('input[name=q]')).toHaveValue('');
  await expect(site.locator('#events')).toContainText('user;pass;');
});

test('search hides Fill for logins of other sites', async () => {
  const popup = await openPopup();
  await popup.getByRole('button', { name: 'Search', exact: true }).click();
  await popup.getByLabel('Search vault').fill('Other');
  await expect(popup.locator('.pop-item')).toHaveCount(1);
  await expect(popup.locator('.pop-item').getByRole('button', { name: 'Fill' })).toHaveCount(0);
  await popup.close();
});

test('copying schedules clipboard clearing in the background worker', async () => {
  const popup = await openPopup();
  await popup.getByRole('button', { name: 'More actions for Fixture Site' }).click();
  await popup.locator('.pop-extra').getByRole('button', { name: 'Password' }).click();
  await expect(popup.getByText('Password copied')).toBeVisible();
  const alarm = await sw.evaluate(() => chrome.alarms.get('myvault-clipboard'));
  expect(alarm).toBeTruthy();
  await popup.close();
});

test('save a new login from the popup with the generator', async () => {
  const popup = await openPopup();
  await popup.getByRole('button', { name: 'Add', exact: true }).click();
  await popup.getByPlaceholder('Title').fill('Second Account');
  await popup.getByPlaceholder('Username').fill('carol');
  await popup.getByRole('button', { name: 'Generate password' }).click();
  await expect(popup.getByLabel('Password', { exact: true })).toHaveValue(/.{20}/);
  await popup.getByRole('button', { name: 'Save Login' }).click();
  await expect(popup.locator('.pop-item')).toHaveCount(2);
  await popup.close();
});

test('locking in the popup locks the full-page manager; unlocking follows too', async () => {
  const vault = ctx.pages().find((p) => p.url().endsWith('/vault.html'))!;
  await expect(vault.locator('.item-row')).toHaveCount(3);
  const popup = await openPopup();
  await popup.getByRole('button', { name: 'Lock vault' }).click();
  await expect(popup.getByText('Enter your master password to unlock.')).toBeVisible();
  await expect(vault.getByText('Enter your master password to unlock.')).toBeVisible();
  const session = await sw.evaluate(() => chrome.storage.session.get(null));
  expect(session.mv_session).toBeUndefined();

  await popup.getByLabel('Master password').fill('wrong password!!');
  await popup.keyboard.press('Enter');
  await expect(popup.getByText('Incorrect password.')).toBeVisible();
  await popup.getByLabel('Master password').fill(MP);
  await popup.keyboard.press('Enter');
  await expect(popup.locator('.pop-item').first()).toBeVisible();
  await expect(vault.locator('.item-row')).toHaveCount(3);
  await popup.close();
});

test('background worker auto-locks after inactivity', async () => {
  const vault = ctx.pages().find((p) => p.url().endsWith('/vault.html'))!;
  await sw.evaluate(() => chrome.storage.session.set({ mv_activity: Date.now() - 24 * 3600_000 }));
  await expect(vault.getByText('Enter your master password to unlock.')).toBeVisible({ timeout: 45_000 });
  const session = await sw.evaluate(() => chrome.storage.session.get(null));
  expect(session.mv_session).toBeUndefined();
});

test('extension storage contains only ciphertext', async () => {
  const vault = ctx.pages().find((p) => p.url().endsWith('/vault.html'))!;
  const dump = await vault.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open('myvault');
        req.onsuccess = () => {
          const tx = req.result.transaction(['vault', 'snapshots'], 'readonly');
          const a = tx.objectStore('vault').getAll();
          const b = tx.objectStore('snapshots').getAll();
          tx.oncomplete = () => resolve(JSON.stringify([a.result, b.result]));
        };
      }),
  );
  for (const s of ['Fixture-Pass-123!', 'alice@example.com', 'Fixture Site', MP]) expect(dump).not.toContain(s);
  const local = await sw.evaluate(() => chrome.storage.local.get(null));
  expect(local).toEqual({});
});

test('in-page fill script refuses a different origin and skips search boxes', async () => {
  const site = await ctx.newPage();
  await site.goto(`${origin}/login`);
  // Inject the function exactly as chrome.scripting would: serialised, with no outer scope.
  await site.addScriptTag({ content: `window.__fill = ${fillLoginInPage.toString()};` });
  type W = { __fill: typeof fillLoginInPage };
  const fill = (args: [string, string, string]) => site.evaluate((a) => (window as unknown as W).__fill(...a), args);
  const refused = await fill(['https://evil.example', 'u', 'p']);
  expect(refused).toEqual({ ok: false, reason: 'origin-mismatch' });
  await expect(site.locator('#pass')).toHaveValue('');
  const ok = await fill([origin, 'me@example.com', 'pw-1']);
  expect(ok, JSON.stringify(ok)).toMatchObject({ ok: true, filledUsername: true, filledPassword: true });
  await expect(site.locator('#user')).toHaveValue('me@example.com');
  await expect(site.locator('input[name=q]')).toHaveValue('');
  await expect(site.locator('#newpass')).toHaveValue('');
});
