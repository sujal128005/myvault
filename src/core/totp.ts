/**
 * TOTP (RFC 6238) on top of WebCrypto HMAC. This is protocol code, not a crypto
 * primitive: the HMAC itself is the browser's implementation. Verified against the
 * RFC 6238 Appendix B test vectors in tests/unit/totp.test.ts.
 */
import type { TotpAlgorithm, TotpConfig } from './model';
import { sanitizeTotp } from './model';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]*$/.test(clean)) throw new Error('Invalid Base32 secret');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const HASH: Record<TotpAlgorithm, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

export async function hotp(key: Uint8Array, counter: number, digits: number, algorithm: TotpAlgorithm): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const k = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: HASH[algorithm] }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export async function totp(cfg: TotpConfig, nowMs = Date.now()): Promise<{ code: string; remaining: number }> {
  const key = base32Decode(cfg.secret);
  if (key.length === 0) throw new Error('Empty TOTP secret');
  const step = Math.floor(nowMs / 1000 / cfg.period);
  const code = await hotp(key, step, cfg.digits, cfg.algorithm);
  key.fill(0);
  const remaining = cfg.period - (Math.floor(nowMs / 1000) % cfg.period);
  return { code, remaining };
}

/**
 * Parse either a bare Base32 secret or an otpauth://totp/... URI
 * (as encoded in authenticator QR codes).
 */
export function parseTotpInput(input: string): TotpConfig | null {
  const text = input.trim();
  if (!text) return null;
  if (/^otpauth:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.host.toLowerCase() !== 'totp') return null;
    const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const [labelIssuer, account] = label.includes(':') ? label.split(/:(.*)/s) : ['', label];
    const p = url.searchParams;
    return sanitizeTotp({
      secret: p.get('secret') ?? '',
      issuer: p.get('issuer') ?? labelIssuer ?? '',
      account: (account ?? '').trim(),
      algorithm: (p.get('algorithm') ?? 'SHA1').toUpperCase(),
      digits: Number(p.get('digits') ?? 6),
      period: Number(p.get('period') ?? 30),
    });
  }
  const cfg = sanitizeTotp({ secret: text });
  if (cfg && base32Decode(cfg.secret).length < 10) return null; // < 80 bits is not a real TOTP secret
  return cfg;
}

export function formatTotp(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}
