import { createContext, useContext } from 'react';
import type { VaultSettings } from '../core/model';
import type { VaultService } from '../core/vaultService';

/** Everything that differs between the website and the extension. */
export interface Platform {
  kind: 'web' | 'extension';
  service: VaultService;
  /** Copy to clipboard and schedule clearing (0 = never). */
  copy(text: string, clearAfterSeconds: number): Promise<void>;
  /** Start inactivity monitoring for the unlocked vault. Returns a stop function. */
  startAutoLock(getSettings: () => VaultSettings, onLock: () => void): () => void;
  /** Push lock-related settings to wherever they are enforced (e.g. the service worker). */
  syncSettings(settings: VaultSettings): void;
  /** Extension popup only: open the full-page manager. */
  openFullVault?: () => void;
}

export const PlatformContext = createContext<Platform | null>(null);

export function usePlatform(): Platform {
  const p = useContext(PlatformContext);
  if (!p) throw new Error('PlatformContext missing');
  return p;
}
