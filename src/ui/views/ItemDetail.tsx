import {
  ChevronLeft,
  Copy,
  CopyPlus,
  ExternalLink,
  Eye,
  EyeOff,
  FolderInput,
  History,
  KeyRound,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { reusedIds, isOld } from '../../core/health';
import { CATEGORIES, newItem, type VaultItem } from '../../core/model';
import { displayHost, safeHref } from '../../core/url';
import { Avatar, ConfirmDialog, EmptyState, MenuButton, StrengthMeter, TotpView } from '../components/primitives';
import { useCopy } from '../hooks';
import { useVault, useVaultData } from '../state';
import { useToast } from '../toast';
import { formatDate, relativeTime } from '../util';

export function ItemDetail({ item, onBack, onEdit, onNew }: { item: VaultItem | null; onBack: () => void; onEdit: () => void; onNew: () => void }) {
  const data = useVaultData();
  const { actions } = useVault();
  const copy = useCopy();
  const toast = useToast();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<'trash' | 'purge' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const reused = useMemo(() => reusedIds(data.items), [data.items]);

  if (!item) {
    return (
      <EmptyState
        icon={<KeyRound />}
        title="No Item Selected"
        text="Choose an item from the list, or create a new one."
        action={
          <button className="btn btn-tinted" onClick={onNew}>
            New Item
          </button>
        }
      />
    );
  }

  const isRevealed = (k: string) => revealed.has(k);
  const toggle = (k: string) =>
    setRevealed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const folder = data.folders.find((f) => f.id === item.folderId);
  const trashed = !!item.deletedAt;
  const category = CATEGORIES.find((c) => c.id === item.category)?.label;
  const reusedCount = item.password ? data.items.filter((i) => !i.deletedAt && i.password === item.password).length : 0;

  const hasLogin = item.username || item.email || item.password || item.totp;

  return (
    <>
      <div className="detail-toolbar">
        <div className="mobile-bar" style={{ padding: 0, minHeight: 0 }}>
          <button className="back" onClick={onBack}>
            <ChevronLeft /> Back
          </button>
        </div>
        <div className="spacer" />
        {trashed ? (
          <>
            <button className="btn btn-sm btn-secondary" onClick={async () => { await actions.restoreItem(item.id); toast('Item restored'); }}>
              <RotateCcw /> Restore
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => setConfirm('purge')}>
              Delete Permanently
            </button>
          </>
        ) : (
          <>
            <button className={`icon-btn star ${item.favorite ? 'active' : ''}`} onClick={() => actions.toggleFavorite(item.id)} aria-label={item.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={item.favorite} title="Favorite">
              <Star fill={item.favorite ? 'currentColor' : 'none'} />
            </button>
            <MenuButton
              align="right"
              button={(open) => (
                <button className="icon-btn" onClick={open} aria-label="More actions" title="More">
                  <MoreHorizontal />
                </button>
              )}
            >
              {(close) => (
                <>
                  <button
                    onClick={async () => {
                      close();
                      const { id: _omit, createdAt: _c, updatedAt: _u, ...rest } = item;
                      void _omit;
                      void _c;
                      void _u;
                      await actions.saveItem(newItem({ ...rest, title: `${item.title} copy`, passwordHistory: [] }));
                      toast('Item duplicated');
                    }}
                  >
                    <CopyPlus /> Duplicate
                  </button>
                  {data.folders.length > 0 && <hr />}
                  {data.folders.map((f) => (
                    <button
                      key={f.id}
                      onClick={async () => {
                        close();
                        await actions.saveItem({ id: item.id, folderId: f.id === item.folderId ? null : f.id });
                        toast(f.id === item.folderId ? `Removed from ${f.name}` : `Moved to ${f.name}`);
                      }}
                    >
                      <FolderInput /> {f.id === item.folderId ? `Remove from “${f.name}”` : `Move to “${f.name}”`}
                    </button>
                  ))}
                  <hr />
                  <button onClick={() => { close(); setConfirm('trash'); }}>
                    <Trash2 /> Delete
                  </button>
                </>
              )}
            </MenuButton>
            <button className="btn btn-sm btn-secondary" onClick={onEdit}>
              <Pencil /> Edit
            </button>
          </>
        )}
      </div>
      <div className="detail-scroll scroll">
        <article className="detail">
          <header className="detail-hero">
            <Avatar item={item} size="lg" />
            <div style={{ minWidth: 0 }}>
              <h2>{item.title}</h2>
              <div className="hero-sub">
                <span>{[category, folder?.name, item.urls[0] ? displayHost(item.urls[0]) : ''].filter(Boolean).join('  ·  ')}</span>
              </div>
            </div>
          </header>

          {(reusedCount > 1 || isOld(item)) && !trashed && (
            <div className="callout warn" style={{ marginBottom: 20 }}>
              <ShieldAlert />
              <div>
                {reusedCount > 1 && (
                  <div>
                    <strong>Reused password.</strong> This password is used on {reusedCount - 1} other item{reusedCount > 2 ? 's' : ''}. If one site is breached, all of them are at risk.
                  </div>
                )}
                {isOld(item) && (
                  <div>
                    <strong>Old password.</strong> Last changed {relativeTime(item.passwordUpdatedAt ?? item.createdAt)}. Consider updating it.
                  </div>
                )}
              </div>
            </div>
          )}

          {hasLogin && (
            <section className="group-section">
              <div className="group">
                {item.username && <PlainRow onCopy={(v, l) => copy(v, l, { secret: false })} label="Username" value={item.username} copyLabel="Username" />}
                {item.email && item.email !== item.username && <PlainRow onCopy={(v, l) => copy(v, l, { secret: false })} label="Email" value={item.email} copyLabel="Email" />}
                {item.password && (
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <div className="row-main">
                      <div className="row-label">Password</div>
                      {isRevealed('pw') ? (
                        <div className="row-value secret">{item.password}</div>
                      ) : (
                        <div className="row-value dots">{'•'.repeat(Math.min(16, Math.max(8, item.password.length)))}</div>
                      )}
                    </div>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => toggle('pw')} aria-label={isRevealed('pw') ? 'Hide password' : 'Show password'} title={isRevealed('pw') ? 'Hide' : 'Show'}>
                        {isRevealed('pw') ? <EyeOff /> : <Eye />}
                      </button>
                      <button className="icon-btn" onClick={() => copy(item.password, 'Password', { itemId: item.id })} aria-label="Copy password" title="Copy">
                        <Copy />
                      </button>
                    </div>
                    <div style={{ width: '100%', marginTop: 8 }}>
                      <StrengthMeter password={item.password} inputs={[item.username, item.email, item.title]} />
                    </div>
                  </div>
                )}
                {item.totp && (
                  <div className="row">
                    <div className="row-main">
                      <div className="row-label">One-time code{item.totp.issuer ? ` · ${item.totp.issuer}` : ''}</div>
                      <TotpView config={item.totp} onCopy={(code) => copy(code, 'Code', { itemId: item.id })} />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {item.urls.length > 0 && (
            <section className="group-section">
              <h3 className="group-title">{item.urls.length > 1 ? 'Websites' : 'Website'}</h3>
              <div className="group">
                {item.urls.map((u, idx) => {
                  const href = safeHref(u);
                  return (
                    <div className="row" key={`${u}-${idx}`}>
                      <div className="row-main">
                        <div className="row-value" style={{ overflowWrap: 'anywhere' }}>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              {u}
                            </a>
                          ) : (
                            u
                          )}
                        </div>
                      </div>
                      <div className="row-actions">
                        {href && (
                          <a className="icon-btn" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${u}`} title="Open">
                            <ExternalLink />
                          </a>
                        )}
                        <button className="icon-btn" onClick={() => copy(u, 'URL', { secret: false })} aria-label={`Copy ${u}`} title="Copy">
                          <Copy />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {item.fields.length > 0 && (
            <section className="group-section">
              <h3 className="group-title">Additional Fields</h3>
              <div className="group">
                {item.fields.map((f) =>
                  f.secret ? (
                    <SecretRow key={f.id} k={f.id} revealed={isRevealed(f.id)} onToggle={toggle} onCopy={(v, l) => copy(v, l, { itemId: item.id })} label={f.label || 'Hidden field'} value={f.value} copyLabel={f.label || 'Value'} multiline={f.multiline} />
                  ) : (
                    <PlainRow onCopy={(v, l) => copy(v, l, { secret: false })} key={f.id} label={f.label || 'Field'} value={f.value} copyLabel={f.label || 'Value'} />
                  ),
                )}
              </div>
            </section>
          )}

          {item.notes && (
            <section className="group-section">
              <h3 className="group-title">Notes</h3>
              <div className="group">
                <div className="row">
                  <div className="row-main">
                    <div className="row-value">{item.notes}</div>
                  </div>
                  <div className="row-actions">
                    <button className="icon-btn" onClick={() => copy(item.notes, 'Notes', { secret: false })} aria-label="Copy notes" title="Copy">
                      <Copy />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {item.tags.length > 0 && (
            <section className="group-section">
              <h3 className="group-title">Tags</h3>
              <div className="tags-row" style={{ paddingLeft: 4 }}>
                {item.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}

          {item.passwordHistory.length > 0 && (
            <section className="group-section">
              <div className="group">
                <button className="row clickable" style={{ width: '100%' }} onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
                  <History size={17} className="muted" />
                  <div className="row-main" style={{ textAlign: 'left' }}>
                    Password History
                  </div>
                  <span className="badge badge-gray">{item.passwordHistory.length}</span>
                </button>
                {showHistory &&
                  item.passwordHistory.map((h, idx) => (
                    <SecretRow key={idx} k={`h${idx}`} revealed={isRevealed(`h${idx}`)} onToggle={toggle} onCopy={(v, l) => copy(v, l, { itemId: item.id })} label={`Used until ${formatDate(h.changedAt)}`} value={h.password} copyLabel="Old password" />
                  ))}
              </div>
            </section>
          )}

          <footer className="detail-meta">
            <div>Created {formatDate(item.createdAt)}</div>
            <div>Modified {formatDate(item.updatedAt)}</div>
            {item.passwordUpdatedAt && <div>Password changed {relativeTime(item.passwordUpdatedAt)}</div>}
            {reused.has(item.id) && <div style={{ color: 'var(--orange)' }}>Password is reused</div>}
          </footer>
        </article>
      </div>
      {confirm === 'trash' && (
        <ConfirmDialog
          danger
          icon={<Trash2 />}
          title={`Delete “${item.title}”?`}
          message="The item will move to Recently Deleted, where you can restore it for 30 days."
          confirmLabel="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await actions.trashItem(item.id);
            setConfirm(null);
            toast('Moved to Recently Deleted');
          }}
        />
      )}
      {confirm === 'purge' && (
        <ConfirmDialog
          danger
          icon={<Trash2 />}
          title="Delete permanently?"
          message={`“${item.title}” will be erased from your vault. This can't be undone (except by restoring a backup).`}
          confirmLabel="Delete Permanently"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await actions.purgeItem(item.id);
            setConfirm(null);
            toast('Item deleted');
          }}
        />
      )}
    </>
  );
}

function SecretRow({
  k,
  label,
  value,
  copyLabel,
  multiline,
  revealed,
  onToggle,
  onCopy,
}: {
  k: string;
  label: string;
  value: string;
  copyLabel: string;
  multiline?: boolean;
  revealed: boolean;
  onToggle: (k: string) => void;
  onCopy: (value: string, label: string) => void;
}) {
  return (
    <div className="row">
      <div className="row-main">
        <div className="row-label">{label}</div>
        {revealed ? (
          <div className="row-value secret">{value}</div>
        ) : (
          <div className="row-value dots" aria-label="Hidden">
            {multiline ? '•••••••• •••• ••••••' : '•'.repeat(Math.min(14, Math.max(8, value.length)))}
          </div>
        )}
      </div>
      <div className="row-actions">
        <button className="icon-btn" onClick={() => onToggle(k)} aria-label={revealed ? `Hide ${label}` : `Show ${label}`} title={revealed ? 'Hide' : 'Show'}>
          {revealed ? <EyeOff /> : <Eye />}
        </button>
        <button className="icon-btn" onClick={() => onCopy(value, copyLabel)} aria-label={`Copy ${label}`} title="Copy">
          <Copy />
        </button>
      </div>
    </div>
  );
}

function PlainRow({ label, value, copyLabel, onCopy }: { label: string; value: string; copyLabel: string; onCopy: (value: string, label: string) => void }) {
  return (
    <div className="row">
      <div className="row-main">
        <div className="row-label">{label}</div>
        <div className="row-value">{value}</div>
      </div>
      <div className="row-actions">
        <button className="icon-btn" onClick={() => onCopy(value, copyLabel)} aria-label={`Copy ${label}`} title="Copy">
          <Copy />
        </button>
      </div>
    </div>
  );
}
