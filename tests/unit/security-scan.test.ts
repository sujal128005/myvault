/**
 * Static security checks over the shipped source code. These guard against
 * regressions that would leak secrets or open XSS / exfiltration paths.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
const files = walk('src').filter((f) => !f.endsWith('wordlist.ts'));
const read = (f: string) => readFileSync(f, 'utf8');
/** Source with comments removed, so documentation can mention forbidden APIs. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const forbidden: Array<[string, RegExp]> = [
  ['console logging (could leak secrets)', /\bconsole\.(log|info|debug|warn|error|trace|dir)\s*\(/],
  ['network: fetch', /\bfetch\s*\(/],
  ['network: XMLHttpRequest', /XMLHttpRequest/],
  ['network: WebSocket', /\bWebSocket\b/],
  ['network: sendBeacon', /sendBeacon/],
  ['network: EventSource', /\bEventSource\b/],
  ['dynamic code: eval', /\beval\s*\(/],
  ['dynamic code: new Function', /new\s+Function\s*\(/],
  ['XSS sink: dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['XSS sink: innerHTML/outerHTML', /\.(inner|outer)HTML\s*=/],
  ['XSS sink: insertAdjacentHTML', /insertAdjacentHTML/],
  ['XSS sink: document.write', /document\.write/],
  ['weak randomness: Math.random', /Math\.random/],
  ['persisting secrets in localStorage', /localStorage\.setItem\([^)]*(password|secret|dek|masterKey|vaultKey)/i],
  ['remote resources', /https?:\/\/(?!www\.eff\.org)[a-z0-9.-]+\.(com|net|org|io|dev)\/[^\s'"`]*\.(js|css|woff2?|png|svg)/i],
];

describe('static security scan of src/', () => {
  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(25);
  });
  for (const [label, re] of forbidden) {
    it(`contains no ${label}`, () => {
      const hits = files.filter((f) => re.test(code(f)));
      expect(hits).toEqual([]);
    });
  }
  it('opens external links only with rel="noopener noreferrer"', () => {
    for (const f of files) {
      for (const m of read(f).matchAll(/target="_blank"[^>]*/g)) expect(m[0], f).toContain('noopener noreferrer');
    }
  });
  it('the extension never declares content scripts or broad host permissions', () => {
    const m = JSON.parse(read('src/extension/manifest.json'));
    expect(m.content_scripts).toBeUndefined();
    expect(m.host_permissions).toBeUndefined();
    expect(m.permissions).not.toContain('tabs');
    expect(m.permissions).not.toContain('<all_urls>');
  });
});
