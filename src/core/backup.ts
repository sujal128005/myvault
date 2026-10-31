/**
 * Encrypted backup files (.myvault) and merging.
 * A backup file is exactly the encrypted vault record (see vaultFormat.ts), so it is
 * protected by the master password in use when it was exported.
 */
import { importAesKey } from './crypto';
import { sanitizeVaultData, type VaultData, type VaultItem } from './model';
import { decryptData, unwrapDataKey, validateRecord, type EncryptedVaultRecord } from './vaultFormat';

export const BACKUP_EXTENSION = '.myvault';
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export function parseBackupFile(text: string): EncryptedVaultRecord {
  if (text.length > MAX_BACKUP_BYTES) throw new Error('Backup file is too large');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This is not a valid MyVault backup file');
  }
  return validateRecord(json);
}

/** Decrypt a backup with the password it was created with. */
export async function openBackup(record: EncryptedVaultRecord, password: string): Promise<VaultData> {
  const dekBytes = await unwrapDataKey(password, record);
  const dek = await importAesKey(dekBytes); // wipes dekBytes
  return decryptData(dek, record);
}

export interface MergeResult {
  data: VaultData;
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * Merge `incoming` into `current`: new items are added, items with the same id keep
 * whichever copy was modified most recently. Nothing is ever deleted by a merge.
 */
export function mergeVaults(current: VaultData, incoming: VaultData): MergeResult {
  const cur = sanitizeVaultData(current);
  const inc = sanitizeVaultData(incoming);
  const folders = [...cur.folders];
  const folderIds = new Set(folders.map((f) => f.id));
  const folderByName = new Map(folders.map((f) => [f.name.toLowerCase(), f.id]));
  const folderRemap = new Map<string, string>();
  for (const f of inc.folders) {
    if (folderIds.has(f.id)) continue;
    const sameName = folderByName.get(f.name.toLowerCase());
    if (sameName) {
      folderRemap.set(f.id, sameName);
      continue;
    }
    folders.push(f);
    folderIds.add(f.id);
    folderByName.set(f.name.toLowerCase(), f.id);
  }
  const byId = new Map<string, VaultItem>(cur.items.map((i) => [i.id, i]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const raw of inc.items) {
    const item = { ...raw, folderId: raw.folderId ? (folderRemap.get(raw.folderId) ?? raw.folderId) : null };
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      added++;
    } else if (Date.parse(item.updatedAt) > Date.parse(existing.updatedAt)) {
      byId.set(item.id, item);
      updated++;
    } else {
      unchanged++;
    }
  }
  return { data: { ...cur, folders, items: [...byId.values()] }, added, updated, unchanged };
}

export function backupFileName(date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return `MyVault-backup-${d}${BACKUP_EXTENSION}`;
}
