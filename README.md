# MyVault

A private, **local-first, end-to-end encrypted** password manager: a website plus a Chrome
(Manifest V3) extension. It runs without a server, account, cloud service or subscription, and costs ₹0.

- AES-256-GCM encryption, with the key derived from your master password by **Argon2id** (64 MiB, 3 passes)
- Your master password and keys are **never stored**. Only ciphertext is saved, in IndexedDB
- The app's Content Security Policy blocks it from making **any** network request
- Logins with any number of custom fields (API keys, secret keys, recovery and backup codes, security questions, PINs and more)
- Optional TOTP (2FA) codes, with warnings about the risk
- A password and passphrase generator, password-health checks (weak, reused and old passwords) and per-item password history
- Search, categories, folders, tags and favorites, plus a Recently Deleted area kept for 30 days
- Encrypted backups, a merge import and the last 10 saved versions, plus CSV import from Chrome, Edge, Firefox, Bitwarden, LastPass and 1Password
- Auto-lock on inactivity or screen lock, and automatic clipboard clearing
- Light and dark mode, and a layout that works on desktop and mobile

> Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and security model, and
> [docs/SECURITY.md](docs/SECURITY.md) for exactly what has and hasn't been verified.

---

## 1. Requirements

- [Node.js](https://nodejs.org) **20 or newer** (free). Check with `node --version`.
- Google Chrome (or Edge, Brave or another Chromium browser) for the extension.

## 2. Install

```bash
cd myvault
```

```bash
npm install
```

## 3. Build and load the Chrome extension (recommended way to use MyVault)

```bash
npm run build:ext
```

1. Open `chrome://extensions` (in Edge, `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder `myvault/dist/extension`.
4. Pin MyVault in the toolbar using the puzzle-piece icon.
5. Click the MyVault icon and choose **Set Up MyVault**. A full tab opens where you create your master password.

**Using it day to day**
- On a login page, click the MyVault icon (or press **Ctrl+Shift+L**, or **⌘+Shift+L** on a Mac) and click **Fill**.
  Nothing is ever filled automatically. You always click first.
- The **Add** tab saves a new login. **Capture From Page** picks up what you've typed into the page's form.
- The **Generate** tab creates a password and can fill it into a sign-up form.
- The ⤢ button opens the full vault manager in a tab.

> ⚠️ **Removing the extension deletes its vault.** Export an encrypted backup first (see §6).
> The extension has a fixed ID (`fjajonfdjlelioggldgljngpccipocad`), so reloading it, updating it or moving the
> folder keeps your data.

**Updating the extension after code changes:** run `npm run build:ext`, then click ↻ on the MyVault card in
`chrome://extensions`. Your vault is kept.

## 4. Run the website locally

The website is the same app for browsers that don't have the extension. It has **its own separate vault**
(browsers keep each site's storage apart). To move data between the two, use backups (§6).

```bash
npm run build:web
```

```bash
npm run preview
```

Then open <http://127.0.0.1:4173>. For development with hot reload (this mode has no CSP), run:

```bash
npm run dev
```

## 5. Import your Chrome and Edge passwords

1. Export them:
   - **Chrome:** `chrome://password-manager/settings` → **Export passwords**
   - **Edge:** `edge://wallet/passwords` (older versions: `edge://settings/passwords`) → **…** → **Export passwords**
2. In MyVault: **Settings → Import from Another Password Manager → Choose CSV files…** and select **both files at once**.
3. MyVault shows how many new logins it found and how many duplicates it will skip (the same login exported from both
   browsers, or one that's already in the vault). Click **Import**.
4. **Delete the CSV files and empty your Recycle Bin / Trash.** They are not encrypted.
5. Optional: once you've checked everything arrived, delete the passwords stored in Chrome and Edge and turn off
   their "Offer to save passwords" setting.

## 6. Backup and recovery

Read this section. **There is no "forgot password" and no cloud copy.**

| What | How |
|---|---|
| **Back up** | Settings → **Export Encrypted Backup…** saves `MyVault-backup-YYYY-MM-DD.myvault`, encrypted with your *current* master password. Keep copies in two places, for example a USB drive and a second computer. The file is safe to store in personal cloud storage because it's encrypted, but your master password is then its only protection. |
| **Reminders** | A banner appears when your last backup is older than 14 days (adjustable). |
| **Restore on a new browser or computer** | First screen → **Restore from a backup**, then choose the file and enter the master password that was in use when the backup was made. |
| **Merge into an existing vault** | Settings → **Import Backup (Merge)…** adds new items and keeps the newest copy of items that exist in both. Nothing is deleted. Use this to bring the website vault and the extension vault together. |
| **Undo a mistake** | Settings → **Restore an Earlier Version…** offers the last 10 saved versions (all encrypted). Deleted items stay in *Recently Deleted* for 30 days, and each item keeps its last 10 passwords under *Password History*. |
| **Without the app** | `npm run decrypt-backup -- MyVault-backup.myvault --csv logins.csv` decrypts a backup offline with a small Node script ([scripts/decrypt-backup.mjs](scripts/decrypt-backup.mjs)). You're never locked in. Delete the output afterwards, because it is not encrypted. |
| **Forgot master password** | Your data **cannot** be recovered. You can only erase the vault and start again, or restore a backup whose password you remember. |
| **After changing the master password** | Export a fresh backup. Older backups still open with the *old* password. |

Good master passwords are long passphrases (four or more random words). The **Passphrase** mode in the generator can
make one for you. Write it down and keep the paper somewhere physically safe.

## 7. Optional: free hosting for the website

Hosting is **optional**. Everything works locally, and the extension needs no hosting at all. Hosting only lets you
open the website on other devices, such as your phone. The website on each device keeps its own vault in that
browser, so use backups to move data.

| Feature | Local | Needs hosting |
|---|---|---|
| Vault, encryption, generator, health, backups, import | ✅ | — |
| Chrome extension (popup, autofill, full manager) | ✅ | — |
| Opening the website on your phone or other computers | — | ✅ static hosting (free) |
| Cloud sync | not built (see ARCHITECTURE §8) | — |

**Cloudflare Pages** (free, and applies the security headers in `public/_headers`):
1. Push this folder to a **private** GitHub repository.
2. In Cloudflare Pages, create a project from that repository with build command `npm run build:web` and output directory `dist/web`.

**GitHub Pages:** the workflow in `.github/workflows/pages.yml` builds and deploys on every push to `main`.
Enable it under repo **Settings → Pages → Source: GitHub Actions**. GitHub Pages ignores `_headers`, but the strict
CSP is also embedded in `index.html`.

> **Trust note:** whoever controls the hosting account (or your GitHub account) could serve modified code. Turn on
> 2FA for those accounts. For the highest assurance, use the extension, or run the website from `localhost`.

## 8. Tests

```bash
npm test
```

Runs the unit, crypto and static security tests (Vitest).

```bash
npm run test:all
```

Runs the type check, unit tests, both builds and the browser end-to-end tests (Playwright, website and extension).
The end-to-end tests need a Playwright Chromium; install it once with `npx playwright install chromium`.

## 9. Project layout

```
src/core/        encryption, vault format, storage, generator, TOTP, matching, import/export (no UI)
src/ui/          React UI shared by the website and the extension's full-page manager
src/web/         website entry point
src/extension/   manifest, popup, background service worker, offscreen clipboard helper, page scripts
tests/unit/      Vitest: crypto vectors, vault lifecycle, concurrency, import, security scan, recovery tool
tests/e2e/       Playwright: website flows and the real extension loaded in Chromium
scripts/         extension build and the offline backup decryptor
docs/            architecture, security verification report
```

## License

MIT. Passphrases use the [EFF Long Wordlist](https://www.eff.org/dice) (CC BY 3.0 US).
