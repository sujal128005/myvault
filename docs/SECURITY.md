# MyVault — Security Verification Report

This document says plainly what has been **verified**, what is **designed but not independently verifiable
here**, and what is **not protected**. MyVault has **not** had an independent third-party security audit.

## 1. Verified by automated tests

Run `npm run test:all` to reproduce. Each claim below lists the test that checks it.

### Cryptography (`tests/unit/crypto.test.ts`)
| Claim | Evidence |
|---|---|
| Argon2id implementation is correct | Matches the official phc-winner-argon2 reference test vector (t=2, m=64 MiB, p=1) |
| Different salts give different keys; derivation is deterministic | Direct comparison |
| Unicode passwords give the same key on every OS (NFC) | Composed and decomposed "é" derive the same key |
| Weak or absurd KDF parameters are rejected (downgrade / DoS) | `validateKdfParams` bounds tests |
| AES-GCM uses a fresh IV on every encryption | Two encryptions of the same plaintext differ |
| Tampered ciphertext, a wrong AAD, or a modified header (vault id, KDF params) is detected | Bit-flip and AAD tests fail closed with `DecryptionError` |
| Keys in memory are non-extractable, and raw key bytes are wiped after import | `exportKey` rejects; the buffer is all zeros |
| A stored record contains no plaintext titles, usernames, passwords or the DEK | Serialized-record scan |
| Ciphertext is padded so the exact vault size is hidden (4 KiB blocks) | Equal ciphertext lengths |

### Vault behaviour (`tests/unit/vaultService.test.ts`)
- Create → lock → unlock round trip. A wrong password is rejected and leaves the vault locked.
- Master-password policy is enforced (12+ characters, no leading or trailing spaces). The UI also requires a zxcvbn score of "Strong".
- **Two contexts writing at once never lose an update** (compare-and-swap plus rebase). This covers the popup and the full-page manager open together.
- The website never persists the key. A shared unlock in the extension is cleared by lock for every context.
- Changing the master password keeps the data, and the old password stops working.
- Snapshots: the last 10 encrypted revisions are kept and can be restored.
- Backup export requires the master password, contains no plaintext, and restores on a fresh "device".
- Trash items older than 30 days are purged.

### Features (`tests/unit/features.test.ts`)
- Generator: every selected character class is present, unbiased sampling (chi-square test), no duplicates in 2,000 runs, and passphrases come from the 7,776-word EFF list.
- **TOTP matches all 18 RFC 6238 Appendix B vectors** (SHA-1, SHA-256 and SHA-512).
- **Site matching resists phishing:** `github.com.evil.net`, `evilgithub.com`, `paypa1.com`, `alice.github.io` vs `mallory.github.io`, `foo.co.uk` vs `bar.co.uk`, different IPs and `javascript:` URLs all fail to match.
- No autofill into plain-HTTP pages unless the login was saved for that exact http host (localhost is allowed).
- Hostile vault JSON is sanitised (wrong types, duplicate ids, injected ids, out-of-range settings).
- CSV parsing follows RFC 4180. Chrome, Edge and Bitwarden formats are covered, and duplicates are removed across files and against the vault.
- Search never matches passwords, secret fields or TOTP secrets.
- Auto-lock timing logic, including locking after the page has been hidden too long.

### Static security scan (`tests/unit/security-scan.test.ts`)
The shipped source contains no `console.*` calls (so nothing can log secrets), no `fetch`, XHR, WebSocket,
`sendBeacon` or EventSource, no `eval` or `new Function`, no `innerHTML`, `dangerouslySetInnerHTML` or
`document.write`, no `Math.random`, and no remote script or style URLs. Every `target="_blank"` link uses
`noopener noreferrer`. The extension manifest has no content scripts and no host permissions.

### Recovery (`tests/unit/recovery.test.ts`)
The standalone `scripts/decrypt-backup.mjs` decrypts a real backup to CSV and JSON without the app, and refuses
a wrong password.

### Website in a real browser (`tests/e2e/web.spec.ts`, Chromium)
- The full flow works: create, add, reveal, search, lock, unlock, reload. **There are no console errors while the strict CSP and Trusted Types are enforced.**
- `fetch()` to an external host is **blocked by CSP**, and assigning to `innerHTML` is **blocked by Trusted Types**.
- The page makes **zero requests to any other origin**.
- IndexedDB, localStorage and sessionStorage hold no plaintext secrets and never the master password.
- `javascript:` URLs can't be saved as websites.
- **The app refuses to render inside a frame (clickjacking).**
- Encrypted backup export → erase → restore works, and the downloaded file contains no plaintext.
- Importing Chrome and Edge CSVs together creates no duplicates, and re-importing adds nothing.
- The vault auto-locks after the inactivity period.

### Extension loaded in Chromium (`tests/e2e/extension.spec.ts`)
- The shipped manifest is minimal: MV3, **no host permissions, no content scripts, no `externally_connectable`, no web-accessible resources**, a strict CSP without `unsafe-eval` or `unsafe-inline`, and the pinned extension ID.
- The popup shares the unlock with the full-page manager, **suggests only logins for the current site**, fills **only after a click**, and leaves other inputs (such as a search box) untouched.
- Search shows **no Fill button for logins of other sites**.
- Copying a password schedules clipboard clearing in the background worker.
- Locking in one extension page locks all of them, and the session key is removed from memory storage.
- The background worker auto-locks after inactivity.
- Extension storage holds only ciphertext, and `chrome.storage.local` is empty.
- The in-page fill script refuses to run when the page origin differs from the expected one, even when serialised exactly as Chrome injects it.

### Dependencies
`npm audit` reported **0 known vulnerabilities** when this project was built (October 2026). Re-run it regularly.

## 2. Designed in, but not fully provable by tests

- **Clipboard clearing works but is best-effort.** In the extension the clear runs no sooner than 30 s after
  copying (a Chrome alarm limit). Clipboard-history tools such as Windows Win+V and phone clipboard sync can keep
  copies anyway.
- **Screen-lock auto-lock** uses `chrome.idle` "locked" events. This can't be simulated in headless tests.
- **Memory hygiene:** raw key buffers are zeroed, but JavaScript strings (decrypted passwords) cannot be wiped and
  stay in memory until garbage collection.
- **Fill heuristics** cover standard login forms. Unusual forms (shadow DOM, custom widgets, cross-origin login
  iframes) may not fill. When that happens, copy and paste instead. MyVault deliberately never fills into frames of
  a different origin.

## 3. Not protected (inherent limits)

- Malware, keyloggers, or a malicious extension with broad permissions on your computer.
- Someone who knows or watches you type your master password, or who uses your unlocked computer before auto-lock.
- A forgotten master password. Recovery is impossible by design.
- Losing the browser profile or uninstalling the extension **without a backup**.
- A compromised host serving modified website code. The extension and localhost are not affected by this.
- Breach monitoring (Have I Been Pwned) is intentionally absent because it needs network access.

## 4. Reporting

This is a personal project. If you find a problem, fix it in your copy, add a regression test, and re-run
`npm run test:all`.
