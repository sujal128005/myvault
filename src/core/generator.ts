/**
 * Password & passphrase generator using the platform CSPRNG with unbiased
 * rejection sampling. No Math.random anywhere.
 */
import { EFF_WORDLIST } from './wordlist';

export interface GeneratorOptions {
  mode: 'password' | 'passphrase';
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
  /** Passphrase settings */
  words: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}

export const DEFAULT_GENERATOR: GeneratorOptions = {
  mode: 'password',
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
  words: 5,
  separator: '-',
  capitalize: true,
  includeNumber: true,
};

export const LENGTH_MIN = 8;
export const LENGTH_MAX = 128;
export const WORDS_MIN = 3;
export const WORDS_MAX = 12;

const SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
} as const;
const AMBIGUOUS = new Set('Il1O0o|`\'"'.split(''));

/** Uniform random integer in [0, max) using rejection sampling. */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('Invalid max');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < limit) return v % max;
  }
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)]!;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export function charsetsFor(opts: GeneratorOptions): string[] {
  const sets: string[] = [];
  for (const key of ['uppercase', 'lowercase', 'digits', 'symbols'] as const) {
    if (!opts[key]) continue;
    let chars: string = SETS[key];
    if (opts.avoidAmbiguous) chars = [...chars].filter((c) => !AMBIGUOUS.has(c)).join('');
    sets.push(chars);
  }
  return sets;
}

export function normalizeGeneratorOptions(o: Partial<GeneratorOptions> | undefined): GeneratorOptions {
  const merged = { ...DEFAULT_GENERATOR, ...(o ?? {}) };
  const clamp = (n: unknown, lo: number, hi: number, d: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
  const out: GeneratorOptions = {
    mode: merged.mode === 'passphrase' ? 'passphrase' : 'password',
    length: clamp(merged.length, LENGTH_MIN, LENGTH_MAX, DEFAULT_GENERATOR.length),
    uppercase: !!merged.uppercase,
    lowercase: !!merged.lowercase,
    digits: !!merged.digits,
    symbols: !!merged.symbols,
    avoidAmbiguous: !!merged.avoidAmbiguous,
    words: clamp(merged.words, WORDS_MIN, WORDS_MAX, DEFAULT_GENERATOR.words),
    separator: typeof merged.separator === 'string' ? merged.separator.slice(0, 3) : '-',
    capitalize: !!merged.capitalize,
    includeNumber: !!merged.includeNumber,
  };
  if (!out.uppercase && !out.lowercase && !out.digits && !out.symbols) out.lowercase = true;
  return out;
}

export function generatePassword(input: Partial<GeneratorOptions> = {}): string {
  const opts = normalizeGeneratorOptions(input);
  if (opts.mode === 'passphrase') return generatePassphrase(opts);
  const sets = charsetsFor(opts);
  const all = sets.join('');
  // Guarantee at least one character from every selected set, then fill uniformly.
  const chars = sets.map((s) => pick(s));
  while (chars.length < opts.length) chars.push(pick(all));
  return shuffle(chars).join('');
}

export function generatePassphrase(opts: GeneratorOptions): string {
  const words: string[] = [];
  for (let i = 0; i < opts.words; i++) {
    let w = EFF_WORDLIST[randomInt(EFF_WORDLIST.length)]!;
    if (opts.capitalize) w = w[0]!.toUpperCase() + w.slice(1);
    words.push(w);
  }
  if (opts.includeNumber) {
    const i = randomInt(words.length);
    words[i] = words[i]! + String(randomInt(10));
  }
  return words.join(opts.separator);
}

/** Entropy (bits) of the generator configuration itself — not of an arbitrary password. */
export function generatorEntropyBits(input: Partial<GeneratorOptions>): number {
  const opts = normalizeGeneratorOptions(input);
  if (opts.mode === 'passphrase') {
    let bits = opts.words * Math.log2(EFF_WORDLIST.length);
    if (opts.includeNumber) bits += Math.log2(10 * opts.words);
    return Math.floor(bits);
  }
  const size = charsetsFor(opts).join('').length;
  return Math.floor(opts.length * Math.log2(size));
}
