import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MP = 'Granite-Lantern-Orbit-73!';

async function createVault(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Your Vault' }).click();
  await page.getByLabel('Master password', { exact: true }).fill(MP);
  await page.getByLabel('Confirm master password', { exact: true }).fill(MP);
  await page.getByRole('checkbox').check();
  await expect(page.getByText('Rated "Strong" or better')).toHaveCSS('color', /.*/);
  await page.getByRole('button', { name: 'Create Vault' }).click();
  await expect(page.getByText('Your vault is empty')).toBeVisible();
}

async function addLogin(page: Page, title: string, site: string, user: string, pw: string) {
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByPlaceholder('Username').fill(user);
  await page.getByLabel('Password', { exact: true }).fill(pw);
  await page.getByLabel('Website', { exact: true }).first().fill(site);
  await page.getByRole('button', { name: 'Add Item' }).click();
  await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible();
}

async function unlock(page: Page, pw = MP) {
  await page.getByLabel('Master password', { exact: true }).fill(pw);
  await page.keyboard.press('Enter');
}

test.describe('Website', () => {
  test('create, add, search, lock, unlock and persist across reload', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await createVault(page);
    await addLogin(page, 'GitHub', 'github.com', 'octocat', 'Sup3r-Secret-GH!');
    await addLogin(page, 'Bank', 'bank.example.com', 'me@bank', 'Another-Secret-99');

    // Password hidden by default, revealable.
    await expect(page.getByText('Another-Secret-99')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByText('Another-Secret-99')).toBeVisible();

    // Search does not match on password contents.
    const search = page.getByLabel('Search items', { exact: true });
    await search.fill('octo');
    await expect(page.locator('.item-row')).toHaveCount(1);
    await search.fill('Sup3r');
    await expect(page.locator('.item-row')).toHaveCount(0);
    await search.fill('');

    // Lock → wrong password → right password.
    await page.getByRole('button', { name: 'Lock Vault' }).click();
    await unlock(page, 'definitely wrong pw');
    await expect(page.getByText('Incorrect password.')).toBeVisible();
    await unlock(page);
    await expect(page.locator('.item-row')).toHaveCount(2);

    // Reload = locked (key never persisted on the website); data survives.
    await page.reload();
    await expect(page.getByText('Enter your master password to unlock.')).toBeVisible();
    await unlock(page);
    await expect(page.locator('.item-row')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('custom fields, TOTP, favorites, trash & restore', async ({ page }) => {
    await createVault(page);
    await page.getByRole('button', { name: 'New item', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('AWS');
    await page.getByRole('button', { name: 'Add Field' }).click();
    await page.locator('.menu button', { hasText: 'API Key' }).click();
    await page.getByLabel('API Key value', { exact: true }).fill('AKIA-SECRET-123');
    await page.getByRole('button', { name: 'Add Field' }).click();
    await page.locator('.menu button', { hasText: 'Security Question' }).click();
    await page.getByPlaceholder('Security question').fill('First pet?');
    await page.getByPlaceholder('Answer').fill('Rex');
    await page.getByRole('button', { name: 'Add Authenticator Secret' }).click();
    await page.getByLabel('Authenticator secret', { exact: true }).fill('JBSWY3DPEHPK3PXP');
    await expect(page.getByText('6-digit code every 30s')).toBeVisible();
    await page.getByRole('button', { name: 'Add Item' }).click();

    await expect(page.locator('.totp-code')).toHaveText(/^\d{3} \d{3}$/);
    await expect(page.getByText('AKIA-SECRET-123')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show API Key' }).click();
    await expect(page.getByText('AKIA-SECRET-123')).toBeVisible();

    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await page.getByRole('button', { name: /^Favorites/ }).click();
    await expect(page.locator('.item-row')).toHaveCount(1);

    await page.locator('.item-row').first().click();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.locator('.menu button', { hasText: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: /^All Items/ }).click();
    await expect(page.getByText('Your vault is empty')).toBeVisible();
    await page.getByRole('button', { name: /Recently Deleted/ }).click();
    await page.locator('.item-row').first().click();
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('button', { name: /^All Items/ }).click();
    await expect(page.locator('.item-row')).toHaveCount(1);
  });

  test('generator produces passwords honouring options', async ({ page }) => {
    await createVault(page);
    await page.getByRole('button', { name: 'Generator' }).click();
    const out = page.getByTestId('generated-password');
    await page.getByLabel('Password length (number)', { exact: true }).fill('32');
    await expect(out).toHaveText(/^.{32}$/);
    await page.getByRole('switch', { name: 'Symbols (!@#…)' }).click();
    await page.getByRole('switch', { name: 'Uppercase (A–Z)' }).click();
    await expect(out).toHaveText(/^[a-z0-9]{32}$/);
    await page.getByRole('button', { name: 'Passphrase' }).click();
    await expect(out).toHaveText(/^([A-Za-z0-9]+-){4}[A-Za-z0-9]+$/);
  });

  test('encrypted backup export → erase → restore', async ({ page }) => {
    await createVault(page);
    await addLogin(page, 'Backed Up Site', 'backup.example.com', 'user1', 'BackupPass-123!');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /Export Encrypted Backup/ }).click();
    await page.getByRole('dialog').getByLabel('Master password', { exact: true }).fill(MP);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click()]);
    const path = await download.path();
    const text = readFileSync(path!, 'utf8');
    expect(download.suggestedFilename()).toMatch(/^MyVault-backup-\d{4}-\d{2}-\d{2}\.myvault$/);
    expect(text).toContain('"format": "myvault"');
    expect(text).not.toContain('Backed Up Site');
    expect(text).not.toContain('BackupPass-123!');

    await page.getByRole('button', { name: /Erase Vault/ }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('ERASE');
    await page.getByRole('dialog').getByRole('button', { name: 'Erase Vault' }).click();
    await expect(page.getByText('Welcome to MyVault')).toBeVisible();

    await page.getByRole('button', { name: 'Restore from a backup' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose backup file…' }).click();
    await (await chooser).setFiles(path!);
    await page.getByLabel('Backup master password', { exact: true }).fill(MP);
    await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('.item-row', { hasText: 'Backed Up Site' })).toBeVisible();
  });

  test('CSV import from Chrome + Edge exports at once, without duplicates', async ({ page }) => {
    await createVault(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /Import from Another Password Manager/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose CSV files…' }).click();
    await (await chooser).setFiles([resolve('tests/fixtures/sample-chrome.csv'), resolve('tests/fixtures/sample-edge.csv')]);
    await expect(page.getByTestId('csv-summary')).toContainText('3 new logins to import · 1 duplicate skipped');
    await page.getByRole('button', { name: 'Import 3' }).click();
    await page.getByRole('button', { name: /^All Items/ }).click();
    await expect(page.locator('.item-row')).toHaveCount(3);
    await page.locator('.item-row', { hasText: /^EExample/ }).click();
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByText('pa,ss"word')).toBeVisible();

    // Importing the same files again adds nothing.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /Import from Another Password Manager/ }).click();
    const chooser2 = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose CSV files…' }).click();
    await (await chooser2).setFiles([resolve('tests/fixtures/sample-chrome.csv'), resolve('tests/fixtures/sample-edge.csv')]);
    await expect(page.getByTestId('csv-summary')).toContainText('0 new logins to import · 4 duplicates skipped');
  });

  test('auto-lock after inactivity', async ({ page }) => {
    await page.clock.install();
    await createVault(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Auto-lock after', { exact: true }).selectOption('1');
    await page.clock.fastForward('00:30');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.clock.fastForward('01:10');
    await expect(page.getByText('Enter your master password to unlock.')).toBeVisible();
  });
});

test.describe('Website security', () => {
  test('strict CSP blocks network access and the app makes no third-party requests', async ({ page, baseURL }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await createVault(page);
    await addLogin(page, 'Leak Test', 'leak.example.com', 'u', 'LeakTest-Password-1');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    const fetchBlocked = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/exfil');
        return false;
      } catch {
        return true;
      }
    });
    expect(fetchBlocked).toBe(true);
    const innerHtmlBlocked = await page.evaluate(() => {
      try {
        document.createElement('div').innerHTML = '<img src=x onerror=alert(1)>';
        return false;
      } catch {
        return true;
      }
    });
    expect(innerHtmlBlocked).toBe(true);
    const foreign = requests.filter((u) => !u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(foreign).toEqual([]);
  });

  test('IndexedDB holds only ciphertext', async ({ page }) => {
    await createVault(page);
    await addLogin(page, 'Plaintext Probe', 'probe.example.com', 'probe-user', 'Probe-Password-XYZ');
    const dump = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const req = indexedDB.open('myvault');
          req.onsuccess = () => {
            const tx = req.result.transaction(['vault', 'snapshots'], 'readonly');
            const a = tx.objectStore('vault').getAll();
            const b = tx.objectStore('snapshots').getAll();
            tx.oncomplete = () => resolve(JSON.stringify([a.result, b.result]));
          };
          req.onerror = () => reject(req.error);
        }),
    );
    expect(dump).toContain('argon2id');
    for (const secret of ['Plaintext Probe', 'probe-user', 'Probe-Password-XYZ', MP]) expect(dump).not.toContain(secret);
    const ls = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(ls).not.toContain('Probe-Password-XYZ');
    expect(ls).not.toContain(MP);
  });

  test('javascript: URLs are never rendered as links', async ({ page }) => {
    await createVault(page);
    await page.getByRole('button', { name: 'New item', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('XSS');
    await page.getByLabel('Website', { exact: true }).first().fill('javascript:alert(1)');
    await expect(page.getByText('Invalid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Item' })).toBeDisabled();
  });

  test('refuses to render inside a frame (clickjacking)', async ({ page, baseURL }) => {
    // A hostile page that tries to frame the app (served via interception, so it has no CSP of its own).
    await page.route('**/evil-framer.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: `<iframe src="${baseURL}/" width="800" height="600"></iframe>` }),
    );
    await page.goto(`${baseURL}/evil-framer.html`);
    await expect(page.frameLocator('iframe').locator('body')).toContainText('cannot be displayed inside a frame');
  });
});
