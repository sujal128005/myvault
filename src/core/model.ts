/**
 * Vault data model + strict sanitisation. Every vault decrypted from storage or
 * imported from a backup passes through `sanitizeVaultData`, so malformed or
 * hostile input can never put unexpected types into the UI.
 */
import { randomId } from './encoding';
import { DEFAULT_GENERATOR, normalizeGeneratorOptions, type GeneratorOptions } from './generator';

export const CATEGORIES = [
  { id: 'website', label: 'Website' },
  { id: 'app', label: 'Application' },
  { id: 'email', label: 'Email' },
  { id: 'finance', label: 'Finance' },
  { id: 'social', label: 'Social' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'work', label: 'Work' },
  { id: 'developer', label: 'Developer' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'note', label: 'Secure Note' },
  { id: 'other', label: 'Other' },
] as const;
export type Category = (typeof CATEGORIES)[number]['id'];
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));

export const FIELD_PRESETS = [
  { preset: 'api-key', label: 'API Key', secret: true, multiline: false },
  { preset: 'secret-key', label: 'Secret Key', secret: true, multiline: false },
  { preset: 'recovery-codes', label: 'Recovery Codes', secret: true, multiline: true },
  { preset: 'backup-codes', label: 'Backup Codes', secret: true, multiline: true },
  { preset: 'security-question', label: 'Security question?', secret: true, multiline: false },
  { preset: 'pin', label: 'PIN', secret: true, multiline: false },
  { preset: 'account-id', label: 'Account ID', secret: false, multiline: false },
  { preset: 'text', label: 'Text', secret: false, multiline: false },
  { preset: 'secret', label: 'Hidden text', secret: true, multiline: false },
  { preset: 'note', label: 'Note', secret: false, multiline: true },
] as const;

export interface CustomField {
  id: string;
  label: string;
  value: string;
  secret: boolean;
  multiline: boolean;
  preset: string;
}

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';
export interface TotpConfig {
  /** Base32 secret, uppercase, no spaces. */
  secret: string;
  issuer: string;
  account: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

export interface PasswordHistoryEntry {
  password: string;
  changedAt: string;
}

export interface VaultItem {
  id: string;
  title: string;
  category: Category;
  folderId: string | null;
  tags: string[];
  favorite: boolean;
  urls: string[];
  username: string;
  email: string;
  password: string;
  notes: string;
  totp: TotpConfig | null;
  fields: CustomField[];
  passwordHistory: PasswordHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  passwordUpdatedAt: string | null;
  lastUsedAt: string | null;
  deletedAt: string | null;
}

export interface Folder {
  id: string;
  name: string;
}

export interface VaultSettings {
  /** Minutes of inactivity before auto-lock (1–240). */
  autoLockMinutes: number;
  /** Seconds before the clipboard is cleared (0 = never). */
  clipboardClearSeconds: number;
  /** Website only: lock when the tab is hidden for longer than a minute. */
  lockOnHide: boolean;
  /** Extension only: lock when the OS screen locks. */
  lockOnSystemLock: boolean;
  generator: GeneratorOptions;
  lastBackupAt: string | null;
  backupReminderDays: number;
}

export interface VaultData {
  schema: 1;
  items: VaultItem[];
  folders: Folder[];
  settings: VaultSettings;
}

export const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: 5,
  clipboardClearSeconds: 30,
  lockOnHide: false,
  lockOnSystemLock: true,
  generator: DEFAULT_GENERATOR,
  lastBackupAt: null,
  backupReminderDays: 14,
};

export const AUTO_LOCK_CHOICES = [1, 2, 5, 10, 15, 30, 60, 120, 240];
export const CLIPBOARD_CHOICES = [0, 10, 20, 30, 45, 60, 90, 120];
export const PASSWORD_HISTORY_LIMIT = 10;
export const TRASH_RETENTION_DAYS = 30;

const LIMITS = {
  short: 512,
  long: 100_000,
  tags: 50,
  urls: 20,
  fields: 100,
  items: 50_000,
  folders: 1_000,
};

export function emptyVault(): VaultData {
  return { schema: 1, items: [], folders: [], settings: structuredClone(DEFAULT_SETTINGS) };
}

export function newItem(partial: Partial<VaultItem> = {}, now = new Date().toISOString()): VaultItem {
  return sanitizeItem({
    id: randomId(),
    createdAt: now,
    updatedAt: now,
    passwordUpdatedAt: partial.password ? now : null,
    ...partial,
  });
}

export function newField(preset: string = 'text'): CustomField {
  const p = FIELD_PRESETS.find((f) => f.preset === preset) ?? FIELD_PRESETS[7];
  return {
    id: randomId(),
    label: p.preset === 'security-question' ? '' : p.label,
    value: '',
    secret: p.secret,
    multiline: p.multiline,
    preset: p.preset,
  };
}

