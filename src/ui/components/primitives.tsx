import { AlertTriangle, Copy, Eye, EyeOff, Globe, KeyRound, StickyNote, Wand2, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { TotpConfig, VaultItem } from '../../core/model';
import { formatTotp, totp } from '../../core/totp';
import { useStrength } from '../hooks';
import { avatarStyle, initial } from '../util';

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ item, size = 'md' }: { item: Pick<VaultItem, 'title' | 'category' | 'id'>; size?: 'sm' | 'md' | 'lg' }) {
  const cls = `avatar ${size === 'md' ? '' : size}`;
  const style = avatarStyle(item.title || item.id);
  if (item.category === 'note') {
    return (
      <span className={cls} style={avatarStyle('note')} aria-hidden>
        <StickyNote />
      </span>
    );
  }
  return (
    <span className={cls} style={style} aria-hidden>
      {initial(item.title)}
    </span>
  );
}

export function SiteAvatar({ host, size = 'sm' }: { host: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`avatar ${size === 'sm' ? 'sm' : ''}`} style={avatarStyle(host)} aria-hidden>
      {host ? initial(host.replace(/^www\./, '')) : <Globe />}
    </span>
  );
}

export function StrengthMeter({ password, inputs, compact }: { password: string; inputs?: string[]; compact?: boolean }) {
  const s = useStrength(password, inputs);
  if (!password) return null;
  return (
    <div className="strength" data-score={s?.score ?? 0} title={s?.warning || undefined}>
      <div className="strength-bars" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <span className="strength-label">{s ? s.label : '…'}</span>
      {!compact && s && <span className="faint">{s.score >= 3 ? `~${s.crackTime} to crack` : s.warning || s.suggestions[0] || ''}</span>}
    </div>
  );
}

/** Password/secret input with reveal toggle and optional generator button. */
export function SecretInput({
  value,
  onChange,
  onGenerate,
  className = 'input',
  ...rest
}: { value: string; onChange: (v: string) => void; onGenerate?: () => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group" style={{ flex: 1 }}>
      <input
        {...rest}
        className={`${className} mono`}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={rest.autoComplete ?? 'off'}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <div className="input-actions">
        {onGenerate && (
          <button type="button" className="icon-btn sm" onClick={onGenerate} title="Generate password" aria-label="Generate password">
            <Wand2 />
          </button>
        )}
        <button type="button" className="icon-btn sm" onClick={() => setShow((s) => !s)} title={show ? 'Hide' : 'Show'} aria-label={show ? 'Hide' : 'Show'}>
          {show ? <EyeOff /> : <Eye />}
        </button>
      </div>
    </div>
  );
}

export function Modal({
  onClose,
  children,
  wide,
  labelledBy,
}: {
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button.btn-primary, button');
    first?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter((el) => !el.hasAttribute('disabled'));
        if (!els.length) return;
        const firstEl = els[0]!;
        const lastEl = els[els.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  icon,
  onConfirm,
  onCancel,
  requireText,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  icon?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  requireText?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const ok = !requireText || typed === requireText;
  return (
    <Modal onClose={onCancel} labelledBy={id}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-head">
          <div className={`modal-icon ${danger ? 'danger' : ''}`}>{icon ?? <AlertTriangle />}</div>
          <h2 id={id}>{title}</h2>
          <p>{message}</p>
        </div>
        {requireText && (
          <div className="modal-body">
            <label className="field">
              <span className="field-label">
                Type <strong>{requireText}</strong> to confirm
              </span>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </label>
          </div>
        )}
        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={!ok || busy}>
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Asks for the master password before a sensitive action. */
export function PasswordPrompt({
  title,
  message,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal onClose={onCancel} labelledBy={id}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            await onSubmit(pw);
          } catch (ex) {
            setErr(ex instanceof Error && ex.name === 'DecryptionError' ? 'Incorrect password.' : ex instanceof Error ? ex.message : 'Failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-head">
          <div className="modal-icon">
            <KeyRound />
          </div>
          <h2 id={id}>{title}</h2>
          <p>{message}</p>
        </div>
        <div className="modal-body">
          <SecretInput value={pw} onChange={setPw} placeholder="Master password" aria-label="Master password" autoComplete="current-password" />
          {err && <div className="input-error">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!pw || busy}>
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TotpView({ config, onCopy }: { config: TotpConfig; onCopy: (code: string) => void }) {
  const [state, setState] = useState<{ code: string; remaining: number } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      totp(config)
        .then((r) => alive && setState(r))
        .catch(() => alive && setError(true));
    void tick();
    const t = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [config]);
  if (error) return <span className="input-error">Invalid authenticator secret</span>;
  if (!state) return <Spinner />;
  const r = 10;
  const c = 2 * Math.PI * r;
  const frac = state.remaining / config.period;
  return (
    <div className="totp">
      <span className="totp-code">{formatTotp(state.code)}</span>
      <svg className={`totp-ring ${state.remaining <= 5 ? 'low' : ''}`} viewBox="0 0 26 26" aria-label={`${state.remaining} seconds left`}>
        <circle className="track" cx="13" cy="13" r={r} />
        <circle className="prog" cx="13" cy="13" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span className="faint" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
        {state.remaining}s
      </span>
      <div style={{ flex: 1 }} />
      <button type="button" className="icon-btn" onClick={() => onCopy(state.code)} title="Copy code" aria-label="Copy one-time code">
        <Copy />
      </button>
    </div>
  );
}

export function TagInput({ tags, onChange, suggestions = [] }: { tags: string[]; onChange: (t: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const listId = useId();
  const add = useCallback(
    (raw: string) => {
      const t = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (t && !tags.includes(t)) onChange([...tags, t]);
      setText('');
    },
    [tags, onChange],
  );
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };
  return (
    <div className="tag-input">
      {tags.map((t) => (
        <span className="tag" key={t}>
          {t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="row-input"
        value={text}
        list={listId}
        placeholder={tags.length ? '' : 'Add tags…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => text && add(text)}
        aria-label="Add tag"
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !tags.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div>
        <div className="empty-icon">{icon}</div>
        <h3>{title}</h3>
        {text && <p>{text}</p>}
        {action}
      </div>
    </div>
  );
}

/** Small popover menu anchored to a button. */
export function MenuButton({ button, children, align = 'left' }: { button: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {button(() => setOpen((o) => !o))}
      {open && (
        <div className="menu" role="menu" style={align === 'right' ? { right: 0, top: '110%', transformOrigin: 'top right' } : { left: 0, top: '110%' }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
