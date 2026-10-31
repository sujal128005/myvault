import { describe, expect, it } from 'vitest';
import {
  decrypt,
  deriveKeyBytes,
  encrypt,
  importAesKey,
  newKdfParams,
  validateKdfParams,
  DecryptionError,
  KdfParamsError,
} from '../../src/core/crypto';
import { base64ToBytes, bytesToBase64, randomBytes, utf8Encode } from '../../src/core/encoding';
import { emptyVault, newItem } from '../../src/core/model';
import { createRecord, decryptData, headerAad, unwrapDataKey, validateRecord } from '../../src/core/vaultFormat';
import { argon2id } from 'hash-wasm';
import { FAST_KDF, PASSWORD } from './helpers';

describe('Argon2id key derivation', () => {
  it('matches the Argon2id v1.3 reference test vector (phc-winner-argon2 test.c)', async () => {
    // t=2, m=2^16 KiB, p=1, password="password", salt="somesalt"
    const hex = await argon2id({
      password: 'password',
      salt: 'somesalt',
      parallelism: 1,
      iterations: 2,
      memorySize: 65536,
      hashLength: 32,
      outputType: 'hex',
    });
    expect(hex).toBe('09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7');
  });

  it('is deterministic for same password+salt and differs for different salts', async () => {
    const p1 = newKdfParams(FAST_KDF);
    const p2 = newKdfParams(FAST_KDF);
    const a = await deriveKeyBytes(PASSWORD, p1);
    const b = await deriveKeyBytes(PASSWORD, p1);
    const c = await deriveKeyBytes(PASSWORD, p2);
    expect(bytesToBase64(a)).toBe(bytesToBase64(b));
    expect(bytesToBase64(a)).not.toBe(bytesToBase64(c));
    expect(a.length).toBe(32);
  });

  it('normalises Unicode so composed/decomposed input derive the same key', async () => {
    const p = newKdfParams(FAST_KDF);
    const composed = await deriveKeyBytes('café-password-1', p);
    const decomposed = await deriveKeyBytes('café-password-1', p);
    expect(bytesToBase64(composed)).toBe(bytesToBase64(decomposed));
  });

  it('rejects weak or absurd KDF parameters (downgrade / DoS protection)', () => {
    const good = newKdfParams(FAST_KDF);
    expect(() => validateKdfParams({ ...good, memoryKiB: 1024 })).toThrow(KdfParamsError);
    expect(() => validateKdfParams({ ...good, iterations: 1 })).toThrow(KdfParamsError);
    expect(() => validateKdfParams({ ...good, memoryKiB: 8 * 1024 * 1024 })).toThrow(KdfParamsError);
    expect(() => validateKdfParams({ ...good, name: 'pbkdf2' })).toThrow(KdfParamsError);
    expect(() => validateKdfParams({ ...good, salt: bytesToBase64(randomBytes(4)) })).toThrow(KdfParamsError);
    expect(() => validateKdfParams(good)).not.toThrow();
  });

  it('defaults to 64 MiB / 3 iterations', () => {
    const p = newKdfParams();
    expect(p.memoryKiB).toBe(65536);
    expect(p.iterations).toBe(3);
    expect(base64ToBytes(p.salt).length).toBe(16);
  });
});

describe('AES-256-GCM', () => {
  const aad = utf8Encode('aad');
  it('round-trips and uses a fresh IV every time', async () => {
    const key = await importAesKey(randomBytes(32));
    const pt = utf8Encode('secret value');
    const e1 = await encrypt(key, pt, aad);
    const e2 = await encrypt(key, pt, aad);
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.ct).not.toBe(e2.ct);
    expect(new TextDecoder().decode(await decrypt(key, e1, aad))).toBe('secret value');
  });

  it('detects ciphertext tampering', async () => {
    const key = await importAesKey(randomBytes(32));
    const e = await encrypt(key, utf8Encode('secret'), aad);
    const ct = base64ToBytes(e.ct);
    ct[0]! ^= 1;
    await expect(decrypt(key, { ...e, ct: bytesToBase64(ct) }, aad)).rejects.toThrow(DecryptionError);
  });

  it('detects AAD mismatch', async () => {
    const key = await importAesKey(randomBytes(32));
    const e = await encrypt(key, utf8Encode('secret'), aad);
    await expect(decrypt(key, e, utf8Encode('other'))).rejects.toThrow(DecryptionError);
  });

  it('rejects malformed payloads without throwing raw errors', async () => {
    const key = await importAesKey(randomBytes(32));
    await expect(decrypt(key, { iv: '!!', ct: 'x' }, aad)).rejects.toThrow(DecryptionError);
    await expect(decrypt(key, { iv: bytesToBase64(randomBytes(4)), ct: bytesToBase64(randomBytes(32)) }, aad)).rejects.toThrow(DecryptionError);
  });

  it('imported keys are non-extractable and the raw bytes are wiped', async () => {
    const raw = randomBytes(32);
    const key = await importAesKey(raw);
    expect(key.extractable).toBe(false);
    expect([...raw].every((b) => b === 0)).toBe(true);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });
});

describe('Vault record format', () => {
  it('creates a record with no plaintext secrets in it', async () => {
    const data = emptyVault();
    data.items.push(newItem({ title: 'Bank', username: 'alice@example.com', password: 'Hunter2-SuperSecret!' }));
    const { record, dekBytes } = await createRecord(PASSWORD, data, FAST_KDF);
    const serialized = JSON.stringify(record);
    for (const needle of ['Bank', 'alice@example.com', 'Hunter2-SuperSecret!', PASSWORD]) {
      expect(serialized).not.toContain(needle);
    }
    expect(serialized).not.toContain(bytesToBase64(dekBytes));
  });

  it('unlocks with the right password and fails with the wrong one', async () => {
    const { record } = await createRecord(PASSWORD, emptyVault(), FAST_KDF);
    const dek = await unwrapDataKey(PASSWORD, record);
    expect(dek.length).toBe(32);
    await expect(unwrapDataKey('wrong password here', record)).rejects.toThrow(DecryptionError);
  });

  it('detects header tampering (vault id / KDF params are authenticated)', async () => {
    const { record, dekBytes } = await createRecord(PASSWORD, emptyVault(), FAST_KDF);
    const key = await importAesKey(dekBytes);
    await expect(decryptData(key, { ...record, vaultId: 'evil-id' })).rejects.toThrow(DecryptionError);
    await expect(unwrapDataKey(PASSWORD, { ...record, kdf: { ...record.kdf, iterations: 3 } })).rejects.toThrow(DecryptionError);
  });

  it('pads ciphertext to hide exact vault size', async () => {
    const small = emptyVault();
    const bigger = emptyVault();
    bigger.items.push(newItem({ title: 'x', password: 'y' }));
    const a = await createRecord(PASSWORD, small, FAST_KDF);
    const b = await createRecord(PASSWORD, bigger, FAST_KDF);
    expect(base64ToBytes(a.record.data.ct).length).toBe(base64ToBytes(b.record.data.ct).length);
  });

  it('header AAD binds purpose', () => {
    const rec = { format: 'myvault' as const, version: 1 as const, vaultId: 'a', kdf: newKdfParams(FAST_KDF) };
    expect(bytesToBase64(headerAad(rec, 'key'))).not.toBe(bytesToBase64(headerAad(rec, 'data')));
  });

  it('validateRecord rejects foreign or malformed files', () => {
    expect(() => validateRecord(null)).toThrow();
    expect(() => validateRecord({ format: 'other' })).toThrow();
    expect(() => validateRecord({ format: 'myvault', version: 99 })).toThrow();
  });
});