/** Apply edits to an item, maintaining timestamps and password history. */
export function updateItem(old: VaultItem, patch: Partial<VaultItem>, now = new Date().toISOString()): VaultItem {
  const next = sanitizeItem({ ...old, ...patch, id: old.id, createdAt: old.createdAt, updatedAt: now });
  if (next.password !== old.password) {
    next.passwordUpdatedAt = now;
    if (old.password) {
      next.passwordHistory = [{ password: old.password, changedAt: now }, ...old.passwordHistory].slice(
        0,
        PASSWORD_HISTORY_LIMIT,
      );
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Sanitisation helpers
// ---------------------------------------------------------------------------

function str(v: unknown, max = LIMITS.short): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function bool(v: unknown): boolean {
  return v === true;
}
function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
function iso(v: unknown, fallback: string): string {
  return isoOrNull(v) ?? fallback;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function id(v: unknown): string {
  return typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : randomId();
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').slice(0, 40);
}

export function sanitizeTotp(v: unknown): TotpConfig | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  const secret = str(t.secret, 1024).toUpperCase().replace(/[\s=-]/g, '');
  if (!secret || !/^[A-Z2-7]+$/.test(secret)) return null;
  const algorithm: TotpAlgorithm =
    t.algorithm === 'SHA256' || t.algorithm === 'SHA512' ? t.algorithm : 'SHA1';
  const digits = t.digits === 7 || t.digits === 8 ? t.digits : 6;
  const period =
    typeof t.period === 'number' && Number.isInteger(t.period) && t.period >= 10 && t.period <= 300
      ? t.period
      : 30;
  return { secret, issuer: str(t.issuer), account: str(t.account), algorithm, digits, period };
}

export function sanitizeItem(v: unknown): VaultItem {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const category = typeof o.category === 'string' && CATEGORY_IDS.has(o.category) ? (o.category as Category) : 'website';
  const tags = [...new Set(arr(o.tags).map((t) => normalizeTag(str(t))).filter(Boolean))].slice(0, LIMITS.tags);
  const urls = arr(o.urls)
    .map((u) => str(u, 2048).trim())
    .filter(Boolean)
    .slice(0, LIMITS.urls);
  const fields: CustomField[] = arr(o.fields)
    .slice(0, LIMITS.fields)
    .map((f) => {
      const x = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
      return {
        id: id(x.id),
        label: str(x.label),
        value: str(x.value, LIMITS.long),
        secret: bool(x.secret),
        multiline: bool(x.multiline),
        preset: str(x.preset, 40) || 'text',
      };
    });
  const passwordHistory: PasswordHistoryEntry[] = arr(o.passwordHistory)
    .map((h) => {
      const x = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>;
      return { password: str(x.password, LIMITS.long), changedAt: iso(x.changedAt, now) };
    })
    .filter((h) => h.password)
    .slice(0, PASSWORD_HISTORY_LIMIT);
  const createdAt = iso(o.createdAt, now);
  return {
    id: id(o.id),
    title: str(o.title).trim() || 'Untitled',
    category,
    folderId: typeof o.folderId === 'string' && o.folderId ? id(o.folderId) : null,
    tags,
    favorite: bool(o.favorite),
    urls,
    username: str(o.username, 2048),
    email: str(o.email, 2048),
    password: str(o.password, 4096),
    notes: str(o.notes, LIMITS.long),
    totp: sanitizeTotp(o.totp),
    fields,
    passwordHistory,
    createdAt,
    updatedAt: iso(o.updatedAt, createdAt),
    passwordUpdatedAt: isoOrNull(o.passwordUpdatedAt),
    lastUsedAt: isoOrNull(o.lastUsedAt),
    deletedAt: isoOrNull(o.deletedAt),
  };
}

function pickNumber(v: unknown, allowed: number[], fallback: number): number {
  return typeof v === 'number' && allowed.includes(v) ? v : fallback;
}

export function sanitizeSettings(v: unknown): VaultSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    autoLockMinutes: pickNumber(o.autoLockMinutes, AUTO_LOCK_CHOICES, DEFAULT_SETTINGS.autoLockMinutes),
    clipboardClearSeconds: pickNumber(o.clipboardClearSeconds, CLIPBOARD_CHOICES, DEFAULT_SETTINGS.clipboardClearSeconds),
    lockOnHide: bool(o.lockOnHide),
    lockOnSystemLock: o.lockOnSystemLock === undefined ? true : bool(o.lockOnSystemLock),
    generator: normalizeGeneratorOptions(o.generator as Partial<GeneratorOptions>),
    lastBackupAt: isoOrNull(o.lastBackupAt),
    backupReminderDays: pickNumber(o.backupReminderDays, [0, 7, 14, 30, 60, 90], 14),
  };
}

export function sanitizeVaultData(v: unknown): VaultData {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (o.schema !== undefined && o.schema !== 1) throw new Error('Unsupported vault schema version');
  const folders: Folder[] = [];
  const seenFolder = new Set<string>();
  for (const f of arr(o.folders).slice(0, LIMITS.folders)) {
    const x = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const fid = id(x.id);
    const name = str(x.name, 100).trim();
    if (!name || seenFolder.has(fid)) continue;
    seenFolder.add(fid);
    folders.push({ id: fid, name });
  }
  const seenItem = new Set<string>();
  const items: VaultItem[] = [];
  for (const raw of arr(o.items).slice(0, LIMITS.items)) {
    const item = sanitizeItem(raw);
    if (seenItem.has(item.id)) item.id = randomId();
    if (item.folderId && !seenFolder.has(item.folderId)) item.folderId = null;
    seenItem.add(item.id);
    items.push(item);
  }
  return { schema: 1, items, folders, settings: sanitizeSettings(o.settings) };
}

/** Remove items that have been in the trash longer than the retention period. */
export function purgeExpiredTrash(data: VaultData, now = Date.now()): VaultData {
  const cutoff = now - TRASH_RETENTION_DAYS * 86_400_000;
  const items = data.items.filter((i) => !i.deletedAt || Date.parse(i.deletedAt) > cutoff);
  return items.length === data.items.length ? data : { ...data, items };
}

export function allTags(items: VaultItem[]): string[] {
  const set = new Set<string>();
  for (const i of items) if (!i.deletedAt) for (const t of i.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}
