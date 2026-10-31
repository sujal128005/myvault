/**
 * URL handling + credential ↔ site matching.
 * Matching uses the Public Suffix List (tldts) so look-alike and shared-hosting
 * domains are never treated as the same site.
 */
import { parse } from 'tldts';
import type { VaultItem } from './model';

/** Parse user input like "github.com" or "https://github.com/login" into a URL, or null. */
export function toUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname) return null;
    return u;
  } catch {
    return null;
  }
}

/** Only http(s) URLs may become clickable links (blocks javascript:, data:, etc.). */
export function safeHref(input: string): string | null {
  const u = toUrl(input);
  return u ? u.href : null;
}

export function displayHost(input: string): string {
  const u = toUrl(input);
  return u ? u.hostname.replace(/^www\./, '') : input;
}

export interface SiteInfo {
  hostname: string;
  /** Registrable domain (eTLD+1), e.g. "example.co.uk"; null for IPs/localhost. */
  domain: string | null;
  origin: string;
  protocol: string;
  isIp: boolean;
}

export function siteInfo(input: string): SiteInfo | null {
  const u = toUrl(input);
  if (!u) return null;
  const p = parse(u.hostname, { allowPrivateDomains: true });
  return {
    hostname: u.hostname.toLowerCase(),
    domain: p.isIp ? null : (p.domain ?? null),
    origin: u.origin,
    protocol: u.protocol,
    isIp: !!p.isIp,
  };
}

export type MatchStrength = 'exact' | 'domain';

/**
 * Does a saved URL match the page? exact = same hostname; domain = same registrable
 * domain (private suffixes like github.io count as public, so user sites stay separate).
 */
export function matchUrl(saved: string, page: string): MatchStrength | null {
  const a = siteInfo(saved);
  const b = siteInfo(page);
  if (!a || !b) return null;
  if (a.hostname === b.hostname) return 'exact';
  if (a.isIp || b.isIp || !a.domain || !b.domain) return null;
  return a.domain === b.domain ? 'domain' : null;
}

export interface ItemMatch {
  item: VaultItem;
  strength: MatchStrength;
}

export function findMatches(items: VaultItem[], pageUrl: string): ItemMatch[] {
  const out: ItemMatch[] = [];
  for (const item of items) {
    if (item.deletedAt) continue;
    let best: MatchStrength | null = null;
    for (const u of item.urls) {
      const m = matchUrl(u, pageUrl);
      if (m === 'exact') {
        best = 'exact';
        break;
      }
      if (m) best = m;
    }
    if (best) out.push({ item, strength: best });
  }
  return out.sort(
    (x, y) =>
      (x.strength === y.strength ? 0 : x.strength === 'exact' ? -1 : 1) ||
      Number(y.item.favorite) - Number(x.item.favorite) ||
      (y.item.lastUsedAt ?? '').localeCompare(x.item.lastUsedAt ?? '') ||
      x.item.title.localeCompare(y.item.title),
  );
}

export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}

/**
 * Autofill safety policy: never send a credential to a plain-HTTP page unless the
 * credential itself was saved for that exact http:// host (or it is localhost).
 */
export function fillAllowed(savedUrls: string[], pageUrl: string): { ok: boolean; reason?: string } {
  const page = siteInfo(pageUrl);
  if (!page) return { ok: false, reason: 'This page cannot be filled.' };
  if (page.protocol === 'https:' || isLocalHost(page.hostname)) return { ok: true };
  const savedForHttp = savedUrls.some((u) => {
    const s = siteInfo(u);
    return s && s.protocol === 'http:' && s.hostname === page.hostname;
  });
  return savedForHttp
    ? { ok: true }
    : { ok: false, reason: 'This page is not secure (HTTP). MyVault will not fill passwords here.' };
}

/** Pretty title from a URL: "accounts.google.com" → "Google". */
export function titleFromUrl(input: string): string {
  const info = siteInfo(input);
  if (!info) return '';
  const base = info.domain ? info.domain.split('.')[0]! : info.hostname;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
