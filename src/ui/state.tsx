import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { randomId } from '../core/encoding';
import { newItem, updateItem, type Folder, type VaultData, type VaultItem, type VaultSettings } from '../core/model';
import { requestPersistentStorage } from '../core/storage';
import type { VaultStatus } from '../core/vaultService';
import { usePlatform } from './platform';

export interface VaultActions {
  create(password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  saveItem(item: Partial<VaultItem> & { id?: string }): Promise<VaultItem>;
  trashItem(id: string): Promise<void>;
  restoreItem(id: string): Promise<void>;
  purgeItem(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  markUsed(id: string): Promise<void>;
  addFolder(name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  updateSettings(patch: Partial<VaultSettings>): Promise<void>;
  replaceData(fn: (d: VaultData) => VaultData): Promise<void>;
  refreshStatus(): Promise<void>;
}

interface VaultCtx {
  status: VaultStatus | 'loading';
  data: VaultData | null;
  actions: VaultActions;
}

const Ctx = createContext<VaultCtx | null>(null);

export function useVault(): VaultCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('VaultProvider missing');
  return v;
}

export function useVaultData(): VaultData {
  const { data } = useVault();
  if (!data) throw new Error('Vault is locked');
  return data;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const { service } = platform;
  const [status, setStatus] = useState<VaultStatus | 'loading'>('loading');
  const [data, setData] = useState<VaultData | null>(null);
  const settingsRef = useRef<VaultSettings | null>(null);

  const sync = useCallback(async () => {
    const s = await service.status();
    setStatus(s);
    setData(s === 'unlocked' ? service.vault : null);
  }, [service]);

  // Initial load: an extension context may resume a shared unlock.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await service.resume();
      } catch {
        /* stay locked */
      }
      if (alive) await sync();
    })();
    const off = service.on((ev) => {
      if (ev.type === 'locked') {
        setStatus('locked');
        setData(null);
      } else if (ev.type === 'reset') {
        setStatus('loading');
        setData(null);
        void sync();
      } else if (ev.type === 'changed' && service.isUnlocked) {
        setStatus('unlocked');
        setData(service.vault);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [service, sync]);

  useEffect(() => {
    settingsRef.current = data?.settings ?? null;
  }, [data]);

  // Auto-lock runs only while unlocked.
  const unlocked = status === 'unlocked';
  useEffect(() => {
    if (!unlocked) return;
    return platform.startAutoLock(
      () => settingsRef.current ?? service.vault.settings,
      () => void service.lock(),
    );
  }, [unlocked, platform, service]);

  useEffect(() => {
    if (data) platform.syncSettings(data.settings);
  }, [data?.settings, platform, data]);

  const actions = useMemo<VaultActions>(() => {
    const m = (fn: (d: VaultData) => VaultData | void) => service.mutate(fn).then((d) => setData(d));
    return {
      async create(password) {
        await service.create(password);
        void requestPersistentStorage();
        await sync();
      },
      async unlock(password) {
        await service.unlock(password);
        void requestPersistentStorage();
        await sync();
      },
      async lock() {
        await service.lock();
        await sync();
      },
      async saveItem(input) {
        let saved!: VaultItem;
        await m((d) => {
          const idx = input.id ? d.items.findIndex((i) => i.id === input.id) : -1;
          if (idx >= 0) {
            saved = updateItem(d.items[idx]!, input);
            d.items[idx] = saved;
          } else {
            saved = newItem({ ...input, id: undefined } as Partial<VaultItem>);
            d.items.push(saved);
          }
        });
        return saved;
      },
      async trashItem(id) {
        await m((d) => {
          const it = d.items.find((i) => i.id === id);
          if (it) it.deletedAt = new Date().toISOString();
        });
      },
      async restoreItem(id) {
        await m((d) => {
          const it = d.items.find((i) => i.id === id);
          if (it) it.deletedAt = null;
        });
      },
      async purgeItem(id) {
        await m((d) => {
          d.items = d.items.filter((i) => i.id !== id);
        });
      },
      async emptyTrash() {
        await m((d) => {
          d.items = d.items.filter((i) => !i.deletedAt);
        });
      },
      async toggleFavorite(id) {
        await m((d) => {
          const it = d.items.find((i) => i.id === id);
          if (it) {
            it.favorite = !it.favorite;
            it.updatedAt = new Date().toISOString();
          }
        });
      },
      async markUsed(id) {
        await m((d) => {
          const it = d.items.find((i) => i.id === id);
          if (it) it.lastUsedAt = new Date().toISOString();
        });
      },
      async addFolder(name) {
        const folder = { id: randomId(), name: name.trim().slice(0, 100) || 'New Folder' };
        await m((d) => {
          d.folders.push(folder);
        });
        return folder;
      },
      async renameFolder(id, name) {
        await m((d) => {
          const f = d.folders.find((x) => x.id === id);
          if (f && name.trim()) f.name = name.trim().slice(0, 100);
        });
      },
      async deleteFolder(id) {
        await m((d) => {
          d.folders = d.folders.filter((f) => f.id !== id);
          for (const i of d.items) if (i.folderId === id) i.folderId = null;
        });
      },
      async updateSettings(patch) {
        await m((d) => {
          d.settings = { ...d.settings, ...patch };
        });
      },
      async replaceData(fn) {
        await m(fn);
      },
      refreshStatus: sync,
    };
  }, [service, sync]);

  const value = useMemo(() => ({ status, data, actions }), [status, data, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
