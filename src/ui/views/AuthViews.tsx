import { ArrowRight, Check, CloudOff, FileLock2, HardDrive, KeyRound, Lock, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parseBackupFile } from '../../core/backup';
import { MASTER_PASSWORD_MIN_LENGTH } from '../../core/vaultService';
import { ConfirmDialog, Modal, SecretInput, Spinner, StrengthMeter } from '../components/primitives';
import { useStrength } from '../hooks';
import { usePlatform } from '../platform';
import { useVault } from '../state';
import { BACKUP_ACCEPT, errorMessage, pickFile, readTextFile } from '../util';

export function AppIcon({ size }: { size?: 'sm' }) {
  return (
    <div className={`app-icon ${size ?? ''}`} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="10.5" width="16" height="10.5" rx="2.6" fill="currentColor" fillOpacity="0.18" />
        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        <circle cx="12" cy="15.4" r="1.25" fill="currentColor" />
        <path d="M12 16.6v1.6" />
      </svg>
    </div>
  );
}

export function SetupView() {
  const { actions } = useVault();
  const [step, setStep] = useState<0 | 1>(0);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [restore, setRestore] = useState(false);
  const strength = useStrength(pw);
  const longEnough = [...pw].length >= MASTER_PASSWORD_MIN_LENGTH;
  const strongEnough = (strength?.score ?? 0) >= 3;
  const matches = pw.length > 0 && pw === confirm;
  const valid = longEnough && strongEnough && matches && ack && pw.trim() === pw;

  if (step === 0) {
    return (
      <div className="auth">
        <div className="auth-card wide">
          <AppIcon />
          <h1 className="auth-title">Welcome to MyVault</h1>
          <p className="auth-sub">A private, encrypted home for your passwords — stored only on this device.</p>
          <div className="setup-points">
            <div className="setup-point">
              <div className="ico">
                <ShieldCheck />
              </div>
              <div>
                <h4>Encrypted before it's saved</h4>
                <p>AES-256-GCM with a key derived from your master password using Argon2id.</p>
              </div>
            </div>
            <div className="setup-point">
              <div className="ico">
                <CloudOff />
              </div>
              <div>
                <h4>Nothing leaves your device</h4>
                <p>No accounts, no servers, no tracking. The app is blocked from making network requests.</p>
              </div>
            </div>
            <div className="setup-point">
              <div className="ico">
                <HardDrive />
              </div>
              <div>
                <h4>You own your backups</h4>
                <p>Export encrypted backup files and keep them somewhere safe.</p>
              </div>
            </div>
          </div>
          <div className="auth-form" style={{ marginTop: 32 }}>
            <button className="btn btn-primary btn-lg btn-block" onClick={() => setStep(1)}>
              Create Your Vault
            </button>
            <button className="btn btn-plain btn-block" onClick={() => setRestore(true)}>
              <Upload /> Restore from a backup
            </button>
          </div>
          <div className="steps" aria-hidden>
            <span className="on" />
            <span />
          </div>
        </div>
        {restore && <RestoreBackupModal onClose={() => setRestore(false)} />}
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="auth-card wide">
        <div className="app-icon">
          <KeyRound />
        </div>
        <h1 className="auth-title">Create a master password</h1>
        <p className="auth-sub">This is the only password you'll need to remember. Use a long passphrase — four or more random words works well.</p>
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            setBusy(true);
            setErr('');
            try {
              await actions.create(pw);
            } catch (ex) {
              setErr(errorMessage(ex));
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span className="field-label">Master password</span>
            <SecretInput value={pw} onChange={setPw} autoComplete="new-password" placeholder={`At least ${MASTER_PASSWORD_MIN_LENGTH} characters`} aria-label="Master password" autoFocus />
          </label>
          <StrengthMeter password={pw} />
          <label className="field">
            <span className="field-label">Confirm password</span>
            <SecretInput value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Type it again" aria-label="Confirm master password" />
          </label>
          <ul style={{ margin: '2px 0 4px', padding: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 12.5 }}>
            <Req ok={longEnough}>At least {MASTER_PASSWORD_MIN_LENGTH} characters</Req>
            <Req ok={strongEnough}>Rated "Strong" or better</Req>
            <Req ok={matches}>Passwords match</Req>
          </ul>
          <label className="check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              I understand that <strong>MyVault cannot recover my master password</strong>. If I forget it, my vault cannot be opened — not even from a backup.
            </span>
          </label>
          {err && <div className="input-error">{err}</div>}
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={!valid || busy} style={{ marginTop: 6 }}>
            {busy ? (
              <>
                <Spinner /> Securing your vault…
              </>
            ) : (
              'Create Vault'
            )}
          </button>
          <button type="button" className="btn btn-plain btn-block" onClick={() => setStep(0)} disabled={busy}>
            Back
          </button>
        </form>
        <div className="steps" aria-hidden>
          <span />
          <span className="on" />
        </div>
      </div>
    </div>
  );
}

function Req({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 8, color: ok ? 'var(--green)' : 'var(--text-3)', transition: 'color .2s' }}>
      <Check size={14} strokeWidth={ok ? 3 : 2} /> {children}
    </li>
  );
}

