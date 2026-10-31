/** Messages exchanged between extension pages and the background service worker. */
export type BgMessage = { type: 'schedule-clipboard-clear'; seconds: number } | { type: 'lock-now' };
export type OffscreenMessage = { target: 'offscreen'; type: 'clear-clipboard' };

/** chrome.storage.session keys (RAM-only, trusted extension contexts only). */
export const SESSION_KEY = 'mv_session';
export const ACTIVITY_KEY = 'mv_activity';
export const AUTOLOCK_KEY = 'mv_autolock';

export interface AutoLockConfig {
  minutes: number;
  lockOnSystemLock: boolean;
}

export function isExpired(lastActivity: number | undefined, cfg: AutoLockConfig | undefined, now = Date.now()): boolean {
  if (!cfg) return false;
  if (typeof lastActivity !== 'number') return true;
  return now - lastActivity >= cfg.minutes * 60_000;
}
