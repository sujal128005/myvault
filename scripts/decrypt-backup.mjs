#!/usr/bin/env node
/**
 * MyVault offline recovery tool.
 *
 * Decrypts a .myvault backup WITHOUT the app — proof that you are never locked
 * into MyVault, and a last-resort recovery path. Uses only Node's WebCrypto and
 * hash-wasm (the same Argon2id implementation as the app). Runs fully offline.
 *
 *   node scripts/decrypt-backup.mjs <backup.myvault> [--out vault.json] [--csv logins.csv]
 *
 * The master password is read from the terminal without echo
 * (or from MYVAULT_PASSWORD for automated tests).
 * WARNING: the output files are UNENCRYPTED. Delete them when you are done.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { argon2id } from 'hash-wasm';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out' && args[args.indexOf(a) - 1] !== '--csv');
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (!file) {
  console.error('Usage: node scripts/decrypt-backup.mjs <backup.myvault> [--out vault.json] [--csv logins.csv]');
  process.exit(2);
}

function askHidden(prompt) {
  if (process.env.MYVAULT_PASSWORD) return Promise.resolve(process.env.MYVAULT_PASSWORD);
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let pw = '';
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(pw);
      } else if (ch === '\u0003') process.exit(130);
      else if (ch === '\u007f' || ch === '\b') pw = pw.slice(0, -1);
      else pw += ch;
    };
    stdin.on('data', onData);
  });
}

const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
const aad = (r, purpose) =>
  new TextEncoder().encode(JSON.stringify([r.format, r.version, r.vaultId, r.kdf.name, r.kdf.memoryKiB, r.kdf.iterations, r.kdf.parallelism, r.kdf.salt, purpose]));

const rec = JSON.parse(readFileSync(file, 'utf8'));
if (rec.format !== 'myvault' || rec.version !== 1) {
  console.error('Not a MyVault v1 backup file.');
  process.exit(1);
}
const password = (await askHidden('Master password for this backup: ')).normalize('NFC');
const kekBytes = await argon2id({
  password: new TextEncoder().encode(password),
  salt: b64(rec.kdf.salt),
  parallelism: rec.kdf.parallelism,
  iterations: rec.kdf.iterations,
  memorySize: rec.kdf.memoryKiB,
  hashLength: 32,
  outputType: 'binary',
});
const subtle = globalThis.crypto.subtle;
const kek = await subtle.importKey('raw', kekBytes, 'AES-GCM', false, ['decrypt']);
let dekBytes;
try {
  dekBytes = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: b64(rec.keyWrap.iv), additionalData: aad(rec, 'key') }, kek, b64(rec.keyWrap.ct)));
} catch {
  console.error('Incorrect password (or the file is damaged).');
  process.exit(1);
}
const dek = await subtle.importKey('raw', dekBytes, 'AES-GCM', false, ['decrypt']);
const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64(rec.data.iv), additionalData: aad(rec, 'data') }, dek, b64(rec.data.ct));
const vault = JSON.parse(new TextDecoder().decode(pt));
const live = vault.items.filter((i) => !i.deletedAt);

const out = opt('--out');
const csv = opt('--csv');
if (out) {
  writeFileSync(out, JSON.stringify(vault, null, 2), { mode: 0o600 });
  console.log(`Wrote ${vault.items.length} items to ${out} (UNENCRYPTED — delete after use).`);
}
if (csv) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['name,url,username,password,note', ...live.map((i) => [i.title, i.urls[0] ?? '', i.username || i.email, i.password, i.notes].map(q).join(','))];
  writeFileSync(csv, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`Wrote ${live.length} logins to ${csv} (UNENCRYPTED — delete after use).`);
}
if (!out && !csv) {
  console.log(`Backup decrypted successfully: ${live.length} items, ${vault.folders.length} folders.`);
  for (const i of live) console.log(`  • ${i.title}${i.username ? ` — ${i.username}` : ''}`);
  console.log('Use --out vault.json or --csv logins.csv to write the full contents.');
}
