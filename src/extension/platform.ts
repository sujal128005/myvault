/**
 * Extension platform: the unlocked vault key is shared between the popup and the
 * full-page manager via chrome.storage.session (RAM-only; not readable by web pages
 * or content scripts; wiped when the browser closes or the vault locks).
 */
import { ACTIVITY_EVENTS } from '../core/autolock';
import { base64ToBytes, bytesToBase64 } from '../core/encoding';
import { BroadcastEventChannel, type SessionKey, type SessionKeyStore } from '../core/session';
import { IndexedDbVaultRepository } from '../core/storage';
import { VaultService } from '../core/vaultService';
import type { Platform } from '../ui/platform';
import { ACTIVITY_KEY, AUTOLOCK_KEY, SESSION_KEY, isExpired, type AutoLockConfig, type BgMessage } from './messages';

interface StoredSession {
  vaultId: string;
  dek: string;
}

export class ChromeSessionStore implements SessionKeyStore {
  async save(key: SessionKey): Promise<void> {
    const value: StoredSession = { vaultId: key.vaultId, dek: bytesToBase64(key.dekBytes) };
    key.dekBytes.fill(0);
    await chrome.storage.session.set({ [SESSION_KEY]: value, [ACTIVITY_KEY]: Date.now() });
  }

  async load(): Promise<SessionKey | null> {
    const got = await chrome.storage.session.get([SESSION_KEY, ACTIVITY_KEY, AUTOLOCK_KEY]);
    const s = got[SESSION_KEY] as StoredSession | undefined;
    if (!s || typeof s.dek !== 'string' || typeof s.vaultId !== 'string') return null;
    if (isExpired(got[ACTIVITY_KEY] as number | undefined, got[AUTOLOCK_KEY] as AutoLockConfig | undefined)) {
      await this.clear();
      return null;
    }
    return { vaultId: s.vaultId, dekBytes: base64ToBytes(s.dek) };
  }

  async clear(): Promise<void> {
    await chrome.storage.session.remove([SESSION_KEY]);
  }
}

function send(msg: BgMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

export function createExtensionPlatform(opts: { popup?: boolean } = {}): Platform {
  const service = new VaultService(new IndexedDbVaultRepository(), new ChromeSessionStore(), {
    channel: new BroadcastEventChannel('myvault-ext'),
  });

  // If the background worker (auto-lock / screen lock) or another page removes the
  // session key, lock this page too.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !(SESSION_KEY in changes)) return;
    if (!changes[SESSION_KEY]!.newValue) {
      if (service.isUnlocked) void service.lock({ broadcast: false });
    } else if (!service.isUnlocked) {
      // Unlocked in another extension page (e.g. the popup): follow along.
      void service.resume();
    }
  });

  return {
    kind: 'extension',
    service,
    async copy(text, clearAfterSeconds) {
      await navigator.clipboard.writeText(text);
      if (clearAfterSeconds > 0) send({ type: 'schedule-clipboard-clear', seconds: clearAfterSeconds });
    },
    startAutoLock(getSettings, onLock) {
      let last = 0;
      const poke = () => {
        const t = Date.now();
        if (t - last > 5_000) {
          last = t;
          void chrome.storage.session.set({ [ACTIVITY_KEY]: t });
        }
      };
      poke();
      for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, poke, { passive: true, capture: true });
      const check = async () => {
        const got = await chrome.storage.session.get([ACTIVITY_KEY]);
        const s = getSettings();
        if (isExpired(got[ACTIVITY_KEY] as number | undefined, { minutes: s.autoLockMinutes, lockOnSystemLock: s.lockOnSystemLock })) onLock();
      };
      const interval = setInterval(() => void check(), 10_000);
      return () => {
        for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, poke, { capture: true });
        clearInterval(interval);
      };
    },
    syncSettings(settings) {
      const cfg: AutoLockConfig = { minutes: settings.autoLockMinutes, lockOnSystemLock: settings.lockOnSystemLock };
      void chrome.storage.session.set({ [AUTOLOCK_KEY]: cfg });
    },
    openFullVault: () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL('vault.html') });
      if (opts.popup) window.close();
    },
  };
}
