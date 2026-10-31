/** Offscreen document: its only job is to overwrite the clipboard on request. */
import type { OffscreenMessage } from './messages';

chrome.runtime.onMessage.addListener((msg: OffscreenMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.target !== 'offscreen' || msg.type !== 'clear-clipboard') return;
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/plain', '');
    e.preventDefault();
  };
  document.addEventListener('copy', onCopy);
  try {
    document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy);
  }
  sendResponse(true);
});
