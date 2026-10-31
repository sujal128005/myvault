/**
 * Where the unlocked vault key lives while the vault is open.
 *
 * - Website: `MemorySessionStore` — nothing is persisted; the key exists only as a
 *   non-extractable CryptoKey inside VaultService. Reloading the page locks the vault.
 * - Extension: `ChromeSessionStore` (src/extension/platform.ts) — chrome.storage.session,
 *   which is RAM-only, wiped when the browser exits, and not readable by web pages or
 *   content scripts. This lets the popup and the full-page manager share one unlock.
 */
export interface SessionKey {
  vaultId: string;
  /** Raw DEK — caller must wipe after importing. */
  dekBytes: Uint8Array;
}

export interface SessionKeyStore {
  save(key: SessionKey): Promise<void>;
  load(): Promise<SessionKey | null>;
  clear(): Promise<void>;
}

export class MemorySessionStore implements SessionKeyStore {
  async save(): Promise<void> {
    /* intentionally not stored */
  }
  async load(): Promise<SessionKey | null> {
    return null;
  }
  async clear(): Promise<void> {
    /* nothing to clear */
  }
}

/** Cross-context notifications (other tabs / popup / full-page manager). */
export type VaultEvent =
  | { type: 'changed'; vaultId: string; revision: number }
  | { type: 'locked' }
  | { type: 'reset' };

export interface EventChannel {
  post(ev: VaultEvent): void;
  subscribe(fn: (ev: VaultEvent) => void): () => void;
}

export class BroadcastEventChannel implements EventChannel {
  private bc: BroadcastChannel | null;
  constructor(name = 'myvault-events') {
    this.bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null;
  }
  post(ev: VaultEvent): void {
    this.bc?.postMessage(ev);
  }
  subscribe(fn: (ev: VaultEvent) => void): () => void {
    if (!this.bc) return () => undefined;
    const handler = (e: MessageEvent) => {
      const d = e.data as VaultEvent;
      if (d && typeof d === 'object' && typeof d.type === 'string') fn(d);
    };
    this.bc.addEventListener('message', handler);
    return () => this.bc?.removeEventListener('message', handler);
  }
}

export class NullEventChannel implements EventChannel {
  post(): void {}
  subscribe(): () => void {
    return () => undefined;
  }
}