export function LockView({ compact }: { compact?: boolean }) {
  const { actions } = useVault();
  const platform = usePlatform();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);
  const [restore, setRestore] = useState(false);
  const [reset, setReset] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="auth">
      <div className="auth-card">
        <AppIcon />
        <h1 className="auth-title">MyVault</h1>
        <p className="auth-sub">Enter your master password to unlock.</p>
        <form
          className={`auth-form ${shake ? 'shake' : ''}`}
          onAnimationEnd={() => setShake(false)}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!pw || busy) return;
            setBusy(true);
            setErr('');
            try {
              await actions.unlock(pw);
            } catch (ex) {
              setErr(errorMessage(ex));
              setShake(true);
              setBusy(false);
              setPw('');
              inputRef.current?.focus();
            }
          }}
        >
          <div className="unlock-field">
            <input
              ref={inputRef}
              className="input"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Master password"
              aria-label="Master password"
              autoComplete="current-password"
              disabled={busy}
            />
            <button className="unlock-go" type="submit" disabled={!pw || busy} aria-label="Unlock">
              {busy ? <Spinner /> : <ArrowRight />}
            </button>
          </div>
          <div className="input-error" style={{ textAlign: 'center', minHeight: 18 }} role="alert">
            {err}
          </div>
        </form>
        {!compact && (
          <div className="auth-links">
            <button type="button" onClick={() => setRestore(true)}>
              Restore from backup
            </button>
            <button type="button" onClick={() => setReset(true)}>
              Forgot password?
            </button>
          </div>
        )}
        {compact && platform.openFullVault && (
          <div className="auth-links">
            <button type="button" onClick={platform.openFullVault}>
              Open full vault
            </button>
          </div>
        )}
        <p className="auth-note">
          <Lock /> End-to-end encrypted · stored only on this device
        </p>
      </div>
      {restore && <RestoreBackupModal onClose={() => setRestore(false)} replacing />}
      {reset && (
        <ConfirmDialog
          danger
          title="Forgot your master password?"
          message={
            <>
              Your master password is never stored, so it can't be recovered or reset. If you have a backup and remember <em>its</em> password, use
              “Restore from backup”. Otherwise you can erase this vault and start over — <strong>all saved items will be permanently lost.</strong>
            </>
          }
          confirmLabel="Erase Vault"
          requireText="ERASE"
          onCancel={() => setReset(false)}
          onConfirm={async () => {
            await platform.service.destroy();
            await actions.refreshStatus();
          }}
        />
      )}
    </div>
  );
}

export function RestoreBackupModal({ onClose, replacing }: { onClose: () => void; replacing?: boolean }) {
  const { actions } = useVault();
  const platform = usePlatform();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal onClose={onClose} labelledBy="restore-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          setBusy(true);
          setErr('');
          try {
            const rec = parseBackupFile(file.text);
            await platform.service.restoreFromBackup(rec, pw);
            await actions.refreshStatus();
            onClose();
          } catch (ex) {
            setErr(errorMessage(ex));
            setBusy(false);
          }
        }}
      >
        <div className="modal-head">
          <div className="modal-icon">
            <FileLock2 />
          </div>
          <h2 id="restore-title">Restore from backup</h2>
          <p>
            Choose a <span className="mono">.myvault</span> backup file and enter the master password that was in use when it was exported.
            {replacing && ' This replaces the vault currently stored in this browser (the old version is kept as a snapshot).'}
          </p>
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
          <SecretInput value={pw} onChange={setPw} placeholder="Backup's master password" aria-label="Backup master password" autoComplete="off" />
          {err && <div className="input-error">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!file || !pw || busy}>
            {busy && <Spinner />} Restore
          </button>
        </div>
      </form>
    </Modal>
  );
}
