/**
 * VaultService — the single entry point the UI uses. It owns the in-memory
 * unlocked state and guarantees:
 *  - only ciphertext is written to storage;
 *  - the DEK is held as a non-extractable CryptoKey (raw bytes are wiped);
 *  - concurrent writers never lose updates (CAS + retry);
 *  - locking drops every reference to decrypted data.
 */
import { DecryptionError, importAesKey, type KdfParams } from './crypto';
import { wipe } from './encoding';
import { emptyVault, purgeExpiredTrash, sanitizeVaultData, type VaultData } from './model';
import type { EventChannel, SessionKeyStore, VaultEvent } from './session';
import { NullEventChannel } from './session';
import { ConflictError, type SnapshotInfo, type VaultRepository } from './storage';
import {
  createRecord,
  decryptData,
  headerOf,
  rewrapRecord,
  sealData,
  unwrapDataKey,
  validateRecord,
  type EncryptedVaultRecord,
} from './vaultFormat';

export const MASTER_PASSWORD_MIN_LENGTH = 12;
export const MASTER_PASSWORD_MAX_LENGTH = 1024;

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

export function assertMasterPasswordPolicy(pw: string): void {
  if (typeof pw !== 'string' || [...pw].length < MASTER_PASSWORD_MIN_LENGTH) {
    throw new PolicyError(`Master password must be at least ${MASTER_PASSWORD_MIN_LENGTH} characters`);
  }
  if (pw.length > MASTER_PASSWORD_MAX_LENGTH) throw new PolicyError('Master password is too long');
  if (pw.trim() !== pw) throw new PolicyError('Master password cannot start or end with spaces');
}

export type VaultStatus = 'none' | 'locked' | 'unlocked';
type Listener = (ev: VaultEvent) => void;

export interface VaultServiceOptions {
  /** Override Argon2id cost (tests only; must still satisfy KDF_BOUNDS). */
  kdfCost?: Omit<KdfParams, 'name' | 'salt'>;
  channel?: EventChannel;
}

export class VaultService {
  private dek: CryptoKey | null = null;
  private record: EncryptedVaultRecord | null = null;
  private data: VaultData | null = null;
  private listeners = new Set<Listener>();
  private readonly channel: EventChannel;
  private unsubscribe: () => void;

  constructor(
    private readonly repo: VaultRepository,
    private readonly session: SessionKeyStore,
    private readonly opts: VaultServiceOptions = {},
  ) {
    this.channel = opts.channel ?? new NullEventChannel();
    this.unsubscribe = this.channel.subscribe((ev) => void this.onRemoteEvent(ev));
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: VaultEvent): void {
    for (const fn of this.listeners) fn(ev);
  }

  private async onRemoteEvent(ev: VaultEvent): Promise<void> {
    if (ev.type === 'locked') {
      if (this.dek) await this.lock({ broadcast: false });
    } else if (ev.type === 'reset') {
      this.clearMemory();
      this.emit(ev);
    } else if (ev.type === 'changed' && this.dek && this.record && ev.vaultId === this.record.vaultId && ev.revision > this.record.revision) {
      try {
        await this.refresh();
      } catch {
        /* a failed refresh leaves the current state intact */
      }
    }
  }

  get isUnlocked(): boolean {
    return this.dek !== null && this.data !== null;
  }

  get vault(): VaultData {
    if (!this.data) throw new Error('Vault is locked');
    return this.data;
  }

  get meta(): { vaultId: string; revision: number; kdf: KdfParams; createdAt: string; updatedAt: string } | null {
    if (!this.record) return null;
    const { vaultId, revision, kdf, createdAt, updatedAt } = this.record;
    return { vaultId, revision, kdf, createdAt, updatedAt };
  }

  async status(): Promise<VaultStatus> {
    if (this.isUnlocked) return 'unlocked';
    const rec = await this.repo.load();
    return rec ? 'locked' : 'none';
  }

  private async loadRecord(): Promise<EncryptedVaultRecord> {
    const raw = await this.repo.load();
    if (!raw) throw new Error('No vault exists yet');
    return validateRecord(raw);
  }

  private async open(rec: EncryptedVaultRecord, dekBytes: Uint8Array, persistSession: boolean): Promise<VaultData> {
    try {
      if (persistSession) await this.session.save({ vaultId: rec.vaultId, dekBytes: new Uint8Array(dekBytes) });
      const dek = await importAesKey(dekBytes, false);
      const data = await decryptData(dek, rec);
      this.dek = dek;
      this.record = rec;
      this.data = data;
      return data;
    } finally {
      wipe(dekBytes);
    }
  }

  async create(password: string, initial: VaultData = emptyVault()): Promise<VaultData> {
    assertMasterPasswordPolicy(password);
    if (await this.repo.load()) throw new Error('A vault already exists in this browser');
    const { record, dekBytes } = await createRecord(password, sanitizeVaultData(initial), this.opts.kdfCost);
    if (!(await this.repo.compareAndSwap(record, null))) {
      wipe(dekBytes);
      throw new ConflictError();
    }
    return this.open(record, dekBytes, true);
  }

  async unlock(password: string): Promise<VaultData> {
    const rec = await this.loadRecord();
    const dekBytes = await unwrapDataKey(password, rec);
    const data = await this.open(rec, dekBytes, true);
    const purged = purgeExpiredTrash(data);
    if (purged !== data) await this.mutate(() => purged);
    return this.vault;
  }

