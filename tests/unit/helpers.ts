import { IDBFactory } from 'fake-indexeddb';
import { MemorySessionStore, type SessionKey, type SessionKeyStore } from '../../src/core/session';
import { IndexedDbVaultRepository } from '../../src/core/storage';
import { VaultService } from '../../src/core/vaultService';

/** Minimum allowed Argon2id cost — keeps tests fast while still exercising real Argon2id. */
export const FAST_KDF = { memoryKiB: 19 * 1024, iterations: 2, parallelism: 1 };
export const PASSWORD = 'correct horse battery staple';

/** Mimics chrome.storage.session: a shared in-memory key store. */
export class SharedSessionStore implements SessionKeyStore {
  key: SessionKey | null = null;
  async save(k: SessionKey) {
    this.key = { vaultId: k.vaultId, dekBytes: new Uint8Array(k.dekBytes) };
  }
  async load() {
    return this.key ? { vaultId: this.key.vaultId, dekBytes: new Uint8Array(this.key.dekBytes) } : null;
  }
  async clear() {
    this.key = null;
  }
}

export function freshRepo() {
  return new IndexedDbVaultRepository(new IDBFactory(), 'test');
}

export function makeService(repo = freshRepo(), session: SessionKeyStore = new MemorySessionStore()) {
  return { repo, session, service: new VaultService(repo, session, { kdfCost: FAST_KDF }) };
}
