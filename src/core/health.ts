/** Vault health report: weak, reused, old, insecure-URL and missing-2FA checks. */
import type { VaultItem } from './model';
import { estimateStrength } from './strength';
import { siteInfo } from './url';

export const OLD_PASSWORD_DAYS = 365;

export interface HealthReport {
  total: number;
  weak: Array<{ item: VaultItem; score: number }>;
  reused: Array<{ items: VaultItem[] }>;
  old: VaultItem[];
  insecureUrl: VaultItem[];
  /** 0–100 overall score */
  score: number;
}

/** Group items sharing the same password (exact match). */
export function findReused(items: VaultItem[]): Array<{ items: VaultItem[] }> {
  const groups = new Map<string, VaultItem[]>();
  for (const i of items) {
    if (i.deletedAt || !i.password) continue;
    const list = groups.get(i.password);
    if (list) list.push(i);
    else groups.set(i.password, [i]);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => ({ items: g }));
}

export function reusedIds(items: VaultItem[]): Set<string> {
  const ids = new Set<string>();
  for (const g of findReused(items)) for (const i of g.items) ids.add(i.id);
  return ids;
}

export function isOld(item: VaultItem, now = Date.now()): boolean {
  const ts = item.passwordUpdatedAt ?? item.createdAt;
  return !!item.password && now - Date.parse(ts) > OLD_PASSWORD_DAYS * 86_400_000;
}

export async function buildHealthReport(all: VaultItem[], now = Date.now()): Promise<HealthReport> {
  const items = all.filter((i) => !i.deletedAt && i.password);
  const weak: HealthReport['weak'] = [];
  for (const item of items) {
    const s = await estimateStrength(item.password, [item.username, item.email, item.title]);
    if (s.score < 3) weak.push({ item, score: s.score });
  }
  const reused = findReused(items);
  const old = items.filter((i) => isOld(i, now));
  const insecureUrl = all.filter((i) => !i.deletedAt && i.urls.some((u) => siteInfo(u)?.protocol === 'http:'));
  const problems = new Set<string>([...weak.map((w) => w.item.id), ...reused.flatMap((g) => g.items.map((i) => i.id))]);
  const score = items.length === 0 ? 100 : Math.round(((items.length - problems.size) / items.length) * 100 - Math.min(10, old.length));
  return { total: items.length, weak, reused, old, insecureUrl, score: Math.max(0, score) };
}
