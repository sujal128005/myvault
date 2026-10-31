import { ChevronLeft, Download, FileSpreadsheet, History, KeyRound, ShieldCheck, Trash2, Upload, AlertTriangle, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { backupFileName, mergeVaults, openBackup, parseBackupFile } from '../../core/backup';
import { applyCsvImport, dedupeCsvImport, importCsvFiles } from '../../core/csvImport';
import { AUTO_LOCK_CHOICES, CLIPBOARD_CHOICES } from '../../core/model';
import { isStoragePersistent, requestPersistentStorage, type SnapshotInfo } from '../../core/storage';
import { MASTER_PASSWORD_MIN_LENGTH } from '../../core/vaultService';
import { ConfirmDialog, Modal, PasswordPrompt, SecretInput, Segmented, Spinner, StrengthMeter, Switch } from '../components/primitives';
import { useStrength, useTheme, type ThemePref } from '../hooks';
import { usePlatform } from '../platform';
import { useVault, useVaultData } from '../state';
import { useToast } from '../toast';
import { BACKUP_ACCEPT, CSV_ACCEPT, downloadText, errorMessage, formatDate, pickFile, pickFiles, readTextFile, relativeTime } from '../util';
import { RestoreBackupModal } from './AuthViews';

type Dialog = null | 'export' | 'import' | 'csv' | 'password' | 'snapshots' | 'delete' | 'replace' | 'emptyTrash';

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const data = useVaultData();
  const { actions } = useVault();
  const platform = usePlatform();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const s = data.settings;
  const meta = platform.service.meta;
  const trashCount = data.items.filter((i) => i.deletedAt).length;

  useEffect(() => {
    void isStoragePersistent().then(setPersistent);
  }, []);

  const setting = async (patch: Partial<typeof s>) => {
    try {
      await actions.updateSettings(patch);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    }
  };

  return (
    <div className="scroll" style={{ height: '100%' }}>
      <div className="mobile-bar">
        <button className="back" onClick={onBack}>
          <ChevronLeft /> Library
        </button>
      </div>
      <div className="page">
        <header className="page-head">
          <h1>Settings</h1>
          <p>Security, backups and appearance.</p>
        </header>

        <section className="group-section">
          <h3 className="group-title">Security</h3>
          <div className="group">
            <div className="row">
              <div className="row-main">Auto-lock after inactivity</div>
              <select className="select" style={{ width: 'auto' }} value={s.autoLockMinutes} onChange={(e) => setting({ autoLockMinutes: Number(e.target.value) })} aria-label="Auto-lock after">
                {AUTO_LOCK_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minute${m === 1 ? '' : 's'}` : `${m / 60} hour${m === 60 ? '' : 's'}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <div className="row-main">Clear clipboard after copying</div>
              <select className="select" style={{ width: 'auto' }} value={s.clipboardClearSeconds} onChange={(e) => setting({ clipboardClearSeconds: Number(e.target.value) })} aria-label="Clear clipboard after">
                {CLIPBOARD_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c === 0 ? 'Never' : `${c} seconds`}
                  </option>
                ))}
              </select>
            </div>
            {platform.kind === 'web' ? (
              <div className="row">
                <div className="row-main">
                  Lock when tab is hidden
                  <div className="faint" style={{ fontSize: 12 }}>After one minute in the background</div>
                </div>
                <Switch checked={s.lockOnHide} onChange={(v) => setting({ lockOnHide: v })} label="Lock when tab is hidden" />
              </div>
            ) : (
              <div className="row">
                <div className="row-main">Lock when computer locks or sleeps</div>
                <Switch checked={s.lockOnSystemLock} onChange={(v) => setting({ lockOnSystemLock: v })} label="Lock when computer locks" />
              </div>
            )}
            <button className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setDialog('password')}>
              <KeyRound size={17} className="muted" />
              <div className="row-main" style={{ color: 'var(--accent-text)' }}>
                Change Master Password…
              </div>
            </button>
          </div>
          {platform.kind === 'extension' && s.clipboardClearSeconds > 0 && s.clipboardClearSeconds < 30 && (
            <p className="group-footer">In the extension, Chrome clears the clipboard no sooner than 30 seconds after copying.</p>
          )}
        </section>

        <section className="group-section">
          <h3 className="group-title">Backup & Restore</h3>
          <div className="group">
            <button className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setDialog('export')}>
              <Download size={17} className="muted" />
              <div className="row-main">
                <div style={{ color: 'var(--accent-text)' }}>Export Encrypted Backup…</div>
                <div className="faint" style={{ fontSize: 12 }}>Last backup: {s.lastBackupAt ? `${relativeTime(s.lastBackupAt)}` : 'never'}</div>
              </div>
            </button>
            <button className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setDialog('import')}>
              <Upload size={17} className="muted" />
              <div className="row-main" style={{ color: 'var(--accent-text)' }}>
                Import Backup (Merge)…
              </div>
            </button>
            <button className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setDialog('csv')}>
              <FileSpreadsheet size={17} className="muted" />
              <div className="row-main">
                <div style={{ color: 'var(--accent-text)' }}>Import from Another Password Manager…</div>
                <div className="faint" style={{ fontSize: 12 }}>CSV from Chrome, Edge, Firefox, Bitwarden, LastPass, 1Password</div>
              </div>
            </button>
            <button className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setDialog('snapshots')}>
              <History size={17} className="muted" />
              <div className="row-main">
                <div style={{ color: 'var(--accent-text)' }}>Restore an Earlier Version…</div>
                <div className="faint" style={{ fontSize: 12 }}>The last 10 saved versions are kept, encrypted</div>
              </div>
            </button>
            <div className="row">
              <div className="row-main">Backup reminder</div>
              <select className="select" style={{ width: 'auto' }} value={s.backupReminderDays} onChange={(e) => setting({ backupReminderDays: Number(e.target.value) })} aria-label="Backup reminder">
                {[0, 7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? 'Off' : `Every ${d} days`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="group-footer">
            Backups are encrypted with your current master password. Store copies somewhere safe and offline (USB drive, a second device). Without a backup, clearing browser data or
            uninstalling {platform.kind === 'extension' ? 'the extension' : 'the browser'} deletes your vault.
          </p>
        </section>

        <section className="group-section">
          <h3 className="group-title">Appearance</h3>
          <div className="group">
            <div className="row">
              <div className="row-main">Theme</div>
              <Segmented<ThemePref>
                label="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'system', label: 'Auto' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </div>
          </div>
        </section>

        <section className="group-section">
          <h3 className="group-title">Vault</h3>
          <div className="group">
            <div className="row">
              <dl className="kv" style={{ width: '100%', margin: 0 }}>
                <dt>Items</dt>
                <dd>{data.items.filter((i) => !i.deletedAt).length}</dd>
                <dt>Created</dt>
                <dd>{formatDate(meta?.createdAt ?? null)}</dd>
                <dt>Last saved</dt>
                <dd>{formatDate(meta?.updatedAt ?? null)}</dd>
                <dt>Revision</dt>
                <dd>{meta?.revision}</dd>
                <dt>Encryption</dt>
                <dd>AES-256-GCM</dd>
                <dt>Key derivation</dt>
                <dd>
                  Argon2id · {(meta?.kdf.memoryKiB ?? 0) / 1024} MiB · {meta?.kdf.iterations} passes
                </dd>
                <dt>Persistent storage</dt>
                <dd>
                  {persistent === null ? (
                    'Unknown'
                  ) : persistent ? (
                    <span style={{ color: 'var(--green)' }}>Granted</span>
                  ) : (
                    <button className="btn-plain btn btn-sm" style={{ height: 22 }} onClick={async () => setPersistent(await requestPersistentStorage())}>
                      Request
                    </button>
                  )}
                </dd>
              </dl>
            </div>
            {trashCount > 0 && (
              <button className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setDialog('emptyTrash')}>
                <Trash2 size={17} className="muted" />
                <div className="row-main" style={{ color: 'var(--red)' }}>
                  Empty Recently Deleted ({trashCount})
                </div>
              </button>
            )}
          </div>
        </section>

        <section className="group-section">
          <h3 className="group-title">Security Model</h3>
          <div className="group">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <ShieldCheck size={18} style={{ color: 'var(--green)', marginTop: 2, flex: 'none' }} />
              <div className="row-main" style={{ fontSize: 13, lineHeight: 1.55 }}>
                Your vault is encrypted on this device with AES-256-GCM using a key derived from your master password by Argon2id. Your master password and keys are never stored or
                transmitted, and the app is blocked by its Content Security Policy from making any network connection.
              </div>
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Info size={18} style={{ color: 'var(--orange)', marginTop: 2, flex: 'none' }} />
              <div className="row-main" style={{ fontSize: 13, lineHeight: 1.55 }}>
                <strong>Limits:</strong> MyVault can't protect you from malware or malicious extensions on this device, can't securely wipe memory (JavaScript limitation), and clipboard
                history tools may keep copies. It has automated tests but has not been independently audited. Forgetting your master password means permanent data loss.
              </div>
            </div>
          </div>
        </section>

        <section className="group-section">
          <h3 className="group-title">Danger Zone</h3>
          <div className="group">
            <button className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setDialog('replace')}>
              <Upload size={17} style={{ color: 'var(--red)' }} />
              <div className="row-main" style={{ color: 'var(--red)' }}>
                Replace Vault with Backup…
              </div>
            </button>
            <button className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setDialog('delete')}>
              <Trash2 size={17} style={{ color: 'var(--red)' }} />
              <div className="row-main" style={{ color: 'var(--red)' }}>
                Erase Vault from This {platform.kind === 'extension' ? 'Browser' : 'Browser'}…
              </div>
            </button>
          </div>
        </section>
      </div>

      {dialog === 'export' && (
        <PasswordPrompt
          title="Export encrypted backup"
          message="Confirm your master password. The backup file is encrypted with it — you'll need this same password to restore it."
          confirmLabel="Export"
          onCancel={() => setDialog(null)}
          onSubmit={async (pw) => {
            const text = await platform.service.exportBackup(pw);
            downloadText(backupFileName(), text);
            setDialog(null);
            await actions.refreshStatus();
            toast('Backup exported', { sub: 'keep it somewhere safe' });
          }}
        />
      )}
      {dialog === 'import' && <ImportBackupDialog onClose={() => setDialog(null)} />}
      {dialog === 'csv' && <CsvImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'password' && <ChangePasswordDialog onClose={() => setDialog(null)} />}
      {dialog === 'snapshots' && <SnapshotsDialog onClose={() => setDialog(null)} />}
      {dialog === 'replace' && <RestoreBackupModal replacing onClose={() => setDialog(null)} />}
      {dialog === 'emptyTrash' && (
        <ConfirmDialog
          danger
          title="Empty Recently Deleted?"
          message={`${trashCount} item${trashCount === 1 ? '' : 's'} will be permanently erased.`}
          confirmLabel="Empty"
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            await actions.emptyTrash();
            setDialog(null);
            toast('Recently Deleted emptied');
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          danger
          title="Erase this vault?"
          message="Every item, folder and saved version in this browser will be permanently erased. Make sure you have a backup first."
          confirmLabel="Erase Vault"
          requireText="ERASE"
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            await platform.service.destroy();
            await actions.refreshStatus();
          }}
        />
      )}
    </div>
  );
}

