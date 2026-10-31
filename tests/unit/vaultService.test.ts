import { describe, expect, it } from 'vitest';
import { DecryptionError } from '../../src/core/crypto';
import { newItem } from '../../src/core/model';
import { PolicyError, VaultService } from '../../src/core/vaultService';
import { FAST_KDF, PASSWORD, SharedSessionStore, freshRepo, makeService } from './helpers';

describe('VaultService lifecycle', () => {
  it('create → add → lock → unlock round-trip', async () => {
    const { service } = makeService();
    expect(await service.status()).toBe('none');
    await service.create(PASSWORD);
    expect(await service.status()).toBe('unlocked');
    await service.mutate((d) => {
      d.items.push(newItem({ title: 'GitHub', username: 'me', password: 'pw-1234567890' }));
    });
    await service.lock();
    expect(service.isUnlocked).toBe(false);
    expect(() => service.vault).toThrow();
    expect(await service.status()).toBe('locked');
    const data = await service.unlock(PASSWORD);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]!.password).toBe('pw-1234567890');
  });

  it('rejects wrong master password', async () => {
    const { service } = makeService();
    await service.create(PASSWORD);
    await service.lock();
    await expect(service.unlock('not the password!!')).rejects.toThrow(DecryptionError);
    expect(service.isUnlocked).toBe(false);
  });

  it('enforces the master password policy', async () => {
    const { service } = makeService();
    await expect(service.create('short')).rejects.toThrow(PolicyError);
    await expect(service.create(' leading-space-password')).rejects.toThrow(PolicyError);
  });

  it('refuses to create a second vault over an existing one', async () => {
    const { service, repo } = makeService();
    await service.create(PASSWORD);
    const other = new VaultService(repo, new SharedSessionStore(), { kdfCost: FAST_KDF });
    await expect(other.create(PASSWORD + 'x')).rejects.toThrow(/already exists/);
  });

  it('stores only ciphertext in IndexedDB', async () => {
    const { service, repo } = makeService();
    await service.create(PASSWORD);
    await service.mutate((d) => {
      d.items.push(newItem({ title: 'Secret Bank', password: 'TopSecretValue#42' }));
    });
    const stored = JSON.stringify(await repo.load());
    expect(stored).not.toContain('Secret Bank');
    expect(stored).not.toContain('TopSecretValue#42');
    expect(stored).not.toContain(PASSWORD);
  });

  it('changes the master password without losing data', async () => {
    const { service } = makeService();
    await service.create(PASSWORD);
    await service.mutate((d) => {
      d.items.push(newItem({ title: 'A', password: 'p' }));
    });
    await service.changePassword(PASSWORD, 'a brand new master pass');
    await service.lock();
    await expect(service.unlock(PASSWORD)).rejects.toThrow(DecryptionError);
    const d = await service.unlock('a brand new master pass');
    expect(d.items[0]!.title).toBe('A');
  });

  it('change password requires the current password', async () => {
    const { service } = makeService();
    await service.create(PASSWORD);
    await expect(service.changePassword('wrong-current-pass', 'another long password')).rejects.toThrow(DecryptionError);
  });
});

