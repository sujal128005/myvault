import { describe, expect, it } from 'vitest';
import { mergeVaults, openBackup, parseBackupFile } from '../../src/core/backup';
import { applyCsvImport, importCsv, parseCsv } from '../../src/core/csvImport';
import { charsetsFor, generatePassword, generatorEntropyBits, normalizeGeneratorOptions, randomInt, DEFAULT_GENERATOR } from '../../src/core/generator';
import { findReused, buildHealthReport } from '../../src/core/health';
import { emptyVault, newItem, sanitizeItem, sanitizeVaultData, updateItem } from '../../src/core/model';
import { estimateStrength } from '../../src/core/strength';
import { base32Decode, base32Encode, hotp, parseTotpInput, totp } from '../../src/core/totp';
import { fillAllowed, findMatches, matchUrl, safeHref } from '../../src/core/url';
import { createRecord } from '../../src/core/vaultFormat';
import { FAST_KDF, PASSWORD } from './helpers';

describe('Password generator', () => {
  it('respects length and includes every selected character class', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword({ length: 12 });
      expect(pw).toHaveLength(12);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('honours disabled classes and ambiguous-character exclusion', () => {
    for (let i = 0; i < 100; i++) {
      expect(generatePassword({ length: 30, symbols: false, uppercase: false })).toMatch(/^[a-z0-9]+$/);
      expect(generatePassword({ length: 60, avoidAmbiguous: true })).not.toMatch(/[Il1O0o|`'"]/);
    }
  });

  it('clamps length into 8–128 and never produces an empty charset', () => {
    expect(generatePassword({ length: 2 })).toHaveLength(8);
    expect(generatePassword({ length: 10_000 })).toHaveLength(128);
    const o = normalizeGeneratorOptions({ uppercase: false, lowercase: false, digits: false, symbols: false });
    expect(charsetsFor(o).length).toBe(1);
  });

  it('randomInt is unbiased (chi-square sanity check)', () => {
    const n = 7;
    const counts = new Array(n).fill(0);
    const N = 70_000;
    for (let i = 0; i < N; i++) counts[randomInt(n)]++;
    const expected = N / n;
    const chi = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(22.46); // p=0.001 for 6 dof
  });

  it('generates passphrases from the EFF list', () => {
    const p = generatePassword({ mode: 'passphrase', words: 6, separator: '-' });
    expect(p.split('-')).toHaveLength(6);
    expect(generatorEntropyBits({ mode: 'passphrase', words: 6, includeNumber: false })).toBe(77);
  });

  it('default config gives >120 bits of entropy', () => {
    expect(generatorEntropyBits(DEFAULT_GENERATOR)).toBeGreaterThan(120);
  });

  it('produces no duplicates over many runs', () => {
    const set = new Set(Array.from({ length: 2000 }, () => generatePassword({ length: 16 })));
    expect(set.size).toBe(2000);
  });
});

describe('TOTP (RFC 6238 Appendix B vectors)', () => {
  // Seeds from the RFC: ASCII "12345678901234567890" repeated to the hash length.
  const seed = (len: number) => new TextEncoder().encode('1234567890'.repeat(7).slice(0, len));
  const cases: Array<[number, string, string, string]> = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  it.each(cases)('T=%i', async (t, sha1, sha256, sha512) => {
    const step = Math.floor(t / 30);
    expect(await hotp(seed(20), step, 8, 'SHA1')).toBe(sha1);
    expect(await hotp(seed(32), step, 8, 'SHA256')).toBe(sha256);
    expect(await hotp(seed(64), step, 8, 'SHA512')).toBe(sha512);
  });

  it('totp() uses the configured period and reports remaining seconds', async () => {
    const secret = base32Encode(seed(20));
    const r = await totp({ secret, issuer: '', account: '', algorithm: 'SHA1', digits: 8, period: 30 }, 59_000);
    expect(r.code).toBe('94287082');
    expect(r.remaining).toBe(1);
  });

  it('base32 round-trips', () => {
    const b = crypto.getRandomValues(new Uint8Array(20));
    expect([...base32Decode(base32Encode(b))]).toEqual([...b]);
  });

  it('parses otpauth URIs and bare secrets, rejects junk', () => {
    const cfg = parseTotpInput('otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=GitHub&digits=6&period=30');
    expect(cfg).toMatchObject({ issuer: 'GitHub', account: 'alice', digits: 6, period: 30, algorithm: 'SHA1' });
    expect(parseTotpInput('jbsw y3dp ehpk 3pxp jbsw y3dp')?.secret).toBe('JBSWY3DPEHPK3PXPJBSWY3DP');
    expect(parseTotpInput('not a secret!')).toBeNull();
    expect(parseTotpInput('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP')).toBeNull();
  });
});

describe('Site matching (phishing resistance)', () => {
  it('matches same host and subdomains of the same registrable domain', () => {
    expect(matchUrl('https://github.com', 'https://github.com/login')).toBe('exact');
    expect(matchUrl('github.com', 'https://github.com/login')).toBe('exact');
    expect(matchUrl('https://accounts.google.com', 'https://mail.google.com')).toBe('domain');
    expect(matchUrl('https://bbc.co.uk', 'https://www.bbc.co.uk')).toBe('domain');
  });

  it('does not match look-alikes, suffix tricks or shared hosting', () => {
    expect(matchUrl('https://github.com', 'https://github.com.evil.net')).toBeNull();
    expect(matchUrl('https://github.com', 'https://evilgithub.com')).toBeNull();
    expect(matchUrl('https://paypal.com', 'https://paypa1.com')).toBeNull();
    expect(matchUrl('https://alice.github.io', 'https://mallory.github.io')).toBeNull();
    expect(matchUrl('https://foo.co.uk', 'https://bar.co.uk')).toBeNull();
    expect(matchUrl('https://192.168.1.1', 'https://192.168.1.2')).toBeNull();
    expect(matchUrl('javascript:alert(1)', 'https://example.com')).toBeNull();
  });

  it('findMatches ignores trashed items and ranks exact matches first', () => {
    const a = newItem({ title: 'sub', urls: ['https://login.example.com'] });
    const b = newItem({ title: 'exact', urls: ['https://example.com'] });
    const c = newItem({ title: 'trashed', urls: ['https://example.com'], deletedAt: new Date().toISOString() });
    const m = findMatches([a, b, c], 'https://example.com/signin');
    expect(m.map((x) => x.item.title)).toEqual(['exact', 'sub']);
  });

  it('blocks filling into plain-HTTP pages unless saved for that http host', () => {
    expect(fillAllowed(['https://example.com'], 'https://example.com').ok).toBe(true);
    expect(fillAllowed(['https://example.com'], 'http://example.com').ok).toBe(false);
    expect(fillAllowed(['http://router.example'], 'http://router.example/login').ok).toBe(true);
    expect(fillAllowed([], 'http://localhost:3000').ok).toBe(true);
  });

  it('safeHref only allows http(s) links', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('example.com')).toBe('https://example.com/');
  });
});

describe('Model sanitisation', () => {
  it('coerces hostile input into safe shapes', () => {
    const v = sanitizeVaultData({
      items: [{ title: { evil: true }, password: 42, urls: 'x', tags: ['a', 'a', ' b '], favorite: 'yes', id: '<script>' }],
      folders: [{ id: 'f', name: '' }],
      settings: { autoLockMinutes: 99999, clipboardClearSeconds: -1 },
    });
    const it0 = v.items[0]!;
    expect(it0.title).toBe('Untitled');
    expect(it0.password).toBe('');
    expect(it0.urls).toEqual([]);
    expect(it0.tags).toEqual(['a', 'b']);
    expect(it0.favorite).toBe(false);
    expect(it0.id).not.toContain('<');
    expect(v.folders).toEqual([]);
    expect(v.settings.autoLockMinutes).toBe(5);
    expect(v.settings.clipboardClearSeconds).toBe(30);
  });

  it('rejects unknown schema versions', () => {
    expect(() => sanitizeVaultData({ schema: 2 })).toThrow();
  });

  it('records password history on change', () => {
    const a = newItem({ password: 'one' });
    const b = updateItem(a, { password: 'two' });
    const c = updateItem(b, { password: 'three' });
    expect(c.passwordHistory.map((h) => h.password)).toEqual(['two', 'one']);
    expect(updateItem(c, { notes: 'x' }).passwordHistory).toHaveLength(2);
  });

  it('drops invalid TOTP secrets', () => {
    expect(sanitizeItem({ totp: { secret: 'not base32!' } }).totp).toBeNull();
  });
});

describe('Backups & imports', () => {
  it('parse + open an encrypted backup', async () => {
    const data = emptyVault();
    data.items.push(newItem({ title: 'X', password: 'pw' }));
    const { record } = await createRecord(PASSWORD, data, FAST_KDF);
    const parsed = parseBackupFile(JSON.stringify(record));
    expect((await openBackup(parsed, PASSWORD)).items[0]!.title).toBe('X');
    await expect(openBackup(parsed, 'nope nope nope')).rejects.toThrow();
    expect(() => parseBackupFile('{not json')).toThrow();
    expect(() => parseBackupFile('{"format":"other"}')).toThrow();
  });

  it('merge keeps the newest copy and never deletes', () => {
    const base = emptyVault();
    const shared = newItem({ title: 'shared', updatedAt: '2024-01-01T00:00:00.000Z' });
    const onlyHere = newItem({ title: 'only here' });
    base.items.push(shared, onlyHere);
    const incoming = emptyVault();
    const newer = { ...shared, title: 'shared (newer)', updatedAt: '2025-01-01T00:00:00.000Z' };
    incoming.items.push(newer, newItem({ title: 'new one' }));
    const r = mergeVaults(base, incoming);
    expect(r.added).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.data.items.map((i) => i.title).sort()).toEqual(['new one', 'only here', 'shared (newer)']);
  });

  it('parses RFC 4180 CSV with quotes, commas and newlines', () => {
    expect(parseCsv('a,b\n"x, y","multi\nline ""q"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'multi\nline "q"'],
    ]);
  });

  it('imports Chrome and Bitwarden CSV exports', () => {
    const chrome = 'name,url,username,password,note\nGitHub,https://github.com/login,alice,s3cr3t,hi\n';
    const r = importCsv(chrome);
    expect(r.entries[0]!.item).toMatchObject({ title: 'GitHub', username: 'alice', password: 's3cr3t', notes: 'hi', urls: ['https://github.com/login'] });
    const bw = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nWork,1,login,Jira,,,0,https://jira.example.com,bob@example.com,pw,JBSWY3DPEHPK3PXP\n';
    const r2 = importCsv(bw);
    const data = applyCsvImport(emptyVault(), r2);
    expect(data.folders[0]!.name).toBe('Work');
    expect(data.items[0]!.folderId).toBe(data.folders[0]!.id);
    expect(data.items[0]!.favorite).toBe(true);
    expect(data.items[0]!.email).toBe('bob@example.com');
    expect(data.items[0]!.totp?.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(() => importCsv('foo,bar\n1,2')).toThrow();
  });
});

describe('Strength & health', () => {
  it('rates obvious passwords weak and generated ones strong', async () => {
    expect((await estimateStrength('password123')).score).toBeLessThan(2);
    expect((await estimateStrength(generatePassword({ length: 20 }))).score).toBe(4);
  });

  it('detects reused passwords', async () => {
    const items = [newItem({ title: 'a', password: 'same-pass' }), newItem({ title: 'b', password: 'same-pass' }), newItem({ title: 'c', password: generatePassword() })];
    expect(findReused(items)).toHaveLength(1);
    const r = await buildHealthReport(items);
    expect(r.reused[0]!.items).toHaveLength(2);
    expect(r.weak.length).toBeGreaterThanOrEqual(2);
    expect(r.score).toBeLessThan(50);
  });
});

describe('Importing several CSV exports (Chrome + Edge)', () => {
  it('merges files and skips duplicates across files and against the vault', async () => {
    const { importCsvFiles, dedupeCsvImport } = await import('../../src/core/csvImport');
    const { readFileSync } = await import('node:fs');
    const chrome = readFileSync('tests/fixtures/sample-chrome.csv', 'utf8');
    const edge = readFileSync('tests/fixtures/sample-edge.csv', 'utf8');
    const combined = importCsvFiles([chrome, edge]);
    expect(combined.entries).toHaveLength(4);
    const existing = [newItem({ urls: ['https://www.shop.example.org'], username: 'BOB@example.org', password: 'hunter2-shop' })];
    const r = dedupeCsvImport(existing, combined);
    expect(r.duplicates).toBe(2); // alice (Chrome+Edge) and bob (already in vault)
    expect(r.entries.map((e) => e.item.username).sort()).toEqual(['alice', 'carol@example.net']);
  });

  it('keeps same site+user if the password differs', async () => {
    const { dedupeCsvImport } = await import('../../src/core/csvImport');
    const a = newItem({ urls: ['https://x.com'], username: 'u', password: 'old' });
    const r = dedupeCsvImport([a], { entries: [{ item: newItem({ urls: ['https://x.com'], username: 'u', password: 'new' }), folder: null }], skipped: 0 });
    expect(r.entries).toHaveLength(1);
  });
});

describe('Auto-lock monitor', () => {
  it('locks after the timeout, resets on activity, and locks when hidden too long', async () => {
    const { InactivityMonitor } = await import('../../src/core/autolock');
    let t = 0;
    let locked = 0;
    const m = new InactivityMonitor({ timeoutMs: () => 60_000, hiddenTimeoutMs: () => 10_000, onLock: () => locked++, now: () => t });
    t = 59_000;
    expect(m.check()).toBe(false);
    m.poke();
    t = 100_000;
    expect(m.check()).toBe(false);
    t = 119_000;
    expect(m.check()).toBe(true);
    m.poke();
    m.setHidden(true);
    t += 11_000;
    expect(m.check()).toBe(true);
    expect(locked).toBe(2);
  });
});

describe('Search', () => {
  it('matches non-secret fields only, case and accent insensitive', async () => {
    const { matchesQuery } = await import('../../src/core/search');
    const i = newItem({ title: 'Café Bank', username: 'Navya', password: 'hidden-pw', fields: [{ id: 'a', label: 'API', value: 'sk-secret', secret: true, multiline: false, preset: 'api-key' }] });
    expect(matchesQuery(i, 'cafe navya')).toBe(true);
    expect(matchesQuery(i, 'hidden-pw')).toBe(false);
    expect(matchesQuery(i, 'sk-secret')).toBe(false);
  });
});