function ImportBackupDialog({ onClose }: { onClose: () => void }) {
  const { actions } = useVault();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal onClose={onClose} labelledBy="imp-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          setBusy(true);
          setErr('');
          try {
            const incoming = await openBackup(parseBackupFile(file.text), pw);
            let stats = { added: 0, updated: 0 };
            await actions.replaceData((cur) => {
              const r = mergeVaults(cur, incoming);
              stats = r;
              return { ...r.data, settings: cur.settings };
            });
            toast(`Imported ${stats.added} new, ${stats.updated} updated`);
            onClose();
          } catch (ex) {
            setErr(errorMessage(ex));
            setBusy(false);
          }
        }}
      >
        <div className="modal-head">
          <div className="modal-icon">
            <Upload />
          </div>
          <h2 id="imp-title">Import backup</h2>
          <p>Items from the backup are merged into your vault. When an item exists in both, the most recently edited copy is kept. Nothing is deleted.</p>
        </div>
        <div className="modal-body">
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={async () => {
              const f = await pickFile(BACKUP_ACCEPT);
              if (!f) return;
              try {
                setFile({ name: f.name, text: await readTextFile(f) });
                setErr('');
              } catch (ex) {
                setErr(errorMessage(ex));
              }
            }}
          >
            <Upload /> {file ? file.name : 'Choose backup file…'}
          </button>
          <SecretInput value={pw} onChange={setPw} placeholder="Backup's master password" aria-label="Backup master password" />
          {err && <div className="input-error">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!file || !pw || busy}>
            {busy && <Spinner />} Import
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CsvImportDialog({ onClose }: { onClose: () => void }) {
  const data = useVaultData();
  const { actions } = useVault();
  const toast = useToast();
  const [files, setFiles] = useState<string[]>([]);
  const [preview, setPreview] = useState<ReturnType<typeof dedupeCsvImport> | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} labelledBy="csv-title">
      <div className="modal-head">
        <div className="modal-icon warn">
          <FileSpreadsheet />
        </div>
        <h2 id="csv-title">Import from CSV</h2>
        <p>
          Choose one or more CSV exports — for example from Chrome <em>and</em> Edge at the same time. Logins that appear in several files, or are already in your vault, are
          imported only once.
        </p>
      </div>
      <div className="modal-body">
        <div className="callout warn">
          <AlertTriangle />
          <div>
            CSV exports are <strong>unencrypted</strong>. After importing, delete the files and empty your Trash / Recycle Bin.
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={async () => {
            setErr('');
            const picked = await pickFiles(CSV_ACCEPT);
            if (!picked.length) return;
            setFiles(picked.map((f) => f.name));
            try {
              const texts = await Promise.all(picked.map(readTextFile));
              setPreview(dedupeCsvImport(data.items, importCsvFiles(texts)));
            } catch (e) {
              setPreview(null);
              setErr(errorMessage(e));
            }
          }}
        >
          <FileSpreadsheet /> {files.length ? files.join(', ') : 'Choose CSV files…'}
        </button>
        {preview && (
          <p className="muted" style={{ fontSize: 13 }} data-testid="csv-summary">
            <strong>{preview.entries.length}</strong> new login{preview.entries.length === 1 ? '' : 's'} to import
            {preview.duplicates ? ` · ${preview.duplicates} duplicate${preview.duplicates === 1 ? '' : 's'} skipped` : ''}
            {preview.skipped ? ` · ${preview.skipped} empty row${preview.skipped === 1 ? '' : 's'} skipped` : ''}.
          </p>
        )}
        {err && <div className="input-error">{err}</div>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!preview || !preview.entries.length || busy}
          onClick={async () => {
            if (!preview) return;
            setBusy(true);
            try {
              // Re-check against the latest vault inside the write, in case it changed meanwhile.
              let added = 0;
              await actions.replaceData((d) => {
                const fresh = dedupeCsvImport(d.items, preview);
                added = fresh.entries.length;
                return applyCsvImport(d, fresh);
              });
              toast(`Imported ${added} logins`, { sub: 'now delete the CSV files', ms: 4000 });
              onClose();
            } catch (e) {
              setErr(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />} Import {preview ? preview.entries.length : ''}
        </button>
      </div>
    </Modal>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const platform = usePlatform();
  const { actions } = useVault();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const strength = useStrength(next);
  const ok = cur && [...next].length >= MASTER_PASSWORD_MIN_LENGTH && (strength?.score ?? 0) >= 3 && next === confirm && next.trim() === next;
  return (
    <Modal onClose={onClose} labelledBy="cp-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          setBusy(true);
          setErr('');
          try {
            await platform.service.changePassword(cur, next);
            await actions.refreshStatus();
            toast('Master password changed', { sub: 'export a fresh backup' });
            onClose();
          } catch (ex) {
            setErr(errorMessage(ex));
            setBusy(false);
          }
        }}
      >
        <div className="modal-head">
          <div className="modal-icon">
            <KeyRound />
          </div>
          <h2 id="cp-title">Change master password</h2>
          <p>Older backups stay encrypted with the password that was current when they were made.</p>
        </div>
        <div className="modal-body">
          <SecretInput value={cur} onChange={setCur} placeholder="Current master password" aria-label="Current master password" autoComplete="current-password" />
          <SecretInput value={next} onChange={setNext} placeholder={`New password (${MASTER_PASSWORD_MIN_LENGTH}+ characters)`} aria-label="New master password" autoComplete="new-password" />
          <StrengthMeter password={next} />
          <SecretInput value={confirm} onChange={setConfirm} placeholder="Confirm new password" aria-label="Confirm new master password" autoComplete="new-password" />
          {confirm && next !== confirm && <div className="input-error">Passwords don't match.</div>}
          {err && <div className="input-error">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ok || busy}>
            {busy && <Spinner />} Change Password
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SnapshotsDialog({ onClose }: { onClose: () => void }) {
  const platform = usePlatform();
  const { actions } = useVault();
  const toast = useToast();
  const [snaps, setSnaps] = useState<SnapshotInfo[] | null>(null);
  const [confirm, setConfirm] = useState<SnapshotInfo | null>(null);
  useEffect(() => {
    void platform.service.listSnapshots().then(setSnaps);
  }, [platform]);
  if (confirm) {
    return (
      <ConfirmDialog
        title="Restore this version?"
        message={`Your vault will go back to how it was on ${formatDate(confirm.savedAt)}. The current version is kept as a snapshot, so you can undo this.`}
        confirmLabel="Restore"
        icon={<History />}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await platform.service.restoreSnapshot(confirm.id);
            await actions.refreshStatus();
            toast('Earlier version restored');
            onClose();
          } catch (e) {
            toast(errorMessage(e), { kind: 'error' });
            setConfirm(null);
          }
        }}
      />
    );
  }
  return (
    <Modal onClose={onClose} labelledBy="snap-title">
      <div className="modal-head">
        <div className="modal-icon">
          <History />
        </div>
        <h2 id="snap-title">Earlier versions</h2>
        <p>Each save keeps the previous encrypted version. Choose one to roll back to.</p>
      </div>
      <div className="modal-body scroll" style={{ maxHeight: 360 }}>
        {!snaps ? (
          <Spinner />
        ) : snaps.length === 0 ? (
          <p className="muted">No earlier versions yet.</p>
        ) : (
          <div className="group" style={{ boxShadow: 'none', background: 'var(--fill-2)' }}>
            {snaps.map((sn) => (
              <button key={sn.id} className="row clickable" style={{ width: '100%', textAlign: 'left' }} onClick={() => setConfirm(sn)}>
                <div className="row-main">
                  <div style={{ fontWeight: 500 }}>{formatDate(sn.savedAt)}</div>
                  <div className="faint" style={{ fontSize: 12 }}>
                    Revision {sn.revision} · {relativeTime(sn.savedAt)}
                  </div>
                </div>
                <span className="badge badge-blue">Restore</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