describe('Concurrency (popup + full-page manager)', () => {
  it('never loses updates from two contexts writing the same vault', async () => {
    const repo = freshRepo();
    const session = new SharedSessionStore();
    const a = new VaultService(repo, session, { kdfCost: FAST_KDF });
    const b = new VaultService(repo, session, { kdfCost: FAST_KDF });
    await a.create(PASSWORD);
    expect(await b.resume()).not.toBeNull();
    await a.mutate((d) => {
      d.items.push(newItem({ title: 'from A' }));
    });
    // b still holds the old revision; its write must rebase onto A's change.
    await b.mutate((d) => {
      d.items.push(newItem({ title: 'from B' }));
    });
    const titles = (await a.refresh()).items.map((i) => i.title).sort();
    expect(titles).toEqual(['from A', 'from B']);
  });

  it('parallel mutations all land', async () => {
    const { service } = makeService();
    await service.create(PASSWORD);
    await Promise.all(
      [1, 2, 3].map((n) =>
        service.mutate((d) => {
          d.items.push(newItem({ title: `item ${n}` }));
        }),
      ),
    );
    expect(service.vault.items).toHaveLength(3);
  });

  it('resume() shares an unlock via the session store; lock clears it for everyone', async () => {
    const repo = freshRepo();
    const session = new SharedSessionStore();
    const a = new VaultService(repo, session, { kdfCost: FAST_KDF });
    await a.create(PASSWORD);
    const b = new VaultService(repo, session, { kdfCost: FAST_KDF });
    expect(await b.resume()).not.toBeNull();
    await a.lock();
    expect(session.key).toBeNull();
    const c = new VaultService(repo, session, { kdfCost: FAST_KDF });
    expect(await c.resume()).toBeNull();
  });

  it('website session store never persists the key', async () => {
    const { service, repo, session } = makeService();
    await service.create(PASSWORD);
    expect(await session.load()).toBeNull();
    const other = new VaultService(repo, session, { kdfCost: FAST_KDF });
    expect(await other.resume()).toBeNull();
  });
});

describe('Recovery features', () => {
  it('keeps encrypted snapshots and can restore an earlier revision', async () => {
    const { service } = makeService();
    await service.create(PASSWORD);
    await service.mutate((d) => {
      d.items.push(newItem({ title: 'keep me' }));
    });
    await service.mutate((d) => {
      d.items = [];
    });
    expect(service.vault.items).toHaveLength(0);
    const snaps = await service.listSnapshots();
    const withItem = snaps.find((s) => s.revision === 2)!;
    await service.restoreSnapshot(withItem.id);
    expect(service.vault.items.map((i) => i.title)).toEqual(['keep me']);
  });

  it('caps snapshots at 10', async () => {
    const { service } = makeService();
    await service.create(PASSWORD);
    for (let i = 0; i < 14; i++) await service.mutate((d) => void d.items.push(newItem({ title: `${i}` })));
    expect((await service.listSnapshots()).length).toBe(10);
  });

  it('export requires the master password and produces a restorable backup', async () => {
    const { service } = makeService();
    await service.create(PASSWORD);
    await service.mutate((d) => void d.items.push(newItem({ title: 'Backed up', password: 'xyz' })));
    await expect(service.exportBackup('wrong password!!')).rejects.toThrow();
    const file = await service.exportBackup(PASSWORD);
    expect(file).not.toContain('Backed up');
    expect(service.vault.settings.lastBackupAt).not.toBeNull();

    // New device: restore from backup.
    const fresh = makeService().service;
    await expect(fresh.restoreFromBackup(JSON.parse(file), 'wrong password!!')).rejects.toThrow(DecryptionError);
    const restored = await fresh.restoreFromBackup(JSON.parse(file), PASSWORD);
    expect(restored.items[0]!.title).toBe('Backed up');
    await fresh.lock();
    expect((await fresh.unlock(PASSWORD)).items[0]!.password).toBe('xyz');
  });

  it('destroy wipes the vault', async () => {
    const { service } = makeService();
    await service.create(PASSWORD);
    await service.destroy();
    expect(await service.status()).toBe('none');
  });

  it('purges trash older than 30 days on unlock', async () => {
    const { service } = makeService();
    await service.create(PASSWORD);
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await service.mutate((d) => {
      d.items.push(newItem({ title: 'old trash', deletedAt: old }));
      d.items.push(newItem({ title: 'recent trash', deletedAt: new Date().toISOString() }));
    });
    await service.lock();
    const d = await service.unlock(PASSWORD);
    expect(d.items.map((i) => i.title)).toEqual(['recent trash']);
  });
});
