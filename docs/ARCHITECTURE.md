# MyVault — Architecture & Security Model

MyVault is a **local-first, zero-server** password manager. It has one codebase and two
delivery targets:

| Target | Where it runs | Where the vault lives |
|---|---|---|
| **Chrome extension** (primary) | Popup + a full-page vault (`vault.html`) inside the extension | IndexedDB of the extension origin `chrome-extension://<id>` |
| **Website** (standalone) | Any static host or `localhost` | IndexedDB of the website's origin |

There is **no backend**. No feature needs a server; hosting is only a convenience for
serving the static website files. The build enforces this with a Content Security Policy
of `connect-src 'none'`: the browser itself refuses any `fetch`/XHR/WebSocket from the app.

## 1. How the website and extension share the same vault

The **full vault manager is shipped inside the extension** (`vault.html`). The popup and the
full-page manager are pages of the same extension origin, so they read and write the
*same* encrypted IndexedDB record. This is the "website + extension working together"
setup and it needs no network, no server, and no cross-origin messaging.

The **standalone website** is the identical React app built for a normal origin. It is for
devices/browsers where the extension is not installed (e.g. a phone). Because browsers
isolate storage per origin, it has its *own* vault. You move data between the two with
**encrypted backup files** (Export → Import → *Merge*), which are end-to-end encrypted with
your master password.

### Why there is no live website ⇄ extension bridge

A live bridge (`externally_connectable`) would let a web origin talk to the extension that
holds the vault. That means a single XSS or a compromised static host (e.g. a hijacked
GitHub account, DNS takeover) could ask the extension for vault data. Keeping the full
manager inside the extension removes that whole attack surface. If you later want sync,
the safe design is to sync **only the encrypted record** (already supported by the backup
format) through storage you control — see §8.

```
 ┌───────────────────────── Chrome extension origin ─────────────────────────┐
 │                                                                           │
 │  popup.html ──┐                    ┌── vault.html (full manager UI)        │
 │               │  same React core   │                                      │
 │               ▼                    ▼                                      │
 │        ┌──────────────── IndexedDB "myvault" ───────────────┐             │
 │        │  current: { header, wrappedKey, encryptedData }    │  ciphertext │
 │        │  snapshots: last 10 encrypted revisions            │    only     │
 │        └─────────────────────────────────────────────────────┘             │
 │        chrome.storage.session: vault key while unlocked (RAM only)        │
 │                                                                           │
 │  background service worker: auto-lock alarms, idle/screen-lock, clipboard │
 │  clearing (offscreen doc). It never decrypts the vault.                   │
 └───────────────────────────────────────────────────────────────────────────┘
          │ chrome.scripting.executeScript (only after you click "Fill",
          ▼ only into the active tab, only if its origin still matches)
   ┌──────────────┐
   │  web page    │  receives just one username/password at fill time
   └──────────────┘
```

## 2. Cryptography

Only established primitives from audited/established implementations are used. Nothing is
home-grown.

| Purpose | Algorithm | Implementation |
|---|---|---|
| Password → key | **Argon2id**, 64 MiB, 3 passes, p=1, 16-byte random salt | `hash-wasm` (WASM build of the reference C implementation) |
| Vault key (DEK) | 256-bit random key | `crypto.getRandomValues` |
| Key wrapping | **AES-256-GCM**(KEK, DEK), 96-bit random IV | WebCrypto (`crypto.subtle`) |
| Vault encryption | **AES-256-GCM**(DEK, JSON), fresh random 96-bit IV per save | WebCrypto |
| Header integrity | GCM additional authenticated data = canonical header (format, version, vault id, KDF params, salt, purpose) | WebCrypto |
| Password generator | Uniform rejection sampling over `crypto.getRandomValues` | own code (no crypto primitive) |
| TOTP | RFC 6238 over WebCrypto HMAC (SHA-1/256/512) | own protocol code, verified with RFC test vectors |

Key hierarchy:

```
master password ──NFC──► Argon2id(salt, 64MiB, t=3) ──► KEK (never stored)
                                                        │ AES-GCM unwrap
                                                        ▼
                               random 256-bit DEK ──► AES-GCM ──► encrypted vault JSON
```

* Wrong password ⇒ GCM tag failure on unwrap ⇒ "incorrect password". No password hash or
  verifier is stored.
* Changing the master password re-wraps the DEK with a new salt and new KEK.
* Every save uses a fresh IV. With one key and random 96-bit IVs the safe limit is 2³²
  encryptions — far beyond a personal vault's lifetime.
* KDF parameters are stored in the header and bounds-checked on load (prevents both
  weak-parameter downgrade and memory-exhaustion files).

## 3. What is stored where

