/**
 * Encrypted vault record format (v1). The same structure is used for the record
 * stored in IndexedDB and for exported backup files, so a backup can always be
 * opened with the master password that was current when it was made.
 *
 * {
 *   format: "myvault", version: 1, vaultId,
 *   kdf:     { name: "argon2id", memoryKiB, iterations, parallelism, salt },
 *   keyWrap: AES-256-GCM(KEK = Argon2id(password), DEK)   AAD = header("key")
 *   data:    AES-256-GCM(DEK, padded JSON(VaultData))      AAD = header("data")
 *   revision, createdAt, updatedAt
 * }
 */
import {
  decrypt,
  deriveKek,
  encrypt,
  importAesKey,
  newDataKeyBytes,
  newKdfParams,
  validateKdfParams,
  DecryptionError,
  KEY_BYTES,
  type EncryptedPayload,
  type KdfParams,
} from './crypto';
import { randomId, utf8Decode, utf8Encode, wipe } from './encoding';
import { sanitizeVaultData, type VaultData } from './model';

export const FORMAT = 'myvault';
export const FORMAT_VERSION = 1;
const PAD_BLOCK = 4096;

export interface EncryptedVaultRecord {
  format: typeof FORMAT;
  version: typeof FORMAT_VERSION;
  vaultId: string;
  kdf: KdfParams;
  keyWrap: EncryptedPayload;
  data: EncryptedPayload;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export class VaultFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultFormatError';
  }
}

export function headerAad(rec: Pick<EncryptedVaultRecord, 'format' | 'version' | 'vaultId' | 'kdf'>, purpose: 'key' | 'data'): Uint8Array {
  const { kdf } = rec;
  return utf8Encode(
    JSON.stringify([rec.format, rec.version, rec.vaultId, kdf.name, kdf.memoryKiB, kdf.iterations, kdf.parallelism, kdf.salt, purpose]),
  );
}

function isPayload(p: unknown): p is EncryptedPayload {
  return !!p && typeof p === 'object' && typeof (p as EncryptedPayload).iv === 'string' && typeof (p as EncryptedPayload).ct === 'string';
}

/** Structural validation of an untrusted record (from storage or a backup file). */
export function validateRecord(v: unknown): EncryptedVaultRecord {
  if (!v || typeof v !== 'object') throw new VaultFormatError('Not a MyVault file');
  const r = v as Record<string, unknown>;
  if (r.format !== FORMAT) throw new VaultFormatError('Not a MyVault file');
  if (r.version !== FORMAT_VERSION) throw new VaultFormatError(`Unsupported vault version ${String(r.version)}`);
  if (typeof r.vaultId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(r.vaultId)) throw new VaultFormatError('Invalid vault id');
  validateKdfParams(r.kdf);
  if (!isPayload(r.keyWrap) || !isPayload(r.data)) throw new VaultFormatError('Missing encrypted payload');
  if (typeof r.revision !== 'number' || !Number.isInteger(r.revision) || r.revision < 0) throw new VaultFormatError('Invalid revision');
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    vaultId: r.vaultId,
    kdf: r.kdf,
    keyWrap: { iv: r.keyWrap.iv, ct: r.keyWrap.ct },
    data: { iv: r.data.iv, ct: r.data.ct },
    revision: r.revision,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString(),
  };
}

function encodeData(data: VaultData): Uint8Array {
  const json = JSON.stringify(sanitizeVaultData(data));
  const bytes = utf8Encode(json);
  // Pad with trailing spaces (valid JSON whitespace) to hide the exact vault size.
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / PAD_BLOCK) * PAD_BLOCK).fill(0x20);
  padded.set(bytes);
  wipe(bytes);
  return padded;
}

/** Encrypt vault data with the DEK, producing the next revision of the record. */
export async function sealData(
  dek: CryptoKey,
  header: Omit<EncryptedVaultRecord, 'data' | 'revision' | 'updatedAt'>,
  data: VaultData,
  revision: number,
  now = new Date().toISOString(),
): Promise<EncryptedVaultRecord> {
  const pt = encodeData(data);
  try {
    const enc = await encrypt(dek, pt, headerAad(header, 'data'));
    return { ...header, data: enc, revision, updatedAt: now };
  } finally {
    wipe(pt);
  }
}

export async function decryptData(dek: CryptoKey, rec: EncryptedVaultRecord): Promise<VaultData> {
  const pt = await decrypt(dek, rec.data, headerAad(rec, 'data'));
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(utf8Decode(pt));
    } catch {
      throw new DecryptionError('Vault data is corrupted');
    }
    return sanitizeVaultData(parsed);
  } finally {
    wipe(pt);
  }
}

/** Unwrap the DEK with the master password. Returns raw bytes — caller must wipe. */
export async function unwrapDataKey(password: string, rec: EncryptedVaultRecord): Promise<Uint8Array> {
  const kek = await deriveKek(password, rec.kdf);
  const dek = await decrypt(kek, rec.keyWrap, headerAad(rec, 'key'));
  if (dek.length !== KEY_BYTES) {
    wipe(dek);
    throw new DecryptionError('Vault key is corrupted');
  }
  return dek;
}

export interface CreatedVault {
  record: EncryptedVaultRecord;
  /** Raw DEK — caller must import and wipe. */
  dekBytes: Uint8Array;
}

export async function createRecord(
  password: string,
  data: VaultData,
  kdfCost?: Omit<KdfParams, 'name' | 'salt'>,
  now = new Date().toISOString(),
): Promise<CreatedVault> {
  const kdf = newKdfParams(kdfCost);
  const base = { format: FORMAT, version: FORMAT_VERSION, vaultId: randomId(), kdf, createdAt: now } as const;
  const dekBytes = newDataKeyBytes();
  const kek = await deriveKek(password, kdf);
  const keyWrap = await encrypt(kek, dekBytes, headerAad(base, 'key'));
  const dek = await importAesKey(dekBytes, false);
  const record = await sealData(dek, { ...base, keyWrap }, data, 1, now);
  return { record, dekBytes };
}

/**
 * Re-wrap the DEK under a new master password (new salt, current default cost).
 * The vault data ciphertext stays valid because the DEK does not change, but the
 * header (and so the data AAD) changes, so the data is re-sealed by the caller.
 */
export async function rewrapRecord(
  rec: EncryptedVaultRecord,
  currentPassword: string,
  newPassword: string,
  kdfCost?: Omit<KdfParams, 'name' | 'salt'>,
): Promise<{ header: Omit<EncryptedVaultRecord, 'data' | 'revision' | 'updatedAt'>; data: VaultData; dekBytes: Uint8Array }> {
  const dekBytes = await unwrapDataKey(currentPassword, rec);
  const dek = await importAesKey(dekBytes, false);
  const data = await decryptData(dek, rec);
  const kdf = newKdfParams(kdfCost);
  const base = { format: FORMAT, version: FORMAT_VERSION, vaultId: rec.vaultId, kdf, createdAt: rec.createdAt } as const;
  const kek = await deriveKek(newPassword, kdf);
  const keyWrap = await encrypt(kek, dekBytes, headerAad(base, 'key'));
  return { header: { ...base, keyWrap }, data, dekBytes };
}

export function headerOf(rec: EncryptedVaultRecord): Omit<EncryptedVaultRecord, 'data' | 'revision' | 'updatedAt'> {
  return {
    format: rec.format,
    version: rec.version,
    vaultId: rec.vaultId,
    kdf: rec.kdf,
    keyWrap: rec.keyWrap,
    createdAt: rec.createdAt,
  };
}
