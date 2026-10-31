import type { VaultItem } from '../core/model';
import { displayHost } from '../core/url';

const GRADIENTS = [
  ['#5ac8fa', '#007aff'],
  ['#64d2ff', '#5e5ce6'],
  ['#bf5af2', '#5e5ce6'],
  ['#ff6482', '#ff2d55'],
  ['#ff9f0a', '#ff6b00'],
  ['#ffd60a', '#ff9f0a'],
  ['#30d158', '#248a3d'],
  ['#66d4cf', '#00a5a0'],
  ['#ac8e68', '#7d6548'],
  ['#8e8e93', '#48484a'],
  ['#ff453a', '#c9142a'],
  ['#0a84ff', '#0040dd'],
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarStyle(seed: string): { backgroundImage: string } {
  const [a, b] = GRADIENTS[hash(seed.toLowerCase()) % GRADIENTS.length]!;
  return { backgroundImage: `linear-gradient(160deg, ${a}, ${b})` };
}

export function initial(text: string): string {
  const t = text.trim();
  if (!t) return '•';
  const ch = [...t][0]!;
  return ch.toUpperCase();
}

export function itemSubtitle(item: VaultItem): string {
  return item.username || item.email || (item.urls[0] ? displayHost(item.urls[0]) : '') || (item.notes ? item.notes.split('\n')[0]! : '');
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = now - Date.parse(iso);
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const y = Math.round(d / 365);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'DecryptionError') return e.message.startsWith('Decryption failed') ? 'Incorrect password.' : e.message;
    return e.message;
  }
  return 'Something went wrong.';
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