| Data | Stored | Protection |
|---|---|---|
| Master password | **Never** stored anywhere | — |
| KEK | Never stored; exists for a moment during unlock | non-extractable `CryptoKey` |
| DEK (website) | JS memory only while unlocked | non-extractable `CryptoKey`; a reload locks the vault |
| DEK (extension) | `chrome.storage.session` while unlocked | RAM-only browser storage, inaccessible to web pages and content scripts, wiped on lock or browser exit |
| Vault contents | IndexedDB | AES-256-GCM ciphertext only |
| Plaintext metadata | vault id, KDF params, salt, revision, timestamps, ciphertext length | not secret |
| Theme preference | `localStorage` | not secret |

Site icons are **not** fetched from any favicon service (that would leak the list of sites
you use). Items get generated letter avatars.

## 4. Extension security model

* **Minimal permissions**: `activeTab`, `scripting`, `storage`, `alarms`, `idle`,
  `offscreen`, `clipboardWrite`, `unlimitedStorage`. There are **no host permissions and no
  content scripts**. Chrome therefore shows no "read and change all your data on all
  websites" warning, and the extension has zero presence on pages until you click it.
* **Autofill only after explicit action**: you open the popup (click or `Ctrl/⌘+Shift+L`)
  and click **Fill**. That user gesture grants temporary access to the current tab only.
* **Origin checks**: suggestions are matched on the registrable domain using the Public
  Suffix List (`tldts`), so `example.com.evil.net`, `examp1e.com` and
  `someone.github.io` vs `other.github.io` do not match. The fill script re-checks
  `location.origin` inside the page right before filling (protects against the tab
  navigating between the click and the fill) and fills only frames of that same origin.
* **No filling over plain HTTP** unless the saved URL is itself `http://` on that exact
  host (or `localhost`).
* The background service worker never sees decrypted vault data.
* Strict extension CSP: `script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'`.
* A pinned public key in the manifest gives the extension a **stable ID**, so its storage
  (your vault) survives reloading the unpacked folder from a different path.

## 5. Web-app security controls

| Threat | Control |
|---|---|
| XSS | React auto-escaping, no `dangerouslySetInnerHTML`, strict CSP (`default-src 'none'`, `script-src 'self'`), Trusted Types enforced, `javascript:`/`data:` URLs never rendered as links |
| Data exfiltration | `connect-src 'none'`, `form-action 'none'`, no analytics, no third-party resources, no remote fonts/icons |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` (via host headers) and a runtime frame-buster |
| CSRF | Not applicable: there is no server, no cookies and no authenticated endpoints |
| Insecure storage | Only ciphertext at rest; `navigator.storage.persist()` requested to prevent eviction |
| Shoulder surfing / walk-away | Passwords hidden by default, auto-lock on inactivity, lock on screen lock (extension), lock-on-hide option |
| Clipboard leaks | Clipboard cleared after a configurable delay (default 30 s) |
| Logging | The code never logs secrets; a test scans the source for `console.*` calls |
| Data loss | Encrypted backups, backup-age reminders, last 10 encrypted revisions kept locally, trash with restore, password history per item, standalone Node recovery script |

## 6. Known limitations (read these)

* **No master-password recovery.** Forget it and the data is unrecoverable by design.
* **A compromised device defeats any password manager.** Malware, a malicious browser
  extension with broad permissions, or a keylogger can capture the master password or read
  the decrypted vault from memory while it is unlocked.
* **JavaScript cannot reliably wipe memory.** Decrypted strings live in the JS heap until
  garbage-collected. Locking drops all references, but the bytes may linger.
* **Autofill gives the site the credential** — by design. Use per-site unique passwords.
* **Clipboard clearing is best-effort.** Clipboard-history tools (Windows `Win+V`, macOS
  utilities, phone sync) may keep copies. Clearing overwrites the clipboard even if you
  copied something else in the meantime.
* **TOTP secrets in the same vault as passwords collapse two factors into one.** Anyone who
  opens the vault has both. It is optional and the UI warns about it.
* **Ciphertext length and timestamps are visible** to anyone with access to the storage.
* **Hosted website = trust in the host.** Whoever controls the host can serve modified
  JavaScript. The extension, or running the website from `localhost`, avoids this.
* **Uninstalling the extension deletes its storage** (and therefore the vault). Keep
  encrypted backups.
* **Not independently audited.** The crypto building blocks are established, and the code
  is covered by automated tests (see `docs/SECURITY.md` for exactly what is verified), but
  no third party has reviewed this code.

## 7. Code layout

```
src/core/        framework-free logic (crypto, vault, storage, generator, TOTP, matching…)
src/ui/          React UI shared by website and extension full-page manager
src/web/         website entry point
src/extension/   manifest, background service worker, popup, offscreen doc, page scripts
tests/unit/      Vitest unit + security tests for src/core
tests/e2e/       Playwright tests for the website and the built extension
scripts/         extension build script, standalone backup decryptor
```

## 8. Optional future sync (not built)

If you ever add cloud sync it must stay end-to-end encrypted: upload only the encrypted
record (`header + wrappedKey + data`) to storage you control (e.g. a private Git repo or a
WebDAV folder), merge by item `updatedAt`, and keep the CSP allow-list to that single host.
The server must never receive the master password or any key.
