import type { VaultItem } from './model';

/**
 * Case/diacritic-insensitive search across non-secret fields. Passwords, secret
 * custom-field values and TOTP secrets are deliberately NOT searchable.
 */
function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function searchableText(i: VaultItem): string {
  return fold(
    [
      i.title,
      i.username,
      i.email,
      ...i.urls,
      ...i.tags,
      i.notes,
      ...i.fields.flatMap((f) => (f.secret ? [f.label] : [f.label, f.value])),
    ].join('\n'),
  );
}

export function matchesQuery(item: VaultItem, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = searchableText(item);
  return terms.every((t) => hay.includes(t));
}

export type SortKey = 'name' | 'updated' | 'used' | 'created';

export function sortItems(items: VaultItem[], key: SortKey): VaultItem[] {
  const arr = [...items];
  const byName = (a: VaultItem, b: VaultItem) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  switch (key) {
    case 'updated':
      return arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b));
    case 'created':
      return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b));
    case 'used':
      return arr.sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || byName(a, b));
    default:
      return arr.sort(byName);
  }
}
