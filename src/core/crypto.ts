/**
 * Cryptographic building blocks. Only established primitives are used:
 *  - Argon2id (hash-wasm, WASM build of the reference implementation) for key derivation
 *  - AES-256-GCM (WebCrypto) for authenticated encryption
 * Nothing in this file implements a cryptographic primitive itself.
 */
import { argon2id } from 'hash-wasm';
import { base64ToBytes, bytesToBase64, randomBytes, utf8Encode, wipe } from './encoding';

export interface KdfParams {
  name: 'argon2id';
  /** Memory cost in KiB. */
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  /** Base64, 16 random bytes. */
  salt: string;
}

/** Default cost: 64 MiB, 3 passes (stronger than OWASP's minimum of 19 MiB / 2 passes). */
export const DEFAULT_KDF_COST = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 } as const;

/** Accepted range when loading a vault. Below = too weak; above = memory-exhaustion risk. */
export const KDF_BOUNDS = {
  memoryKiB: { min: 19 * 1024, max: 1024 * 1024 },
  iterations: { min: 2, max: 20 },
  parallelism: { min: 1, max: 8 },
} as const;

export const SALT_BYTES = 16;
export const KEY_BYTES = 32;
export const IV_BYTES = 12;

export interface EncryptedPayload {
  /** Base64 96-bit IV. */
  iv: string;
  /** Base64 ciphertext including the 128-bit GCM tag. */
  ct: string;
}

export class DecryptionError extends Error {
  constructor(message = 'Decryption failed: wrong password or corrupted/tampered data') {
    super(message);
    this.name = 'DecryptionError';
  }
}

export class KdfParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KdfParamsError';
  }
}

export function newKdfParams(cost: Omit<KdfParams, 'name' | 'salt'> = DEFAULT_KDF_COST): KdfParams {
  const params: KdfParams = { name: 'argon2id', ...cost, salt: bytesToBase64(randomBytes(SALT_BYTES)) };
  validateKdfParams(params);
  return params;
}

export function validateKdfParams(p: unknown): asserts p is KdfParams {
  if (!p || typeof p !== 'object') throw new KdfParamsError('Missing KDF parameters');
  const k = p as Record<string, unknown>;
  if (k.name !== 'argon2id') throw new KdfParamsError('Unsupported KDF');
  for (const field of ['memoryKiB', 'iterations', 'parallelism'] as const) {
    const v = k[field];
    const { min, max } = KDF_BOUNDS[field];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new KdfParamsError(`KDF parameter ${field} out of allowed range`);
    }
  }
  if (typeof k.salt !== 'string') throw new KdfParamsError('Missing KDF salt');
  if (base64ToBytes(k.salt).length !== SALT_BYTES) throw new KdfParamsError('Invalid KDF salt');
}

/** Unicode-normalise so the same password typed on different OSes derives the same key. */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

/** Argon2id(master password) → raw 256-bit key-encryption key bytes. Caller must wipe. */
export async function deriveKeyBytes(password: string, params: KdfParams): Promise<Uint8Array> {
  validateKdfParams(params);
  const pwBytes = utf8Encode(normalizePassword(password));
  try {
    return await argon2id({
      password: pwBytes,
      salt: base64ToBytes(params.salt),
      parallelism: params.parallelism,
      iterations: params.iterations,
      memorySize: params.memoryKiB,
      hashLength: KEY_BYTES,
      outputType: 'binary',
    });
  } finally {
    wipe(pwBytes);
  }
}

/** Import raw AES-256 key bytes as a non-extractable WebCrypto key, then wipe the bytes. */
export async function importAesKey(raw: Uint8Array, wipeAfter = true): Promise<CryptoKey> {
  if (raw.length !== KEY_BYTES) throw new Error('Invalid key length');
  try {
    return await crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  } finally {
    if (wipeAfter) wipe(raw);
  }
}

export async function deriveKek(password: string, params: KdfParams): Promise<CryptoKey> {
  return importAesKey(await deriveKeyBytes(password, params));
}

export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<EncryptedPayload> {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new Uint8Array(aad), tagLength: 128 },
    key,
    new Uint8Array(plaintext),
  );
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

export async function decrypt(
  key: CryptoKey,
  payload: EncryptedPayload,
  aad: Uint8Array,
): Promise<Uint8Array> {
  let iv: Uint8Array<ArrayBuffer>;
  let ct: Uint8Array<ArrayBuffer>;
  try {
    iv = base64ToBytes(payload.iv);
    ct = base64ToBytes(payload.ct);
  } catch {
    throw new DecryptionError('Encrypted data is malformed');
  }
  if (iv.length !== IV_BYTES || ct.length < 16) throw new DecryptionError('Encrypted data is malformed');
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new Uint8Array(aad), tagLength: 128 },
      key,
      ct,
    );
    return new Uint8Array(pt);
  } catch {
    throw new DecryptionError();
  }
}

export function newDataKeyBytes(): Uint8Array {
  return randomBytes(KEY_BYTES);
}
