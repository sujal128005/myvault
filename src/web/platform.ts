import { ACTIVITY_EVENTS, InactivityMonitor } from '../core/autolock';
import { BroadcastEventChannel, MemorySessionStore } from '../core/session';
import { IndexedDbVaultRepository } from '../core/storage';
import { VaultService } from '../core/vaultService';
import type { Platform } from '../ui/platform';

const HIDDEN_LOCK_MS = 60_000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let pendingClear = false;

async function clearClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText('');
    pendingClear = false;
  } catch {
    // The Clipboard API needs document focus; retry when the user comes back.
    pendingClear = true;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (pendingClear) void clearClipboard();
  });
}

export function createWebPlatform(): Platform {
  const service = new VaultService(new IndexedDbVaultRepository(), new MemorySessionStore(), {
    channel: new BroadcastEventChannel('myvault-web'),
  });
  return {
    kind: 'web',
    service,
    async copy(text, clearAfterSeconds) {
      await navigator.clipboard.writeText(text);
      if (clearTimer) clearTimeout(clearTimer);
      pendingClear = false;
      if (clearAfterSeconds > 0) clearTimer = setTimeout(() => void clearClipboard(), clearAfterSeconds * 1000);
    },
    startAutoLock(getSettings, onLock) {
      const monitor = new InactivityMonitor({
        timeoutMs: () => getSettings().autoLockMinutes * 60_000,
        hiddenTimeoutMs: () => (getSettings().lockOnHide ? HIDDEN_LOCK_MS : null),
        onLock,
      });
      let lastPoke = 0;
      const poke = () => {
        const t = Date.now();
        if (t - lastPoke > 1000) {
          lastPoke = t;
          monitor.poke();
        }
      };
      const onVis = () => monitor.setHidden(document.visibilityState === 'hidden');
      for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, poke, { passive: true, capture: true });
      document.addEventListener('visibilitychange', onVis);
      const interval = setInterval(() => monitor.check(), 5_000);
      return () => {
        for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, poke, { capture: true });
        document.removeEventListener('visibilitychange', onVis);
        clearInterval(interval);
      };
    },
    syncSettings() {
      /* enforced in-page by startAutoLock */
    },
  };
}
