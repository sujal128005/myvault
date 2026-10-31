import { AlertTriangle, ChevronLeft, MinusCircle, Plus, PlusCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { generatePassword } from '../../core/generator';
import { allTags, CATEGORIES, FIELD_PRESETS, newField, type Category, type CustomField, type VaultItem } from '../../core/model';
import { parseTotpInput } from '../../core/totp';
import { titleFromUrl, toUrl } from '../../core/url';
import { Avatar, ConfirmDialog, MenuButton, SecretInput, Spinner, StrengthMeter, TagInput } from '../components/primitives';
import { useVault, useVaultData } from '../state';
import { useToast } from '../toast';
import { errorMessage } from '../util';

interface Draft {
  title: string;
  category: Category;
  folderId: string | null;
  username: string;
  email: string;
  password: string;
  urls: string[];
  notes: string;
  totpInput: string;
  fields: CustomField[];
  tags: string[];
  favorite: boolean;
}

function toDraft(item: Partial<VaultItem> | null): Draft {
  return {
    title: item?.title ?? '',
    category: item?.category ?? 'website',
    folderId: item?.folderId ?? null,
    username: item?.username ?? '',
    email: item?.email ?? '',
    password: item?.password ?? '',
    urls: item?.urls?.length ? [...item.urls] : [''],
    notes: item?.notes ?? '',
    totpInput: item?.totp
      ? `otpauth://totp/${encodeURIComponent(item.totp.issuer || 'MyVault')}:${encodeURIComponent(item.totp.account || '')}?secret=${item.totp.secret}&issuer=${encodeURIComponent(item.totp.issuer)}&algorithm=${item.totp.algorithm}&digits=${item.totp.digits}&period=${item.totp.period}`
      : '',
    fields: item?.fields ? item.fields.map((f) => ({ ...f })) : [],
    tags: item?.tags ? [...item.tags] : [],
    favorite: item?.favorite ?? false,
  };
}

export function ItemEditor({ item, preset, onDone }: { item: VaultItem | null; preset?: Partial<VaultItem>; onDone: (saved: VaultItem | null) => void }) {
  const data = useVaultData();
  const { actions } = useVault();
  const toast = useToast();
  const initial = useMemo(() => toDraft(item ?? preset ?? null), [item, preset]);
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [discard, setDiscard] = useState(false);
  const [showTotp, setShowTotp] = useState(!!initial.totpInput);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const tags = useMemo(() => allTags(data.items), [data.items]);

  const totpParsed = d.totpInput.trim() ? parseTotpInput(d.totpInput) : null;
  const totpInvalid = !!d.totpInput.trim() && !totpParsed;
  const badUrls = d.urls.filter((u) => u.trim() && !toUrl(u));
  const derivedTitle = d.title.trim() || titleFromUrl(d.urls.find((u) => u.trim()) ?? '');
  const canSave = !!derivedTitle && !totpInvalid && badUrls.length === 0 && !busy;
  const isNote = d.category === 'note';

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setErr('');
    try {
      const saved = await actions.saveItem({
        ...(item ? { id: item.id } : {}),
        title: derivedTitle,
        category: d.category,
        folderId: d.folderId,
        username: d.username.trim(),
        email: d.email.trim(),
        password: d.password,
        urls: d.urls.map((u) => u.trim()).filter(Boolean),
        notes: d.notes,
        totp: totpParsed,
        fields: d.fields.filter((f) => f.label.trim() || f.value),
        tags: d.tags,
        favorite: d.favorite,
      });
      toast(item ? 'Changes saved' : 'Item added');
      onDone(saved);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  const cancel = () => (dirty ? setDiscard(true) : onDone(null));
  const updateField = (id: string, patch: Partial<CustomField>) => set('fields', d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  return (
    <>
      <div className="detail-toolbar">
        <div className="mobile-bar" style={{ padding: 0, minHeight: 0 }}>
          <button className="back" onClick={cancel}>
            <ChevronLeft /> Cancel
          </button>
        </div>
        <div className="spacer" />
        <button className="btn btn-sm btn-secondary" onClick={cancel}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={!canSave}>
          {busy && <Spinner />} {item ? 'Save' : 'Add Item'}
        </button>
      </div>
      <div className="detail-scroll scroll">
        <form
          className="detail"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault();
              void save();
            }
            if (e.key === 'Escape') cancel();
          }}
        >
          <div className="editor-hero">
            <Avatar item={{ id: item?.id ?? 'new', title: derivedTitle || '?', category: d.category }} size="lg" />
            <input
              value={d.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={derivedTitle || (isNote ? 'Note title' : 'Title')}
              aria-label="Title"
              autoFocus={!item}
              maxLength={200}
            />
          </div>

          <div className="editor-grid">
            <label className="field">
              <span className="field-label">Category</span>
              <select className="select" value={d.category} onChange={(e) => set('category', e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Folder</span>
              <select className="select" value={d.folderId ?? ''} onChange={(e) => set('folderId', e.target.value || null)}>
                <option value="">None</option>
                {data.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!isNote && (
            <section className="group-section">
              <h3 className="group-title">Sign-in</h3>
              <div className="group">
                <label className="row">
                  <div className="row-main">
                    <div className="row-label">Username</div>
                    <input className="row-input" value={d.username} onChange={(e) => set('username', e.target.value)} placeholder="Username" autoComplete="off" spellCheck={false} autoCapitalize="off" />
                  </div>
                </label>
                <label className="row">
                  <div className="row-main">
                    <div className="row-label">Email</div>
                    <input className="row-input" type="email" value={d.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" autoComplete="off" spellCheck={false} autoCapitalize="off" />
                  </div>
                </label>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <div className="row-main">
                    <div className="row-label">Password</div>
                    <SecretInput
                      className="row-input"
                      value={d.password}
                      onChange={(v) => set('password', v)}
                      onGenerate={() => set('password', generatePassword(data.settings.generator))}
                      placeholder="Password"
                      aria-label="Password"
                      autoComplete="new-password"
                    />
                  </div>
                  {d.password && (
                    <div style={{ width: '100%', marginTop: 8 }}>
                      <StrengthMeter password={d.password} inputs={[d.username, d.email, derivedTitle]} />
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {!isNote && (
            <section className="group-section">
              <h3 className="group-title">Websites</h3>
              <div className="group">
                {d.urls.map((u, idx) => (
                  <div className="row" key={idx}>
                    {d.urls.length > 1 && (
                      <button type="button" className="icon-btn sm" style={{ color: 'var(--red-fill)' }} aria-label="Remove website" onClick={() => set('urls', d.urls.filter((_, i) => i !== idx))}>
                        <MinusCircle />
                      </button>
                    )}
                    <input
                      className="row-input"
                      value={u}
                      onChange={(e) => set('urls', d.urls.map((x, i) => (i === idx ? e.target.value : x)))}
                      placeholder="example.com"
                      aria-label="Website"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="off"
                    />
                    {u.trim() && !toUrl(u) && <span className="input-error">Invalid</span>}
                  </div>
                ))}
                <button type="button" className="row clickable add-row" style={{ width: '100%' }} onClick={() => set('urls', [...d.urls, ''])}>
                  <PlusCircle /> Add Website
                </button>
              </div>
              <p className="group-footer">The extension only suggests this login on these sites (and their subdomains).</p>
            </section>
          )}

          {!isNote && (
            <section className="group-section">
              <h3 className="group-title">Two-Factor Code</h3>
              {!showTotp ? (
                <div className="group">
                  <button type="button" className="row clickable add-row" style={{ width: '100%' }} onClick={() => setShowTotp(true)}>
                    <PlusCircle /> Add Authenticator Secret
                  </button>
                </div>
              ) : (
                <>
                  <div className="callout warn" style={{ marginBottom: 10 }}>
                    <AlertTriangle />
                    <div>
                      <strong>Think twice.</strong> Storing a 2FA secret next to the password means anyone who unlocks your vault has <em>both</em> factors. For
                      critical accounts (primary email, banking) keep 2FA in a separate authenticator app or hardware key.
                    </div>
                  </div>
                  <div className="group">
                    <div className="row">
                      <div className="row-main">
                        <div className="row-label">Setup key or otpauth:// link</div>
                        <SecretInput className="row-input" value={d.totpInput} onChange={(v) => set('totpInput', v)} placeholder="JBSW Y3DP EHPK 3PXP…" aria-label="Authenticator secret" />
                      </div>
                      <button type="button" className="icon-btn sm" style={{ color: 'var(--red-fill)' }} aria-label="Remove authenticator secret" onClick={() => { set('totpInput', ''); setShowTotp(false); }}>
                        <MinusCircle />
                      </button>
                    </div>
                  </div>
                  {totpInvalid && <p className="group-footer" style={{ color: 'var(--red)' }}>That doesn't look like a valid Base32 setup key or otpauth:// link.</p>}
                  {totpParsed && <p className="group-footer">✓ {totpParsed.digits}-digit code every {totpParsed.period}s ({totpParsed.algorithm}){totpParsed.issuer ? ` · ${totpParsed.issuer}` : ''}</p>}
                </>
              )}
            </section>
          )}

          <section className="group-section">
            <h3 className="group-title">Additional Fields</h3>
            <div className="group">
              {d.fields.map((f) => (
                <div className="row" key={f.id} style={{ alignItems: 'flex-start' }}>
                  <button type="button" className="icon-btn sm" style={{ color: 'var(--red-fill)', marginTop: 4 }} aria-label="Remove field" onClick={() => set('fields', d.fields.filter((x) => x.id !== f.id))}>
                    <MinusCircle />
                  </button>
                  <div className="row-main" style={{ display: 'grid', gap: 4 }}>
                    <div className="editor-field-row">
                      <input
                        className="row-input label-input"
                        value={f.label}
                        onChange={(e) => updateField(f.id, { label: e.target.value })}
                        placeholder={f.preset === 'security-question' ? 'Security question' : 'Label'}
                        aria-label="Field label"
                      />
                      <select
                        className="select field-kind"
                        aria-label="Field type"
                        value={f.multiline ? (f.secret ? 'secret-multi' : 'multi') : f.secret ? 'secret' : 'text'}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateField(f.id, { secret: v.startsWith('secret'), multiline: v.endsWith('multi') });
                        }}
                      >
                        <option value="text">Text</option>
                        <option value="secret">Hidden</option>
                        <option value="multi">Multi-line</option>
                        <option value="secret-multi">Hidden multi-line</option>
                      </select>
                    </div>
                    {f.multiline ? (
                      <textarea
                        className="row-input mono"
                        value={f.value}
                        onChange={(e) => updateField(f.id, { value: e.target.value })}
                        placeholder={f.preset.includes('codes') ? 'One code per line' : 'Value'}
                        aria-label={`${f.label || 'Field'} value`}
                        spellCheck={false}
                        rows={4}
                      />
                    ) : f.secret ? (
                      <SecretInput className="row-input" value={f.value} onChange={(v) => updateField(f.id, { value: v })} placeholder={f.preset === 'security-question' ? 'Answer' : 'Value'} aria-label={`${f.label || 'Field'} value`} />
                    ) : (
                      <input className="row-input" value={f.value} onChange={(e) => updateField(f.id, { value: e.target.value })} placeholder="Value" aria-label={`${f.label || 'Field'} value`} spellCheck={false} />
                    )}
                  </div>
                </div>
              ))}
              <MenuButton
                button={(open) => (
                  <button type="button" className="row clickable add-row" style={{ width: '100%' }} onClick={open}>
                    <PlusCircle /> Add Field
                  </button>
                )}
              >
                {(close) =>
                  FIELD_PRESETS.map((p) => (
                    <button
                      type="button"
                      key={p.preset}
                      onClick={() => {
                        close();
                        set('fields', [...d.fields, newField(p.preset)]);
                      }}
                    >
                      <Plus /> {p.preset === 'security-question' ? 'Security Question' : p.label}
                    </button>
                  ))
                }
              </MenuButton>
            </div>
            <p className="group-footer">For API keys, secret keys, recovery and backup codes, security questions, PINs and anything else.</p>
          </section>

          <section className="group-section">
            <h3 className="group-title">Notes</h3>
            <div className="group">
              <div className="row">
                <textarea className="row-input" value={d.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Add notes" aria-label="Notes" rows={isNote ? 10 : 4} />
              </div>
            </div>
          </section>

          <section className="group-section">
            <h3 className="group-title">Tags</h3>
            <div className="group">
              <div className="row">
                <TagInput tags={d.tags} onChange={(t) => set('tags', t)} suggestions={tags} />
              </div>
            </div>
          </section>

          {err && (
            <div className="callout danger" role="alert">
              <AlertTriangle /> {err}
            </div>
          )}
          <button type="submit" hidden />
        </form>
      </div>
      {discard && (
        <ConfirmDialog
          title="Discard changes?"
          message="Your unsaved changes to this item will be lost."
          confirmLabel="Discard"
          danger
          onCancel={() => setDiscard(false)}
          onConfirm={() => onDone(null)}
        />
      )}
    </>
  );
}
