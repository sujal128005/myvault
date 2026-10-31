/**
 * Import plaintext CSV exports from other password managers (Chrome, Edge, Firefox,
 * Bitwarden, LastPass, 1Password, generic). Parsing is RFC 4180 compliant.
 * The CSV is processed in memory only; users are told to delete the file afterwards.
 */
import { randomId } from './encoding';
import { newItem, type VaultData, type VaultItem } from './model';
import { parseTotpInput } from './totp';
import { titleFromUrl } from './url';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const COLUMN_ALIASES: Record<string, string[]> = {
  title: ['name', 'title', 'account', 'item name'],
  url: ['url', 'login_uri', 'website', 'web site', 'uri', 'origin', 'login url'],
  username: ['username', 'login_username', 'user name', 'login', 'user'],
  email: ['email', 'e-mail'],
  password: ['password', 'login_password', 'pass'],
  notes: ['note', 'notes', 'extra', 'comments'],
  totp: ['totp', 'login_totp', 'otpauth', 'one-time password', 'otp'],
  folder: ['folder', 'grouping', 'group', 'vault'],
  favorite: ['favorite', 'fav', 'favourite'],
};

export interface CsvImportResult {
  entries: Array<{ item: VaultItem; folder: string | null }>;
  skipped: number;
}

export function importCsv(text: string): CsvImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV file has no data rows');
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  if (col.password === undefined && col.username === undefined) {
    throw new Error('Could not find username/password columns in this CSV');
  }
  const get = (r: string[], k: string) => (col[k] !== undefined ? (r[col[k]!] ?? '').trim() : '');
  const entries: CsvImportResult['entries'] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const url = get(r, 'url');
    const username = get(r, 'username');
    // Passwords are taken verbatim (leading/trailing spaces can be significant).
    const password = col.password !== undefined ? (r[col.password] ?? '') : '';
    if (!url && !username && !password) {
      skipped++;
      continue;
    }
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username);
    const item = newItem({
      title: get(r, 'title') || titleFromUrl(url) || username || 'Imported login',
      urls: url ? [url] : [],
      username,
      email: get(r, 'email') || (looksLikeEmail ? username : ''),
      password,
      notes: get(r, 'notes'),
      totp: get(r, 'totp') ? parseTotpInput(get(r, 'totp')) : null,
      favorite: ['1', 'true', 'yes'].includes(get(r, 'favorite').toLowerCase()),
    });
    entries.push({ item, folder: get(r, 'folder') || null });
  }
  return { entries, skipped };
}

/** Add parsed CSV entries to a vault, creating folders by name as needed. */
export function applyCsvImport(data: VaultData, result: CsvImportResult): VaultData {
  const folders = [...data.folders];
  const byName = new Map(folders.map((f) => [f.name.toLowerCase(), f.id]));
  const items = [...data.items];
  for (const { item, folder } of result.entries) {
    let folderId: string | null = null;
    if (folder) {
      folderId = byName.get(folder.toLowerCase()) ?? null;
      if (!folderId) {
        folderId = randomId();
        folders.push({ id: folderId, name: folder.slice(0, 100) });
        byName.set(folder.toLowerCase(), folderId);
      }
    }
    items.push({ ...item, folderId });
  }
  return { ...data, folders, items };
}

/** Identity of a login for duplicate detection: site host + username + password. */
function loginKey(item: Pick<VaultItem, 'urls' | 'username' | 'password'>): string {
  let host = '';
  const raw = item.urls[0]?.trim() ?? '';
  if (raw) {
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      host = raw.toLowerCase();
    }
  }
  return JSON.stringify([host, item.username.trim().toLowerCase(), item.password]);
}

/**
 * Drop entries that already exist in the vault, or that appear more than once across
 * the imported files (e.g. the same login exported from both Chrome and Edge).
 */
export function dedupeCsvImport(existing: VaultItem[], result: CsvImportResult): CsvImportResult & { duplicates: number } {
  const seen = new Set(existing.filter((i) => !i.deletedAt).map(loginKey));
  const entries: CsvImportResult['entries'] = [];
  let duplicates = 0;
  for (const e of result.entries) {
    const k = loginKey(e.item);
    if (seen.has(k)) {
      duplicates++;
      continue;
    }
    seen.add(k);
    entries.push(e);
  }
  return { entries, skipped: result.skipped, duplicates };
}

/** Combine several CSV files (e.g. Chrome + Edge exports) into one import. */
export function importCsvFiles(texts: string[]): CsvImportResult {
  const all: CsvImportResult = { entries: [], skipped: 0 };
  for (const t of texts) {
    const r = importCsv(t);
    all.entries.push(...r.entries);
    all.skipped += r.skipped;
  }
  return all;
}
