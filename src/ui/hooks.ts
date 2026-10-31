import { useCallback, useEffect, useState } from 'react';
import { estimateStrength, type Strength } from '../core/strength';
import { usePlatform } from './platform';
import { useVault } from './state';
import { useToast } from './toast';

export function useStrength(password: string, inputs: string[] = []): Strength | null {
  const [s, setS] = useState<Strength | null>(null);
  const key = inputs.join('\u0000');
  useEffect(() => {
    if (!password) {
      setS(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      estimateStrength(password, key ? key.split('\u0000') : [])
        .then((r) => alive && setS(r))
        .catch(() => undefined);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [password, key]);
  return s;
}

/** Copy a value; secrets get auto-cleared from the clipboard per settings. */
export function useCopy() {
  const platform = usePlatform();
  const { data, actions } = useVault();
  const toast = useToast();
  const clearSec = data?.settings.clipboardClearSeconds ?? 30;
  return useCallback(
    async (value: string, what: string, opts: { secret?: boolean; itemId?: string } = {}) => {
      try {
        await platform.copy(value, opts.secret === false ? 0 : clearSec);
        toast(`${what} copied`, { sub: opts.secret !== false && clearSec > 0 ? `clears in ${clearSec}s` : undefined });
        if (opts.itemId) void actions.markUsed(opts.itemId).catch(() => undefined);
      } catch {
        toast('Could not access the clipboard', { kind: 'error' });
      }
    },
    [platform, clearSec, toast, actions],
  );
}

export type ThemePref = 'system' | 'light' | 'dark';
const THEME_KEY = 'myvault-theme';

export function applyStoredTheme(): void {
  setThemeAttr(readTheme());
}

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function setThemeAttr(t: ThemePref) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  const update = useCallback((t: ThemePref) => {
    setTheme(t);
    setThemeAttr(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* non-essential */
    }
  }, []);
  return [theme, update];
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}
