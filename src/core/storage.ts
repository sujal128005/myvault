/**
 * IndexedDB persistence for the encrypted vault record. Only ciphertext ever
 * reaches this layer. Writes use compare-and-swap on `revision` so two open
 * contexts (popup + full-page manager, or two tabs) can never silently
 * overwrite each other's changes.
 */
import type { EncryptedVaultRecord } from './vaultFormat';

export interface SnapshotInfo {
  id: number;
  revision: number;
  savedAt: string;
}

export interface VaultRepository {
  load(): Promise<EncryptedVaultRecord | null>;
  /** Atomically replace the record if the stored revision equals `expectedRevision` (null = must not exist). */
  compareAndSwap(next: EncryptedVaultRecord, expectedRevision: number | null): Promise<boolean>;
  /** Unconditional replace — used only for explicit restore / replace-from-backup. */
  replace(next: EncryptedVaultRecord): Promise<void>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  getSnapshot(id: number): Promise<EncryptedVaultRecord | null>;
  destroy(): Promise<void>;
}

export class ConflictError extends Error {
  constructor() {
    super('The vault was changed by another window. Please retry.');
    this.name = 'ConflictError';
  }
}

const DB_NAME = 'myvault';
const DB_VERSION = 1;
const STORE_VAULT = 'vault';
const STORE_SNAPSHOTS = 'snapshots';
const CURRENT_KEY = 'current';
export const SNAPSHOT_LIMIT = 10;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
  });
}

export class IndexedDbVaultRepository implements VaultRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly dbName: string = DB_NAME,
  ) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const open = this.factory.open(this.dbName, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(STORE_VAULT)) db.createObjectStore(STORE_VAULT);
          if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
            db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id', autoIncrement: true });
          }
        };
        open.onsuccess = () => {
          const db = open.result;
          db.onversionchange = () => {
            db.close();
            this.dbPromise = null;
          };
          resolve(db);
        };
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error('Vault database is blocked by another window'));
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  async load(): Promise<EncryptedVaultRecord | null> {
    const db = await this.db();
    const tx = db.transaction(STORE_VAULT, 'readonly');
    const rec = (await req(tx.objectStore(STORE_VAULT).get(CURRENT_KEY))) as EncryptedVaultRecord | undefined;
    return rec ?? null;
  }

  async compareAndSwap(next: EncryptedVaultRecord, expectedRevision: number | null): Promise<boolean> {
    const db = await this.db();
    const tx = db.transaction([STORE_VAULT, STORE_SNAPSHOTS], 'readwrite');
    const done = txDone(tx);
    const store = tx.objectStore(STORE_VAULT);
    const current = (await req(store.get(CURRENT_KEY))) as EncryptedVaultRecord | undefined;
    const currentRev = current ? current.revision : null;
    if (currentRev !== expectedRevision || (current && current.vaultId !== next.vaultId)) {
      tx.abort();
      await done.catch(() => undefined);
      return false;
    }
    store.put(next, CURRENT_KEY);
    if (current) await this.pushSnapshot(tx, current);
    await done;
    return true;
  }

  async replace(next: EncryptedVaultRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([STORE_VAULT, STORE_SNAPSHOTS], 'readwrite');
    const done = txDone(tx);
    const store = tx.objectStore(STORE_VAULT);
    const current = (await req(store.get(CURRENT_KEY))) as EncryptedVaultRecord | undefined;
    store.put(next, CURRENT_KEY);
    if (current) await this.pushSnapshot(tx, current);
    await done;
  }

  /** Keep the previous encrypted revisions so accidental changes can be rolled back. */
  private async pushSnapshot(tx: IDBTransaction, rec: EncryptedVaultRecord): Promise<void> {
    const snaps = tx.objectStore(STORE_SNAPSHOTS);
    snaps.add({ record: rec, revision: rec.revision, savedAt: rec.updatedAt });
    const keys = (await req(snaps.getAllKeys())) as number[];
    keys.sort((a, b) => a - b);
    const excess = keys.length - SNAPSHOT_LIMIT;
    for (let i = 0; i < excess; i++) snaps.delete(keys[i]!);
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const db = await this.db();
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const all = (await req(tx.objectStore(STORE_SNAPSHOTS).getAll())) as Array<{ id: number; revision: number; savedAt: string }>;
    return all.map(({ id, revision, savedAt }) => ({ id, revision, savedAt })).sort((a, b) => b.id - a.id);
  }

  async getSnapshot(id: number): Promise<EncryptedVaultRecord | null> {
    const db = await this.db();
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const s = (await req(tx.objectStore(STORE_SNAPSHOTS).get(id))) as { record: EncryptedVaultRecord } | undefined;
    return s?.record ?? null;
  }

  async destroy(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([STORE_VAULT, STORE_SNAPSHOTS], 'readwrite');
    const done = txDone(tx);
    tx.objectStore(STORE_VAULT).clear();
    tx.objectStore(STORE_SNAPSHOTS).clear();
    await done;
  }
}

/** Ask the browser not to evict our storage under disk pressure. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isStoragePersistent(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}