  /** Re-open using a key shared through the session store (extension contexts). */
  async resume(): Promise<VaultData | null> {
    if (this.isUnlocked) return this.data;
    const key = await this.session.load();
    if (!key) return null;
    try {
      const rec = await this.loadRecord();
      if (rec.vaultId !== key.vaultId) {
        wipe(key.dekBytes);
        await this.session.clear();
        return null;
      }
      const data = await this.open(rec, key.dekBytes, false);
      this.emit({ type: 'changed', vaultId: rec.vaultId, revision: rec.revision });
      return data;
    } catch {
      wipe(key.dekBytes);
      return null;
    }
  }

  private clearMemory(): void {
    this.dek = null;
    this.data = null;
    this.record = null;
  }

  async lock(opts: { broadcast?: boolean } = {}): Promise<void> {
    this.clearMemory();
    await this.session.clear();
    if (opts.broadcast !== false) this.channel.post({ type: 'locked' });
    this.emit({ type: 'locked' });
  }

  /** Reload the latest revision from storage (after another context wrote). */
  async refresh(): Promise<VaultData> {
    if (!this.dek) throw new Error('Vault is locked');
    const rec = await this.loadRecord();
    if (this.record && rec.revision === this.record.revision) return this.vault;
    const data = await decryptData(this.dek, rec);
    this.record = rec;
    this.data = data;
    this.emit({ type: 'changed', vaultId: rec.vaultId, revision: rec.revision });
    return data;
  }

  /**
   * Apply a change. `fn` receives a deep copy of the latest data and returns the new data.
   * If another context saved in the meantime, the latest revision is re-read and `fn`
   * is re-applied, so no update is ever lost.
   */
  async mutate(fn: (draft: VaultData) => VaultData | void): Promise<VaultData> {
    if (!this.dek || !this.record) throw new Error('Vault is locked');
    for (let attempt = 0; attempt < 5; attempt++) {
      const latest = await this.loadRecord();
      const base = latest.revision === this.record.revision && this.data ? this.data : await decryptData(this.dek, latest);
      const draft = structuredClone(base);
      const result = sanitizeVaultData(fn(draft) ?? draft);
      const next = await sealData(this.dek, headerOf(latest), result, latest.revision + 1);
      if (await this.repo.compareAndSwap(next, latest.revision)) {
        this.record = next;
        this.data = result;
        this.channel.post({ type: 'changed', vaultId: next.vaultId, revision: next.revision });
        this.emit({ type: 'changed', vaultId: next.vaultId, revision: next.revision });
        return result;
      }
    }
    throw new ConflictError();
  }

  async verifyPassword(password: string): Promise<boolean> {
    try {
      const rec = await this.loadRecord();
      const dek = await unwrapDataKey(password, rec);
      wipe(dek);
      return true;
    } catch (e) {
      if (e instanceof DecryptionError) return false;
      throw e;
    }
  }

  async changePassword(current: string, next: string): Promise<void> {
    if (!this.isUnlocked) throw new Error('Vault is locked');
    assertMasterPasswordPolicy(next);
    if (current === next) throw new PolicyError('The new password must be different');
    const rec = await this.loadRecord();
    const { header, data, dekBytes } = await rewrapRecord(rec, current, next, this.opts.kdfCost);
    const sealed = await sealData(this.dek!, header, data, rec.revision + 1);
    if (!(await this.repo.compareAndSwap(sealed, rec.revision))) {
      wipe(dekBytes);
      throw new ConflictError();
    }
    this.record = sealed;
    this.data = data;
    await this.session.save({ vaultId: sealed.vaultId, dekBytes });
    wipe(dekBytes);
    this.channel.post({ type: 'changed', vaultId: sealed.vaultId, revision: sealed.revision });
    this.emit({ type: 'changed', vaultId: sealed.vaultId, revision: sealed.revision });
  }

  /** Returns the current encrypted record as a backup file body (requires the master password). */
  async exportBackup(password: string): Promise<string> {
    if (!(await this.verifyPassword(password))) throw new DecryptionError('Incorrect master password');
    await this.mutate((d) => {
      d.settings.lastBackupAt = new Date().toISOString();
    });
    const rec = await this.loadRecord();
    return JSON.stringify(rec, null, 2);
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    return this.repo.listSnapshots();
  }

  /** Restore the contents of an earlier encrypted revision as a new revision. */
  async restoreSnapshot(id: number): Promise<VaultData> {
    if (!this.dek) throw new Error('Vault is locked');
    const snap = await this.repo.getSnapshot(id);
    if (!snap) throw new Error('Snapshot not found');
    const rec = validateRecord(snap);
    let data: VaultData;
    try {
      data = await decryptData(this.dek, rec);
    } catch {
      throw new Error('This snapshot was made with a different vault key and cannot be restored here');
    }
    return this.mutate(() => data);
  }

  /** Replace (or create) the local vault with a backup file. Requires the backup's password. */
  async restoreFromBackup(backup: EncryptedVaultRecord, password: string): Promise<VaultData> {
    const rec = validateRecord(backup);
    const dekBytes = await unwrapDataKey(password, rec);
    const current = await this.repo.load();
    const next = { ...rec, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
    await this.repo.replace(next);
    this.channel.post({ type: 'reset' });
    return this.open(next, dekBytes, true);
  }

  /** Permanently delete the local vault (and its snapshots). */
  async destroy(): Promise<void> {
    await this.repo.destroy();
    this.clearMemory();
    await this.session.clear();
    this.channel.post({ type: 'reset' });
    this.emit({ type: 'reset' });
  }
}
