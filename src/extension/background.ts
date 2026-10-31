/**
 * MyVault background service worker.
 * Responsibilities: auto-lock (inactivity + screen lock) and clipboard clearing.
 * It never decrypts the vault and never receives passwords.
 */
import { ACTIVITY_KEY, AUTOLOCK_KEY, SESSION_KEY, isExpired, type AutoLockConfig, type BgMessage, type OffscreenMessage } from './messages';

const AUTOLOCK_ALARM = 'myvault-autolock';
const CLIPBOARD_ALARM = 'myvault-clipboard';
const OFFSCREEN_URL = 'offscreen.html';

async function setup(): Promise<void> {
  // Explicitly keep session storage away from content scripts (this is also the default).
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const existing = await chrome.alarms.get(AUTOLOCK_ALARM);
  if (!existing) await chrome.alarms.create(AUTOLOCK_ALARM, { periodInMinutes: 0.5 });
  chrome.idle.setDetectionInterval(60);
}

async function lock(): Promise<void> {
  await chrome.storage.session.remove([SESSION_KEY]);
}

async function checkAutoLock(): Promise<void> {
  const got = await chrome.storage.session.get([SESSION_KEY, ACTIVITY_KEY, AUTOLOCK_KEY]);
  if (!got[SESSION_KEY]) return;
  if (isExpired(got[ACTIVITY_KEY] as number | undefined, (got[AUTOLOCK_KEY] as AutoLockConfig | undefined) ?? { minutes: 5, lockOnSystemLock: true })) {
    await lock();
  }
}

async function clearClipboard(): Promise<void> {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: 'Clear copied passwords from the clipboard after a timeout',
      });
    }
    const msg: OffscreenMessage = { target: 'offscreen', type: 'clear-clipboard' };
    await chrome.runtime.sendMessage(msg);
  } catch {
    /* best effort */
  } finally {
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
}

chrome.runtime.onInstalled.addListener(() => void setup());
chrome.runtime.onStartup.addListener(() => void setup());
void setup();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTOLOCK_ALARM) void checkAutoLock();
  if (alarm.name === CLIPBOARD_ALARM) void clearClipboard();
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state !== 'locked') return;
  const got = await chrome.storage.session.get([AUTOLOCK_KEY]);
  const cfg = got[AUTOLOCK_KEY] as AutoLockConfig | undefined;
  if (!cfg || cfg.lockOnSystemLock) await lock();
});

chrome.runtime.onMessage.addListener((msg: BgMessage, sender) => {
  // Only accept messages from our own extension pages (never from web pages/content scripts).
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (msg?.type === 'schedule-clipboard-clear' && typeof msg.seconds === 'number' && msg.seconds > 0) {
    void chrome.alarms.create(CLIPBOARD_ALARM, { when: Date.now() + Math.max(30, msg.seconds) * 1000 });
  } else if (msg?.type === 'lock-now') {
    void lock();
  }
});
