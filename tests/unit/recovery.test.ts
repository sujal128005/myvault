/** The standalone recovery script must decrypt real backups without the app. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { emptyVault, newItem } from '../../src/core/model';
import { createRecord } from '../../src/core/vaultFormat';
import { FAST_KDF } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'myvault-recovery-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(file: string, password: string, extra: string[] = []) {
  try {
    const out = execFileSync(process.execPath, ['scripts/decrypt-backup.mjs', file, ...extra], { env: { ...process.env, MYVAULT_PASSWORD: password }, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: err.stdout + err.stderr };
  }
}

describe('scripts/decrypt-backup.mjs', () => {
  it('decrypts a backup to CSV and JSON with the right password, refuses a wrong one', async () => {
    const d = emptyVault();
    d.items.push(newItem({ title: 'Recovered Site', username: 'rescue', password: 'Rescue,"Pw"-1', urls: ['https://r.example'] }));
    d.items.push(newItem({ title: 'Deleted', password: 'x', deletedAt: new Date().toISOString() }));
    const { record } = await createRecord('recovery test password', d, FAST_KDF);
    const file = join(dir, 'b.myvault');
    writeFileSync(file, JSON.stringify(record));

    const csv = join(dir, 'out.csv');
    const json = join(dir, 'out.json');
    const ok = run(file, 'recovery test password', ['--csv', csv, '--out', json]);
    expect(ok.code).toBe(0);
    expect(readFileSync(csv, 'utf8')).toBe('name,url,username,password,note\n"Recovered Site","https://r.example","rescue","Rescue,""Pw""-1",""\n');
    expect(JSON.parse(readFileSync(json, 'utf8')).items).toHaveLength(2);

    const bad = run(file, 'wrong password');
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('Incorrect password');
  });
});
