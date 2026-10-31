import { Copy, Download, KeyRound, Lock, Maximize2, MoreHorizontal, Plus, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { generatePassword } from '../../core/generator';
import type { VaultItem } from '../../core/model';
import { matchesQuery, sortItems } from '../../core/search';
import { fillAllowed, findMatches, isLocalHost, siteInfo, titleFromUrl, type ItemMatch } from '../../core/url';
import { Avatar, EmptyState, SecretInput, Segmented, SiteAvatar, Spinner, TotpView } from '../../ui/components/primitives';
import { useCopy } from '../../ui/hooks';
import { usePlatform } from '../../ui/platform';
import { useVault, useVaultData } from '../../ui/state';
import { useToast } from '../../ui/toast';
import { errorMessage, itemSubtitle } from '../../ui/util';
import { AppIcon, LockView } from '../../ui/views/AuthViews';
import { GeneratorPanel } from '../../ui/views/GeneratorView';
import { captureLoginFromPage, fillLoginInPage, fillNewPasswordInPage, type FillResult } from '../pageScripts';

interface ActiveTab {
  id: number;
  url: string;
}

function useActiveTab(): ActiveTab | null | undefined {
  const [tab, setTab] = useState<ActiveTab | null | undefined>(undefined);
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      setTab(t?.id !== undefined && t.url ? { id: t.id, url: t.url } : null);
    });
  }, []);
  return tab;
}

/** Inject into the tab; returns the first successful frame result. */
async function runInTab<A extends unknown[]>(tabId: number, func: (...args: A) => FillResult, args: A): Promise<FillResult> {
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
  const ok = results.map((r) => r.result as FillResult | undefined).find((r) => r?.ok);
  return ok ?? (results[0]?.result as FillResult | undefined) ?? { ok: false, reason: 'no-fields' };
}

export function PopupRoot() {
  const { status, data } = useVault();
  const platform = usePlatform();
  if (status === 'loading')
    return (
      <div className="popup">
        <div className="auth">
          <Spinner />
        </div>
      </div>
    );
  if (status === 'none')
    return (
      <div className="popup">
        <div className="auth">
          <div className="auth-card">
            <AppIcon />
            <h1 className="auth-title">Welcome to MyVault</h1>
            <p className="auth-sub">Create your encrypted vault to start saving passwords.</p>
            <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 24 }} onClick={platform.openFullVault}>
              Set Up MyVault
            </button>
          </div>
        </div>
      </div>
    );
  if (status === 'locked' || !data)
    return (
      <div className="popup">
        <LockView compact />
      </div>
    );
  return <PopupMain />;
}

type Tab = 'site' | 'search' | 'generate' | 'add';

function PopupMain() {
  const { actions } = useVault();
  const platform = usePlatform();
  const tab = useActiveTab();
  const [view, setView] = useState<Tab>('site');
  const [addPreset, setAddPreset] = useState<Partial<VaultItem> | null>(null);
  const site = tab ? siteInfo(tab.url) : null;
  const fillable = !!tab && !!site && /^https?:$/.test(site.protocol);

  return (
    <div className="popup">
      <header className="popup-head">
        <AppIcon size="sm" />
        <span className="brand">MyVault</span>
        <button className="icon-btn" title="Open full vault" aria-label="Open full vault" onClick={platform.openFullVault}>
          <Maximize2 />
        </button>
        <button className="icon-btn" title="Lock" aria-label="Lock vault" onClick={() => void actions.lock()}>
          <Lock />
        </button>
      </header>
      <div className="popup-tabs">
        <Segmented<Tab>
          label="View"
          value={view}
          onChange={(v) => {
            if (v === 'add') setAddPreset(null);
            setView(v);
          }}
          options={[
            { value: 'site', label: 'This Site' },
            { value: 'search', label: 'Search' },
            { value: 'generate', label: 'Generate' },
            { value: 'add', label: 'Add' },
          ]}
        />
      </div>
      <div className="popup-body scroll">
        {tab === undefined ? (
          <Spinner />
        ) : view === 'site' ? (
          <SiteView tab={tab} fillable={fillable} onAdd={(preset) => { setAddPreset(preset); setView('add'); }} />
        ) : view === 'search' ? (
          <SearchView tab={tab} fillable={fillable} />
        ) : view === 'generate' ? (
          <GenerateView tab={tab} fillable={fillable} />
        ) : (
          <AddView key={JSON.stringify(addPreset)} tab={tab} fillable={fillable} preset={addPreset} onSaved={() => setView('site')} />
        )}
      </div>
    </div>
  );
}

function useFill(tab: ActiveTab | null) {
  const { actions } = useVault();
  const toast = useToast();
  return useCallback(
    async (item: VaultItem) => {
      if (!tab) return;
      const allowed = fillAllowed(item.urls, tab.url);
      if (!allowed.ok) {
        toast(allowed.reason ?? 'Cannot fill here', { kind: 'error', ms: 4000 });
        return;
      }
      const origin = new URL(tab.url).origin;
      try {
        const r = await runInTab(tab.id, fillLoginInPage, [origin, item.username || item.email, item.password]);
        if (r.ok) {
          void actions.markUsed(item.id).catch(() => undefined);
          window.close();
        } else {
          toast(r.reason === 'origin-mismatch' ? 'The page changed. Try again.' : 'No login fields found on this page', { kind: 'error' });
        }
      } catch (e) {
        toast(`Can't fill this page: ${errorMessage(e)}`, { kind: 'error' });
      }
    },
    [tab, actions, toast],
  );
}

function SiteView({ tab, fillable, onAdd }: { tab: ActiveTab | null; fillable: boolean; onAdd: (preset: Partial<VaultItem>) => void }) {
  const data = useVaultData();
  const fill = useFill(tab);
  const site = tab ? siteInfo(tab.url) : null;
  const matches = useMemo(() => (tab && fillable ? findMatches(data.items, tab.url) : []), [data.items, tab, fillable]);

  if (!tab || !site || !fillable) {
    return <EmptyState icon={<ShieldCheck />} title="Nothing to fill here" text="Open a website with a login form, then click MyVault again." />;
  }
  const secure = site.protocol === 'https:';
  return (
    <>
      <div className="site-chip">
        <SiteAvatar host={site.hostname} />
        <span className="host">{site.hostname.replace(/^www\./, '')}</span>
        {isLocalHost(site.hostname) ? (
          <span className="badge badge-gray">Local</span>
        ) : secure ? (
          <span className="badge badge-green">
            <ShieldCheck /> Secure
          </span>
        ) : (
          <span className="badge badge-orange">
            <ShieldAlert /> Not secure
          </span>
        )}
      </div>
      {matches.length === 0 ? (
        <div className="empty" style={{ height: 'auto', padding: '28px 12px' }}>
          <div>
            <div className="empty-icon">
              <KeyRound />
            </div>
            <h3>No saved logins</h3>
            <p>Nothing saved for {site.domain ?? site.hostname} yet.</p>
            <button className="btn btn-primary" onClick={() => onAdd({ title: titleFromUrl(tab.url), urls: [new URL(tab.url).origin] })}>
              <Plus /> Save a Login
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="pop-section-title">
            {matches.length} saved login{matches.length === 1 ? '' : 's'}
          </div>
          {matches.map((m) => (
            <PopItem key={m.item.id} match={m} onFill={() => fill(m.item)} canFill />
          ))}
        </>
      )}
    </>
  );
}

function PopItem({ match, onFill, canFill }: { match: ItemMatch | { item: VaultItem; strength?: undefined }; onFill: () => void; canFill: boolean }) {
  const { item } = match;
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  return (
    <div className={`pop-item ${open ? 'expanded' : ''}`}>
      <Avatar item={item} size="sm" />
      <div className="item-text">
        <div className="item-title">{item.title}</div>
        <div className="item-sub">{itemSubtitle(item) || '—'}</div>
      </div>
      <div className="actions">
        <button className="icon-btn sm" aria-label={`More actions for ${item.title}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <MoreHorizontal />
        </button>
        {canFill ? (
          <button className="btn btn-primary" onClick={onFill} disabled={!item.password && !item.username && !item.email}>
            Fill
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={() => copy(item.password, 'Password', { itemId: item.id })} disabled={!item.password}>
            <Copy /> Password
          </button>
        )}
      </div>
      {open && (
        <div className="pop-extra">
          {(item.username || item.email) && (
            <button className="btn btn-sm btn-secondary" onClick={() => copy(item.username || item.email, 'Username', { secret: false })}>
              <Copy /> Username
            </button>
          )}
          {item.password && (
            <button className="btn btn-sm btn-secondary" onClick={() => copy(item.password, 'Password', { itemId: item.id })}>
              <Copy /> Password
            </button>
          )}
          {item.totp && (
            <div style={{ width: '100%' }}>
              <TotpView config={item.totp} onCopy={(c) => copy(c, 'Code', { itemId: item.id })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchView({ tab, fillable }: { tab: ActiveTab | null; fillable: boolean }) {
  const data = useVaultData();
  const fill = useFill(tab);
  const [q, setQ] = useState('');
  const results = useMemo(
    () =>
      sortItems(
        data.items.filter((i) => !i.deletedAt && matchesQuery(i, q)),
        'name',
      ).slice(0, 50),
    [data.items, q],
  );
  const matchingIds = useMemo(() => new Set(tab && fillable ? findMatches(data.items, tab.url).map((m) => m.item.id) : []), [data.items, tab, fillable]);
  return (
    <>
      <div className="search" style={{ marginBottom: 10 }}>
        <Search />
        <input className="input" type="search" placeholder="Search vault" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search vault" />
      </div>
      {results.length === 0 ? (
        <p className="faint" style={{ textAlign: 'center', marginTop: 30 }}>
          No results
        </p>
      ) : (
        results.map((item) => <PopItem key={item.id} match={{ item }} canFill={matchingIds.has(item.id)} onFill={() => fill(item)} />)
      )}
      <p className="group-footer" style={{ marginTop: 8 }}>
        For your safety, “Fill” only appears for logins saved for the current site.
      </p>
    </>
  );
}

function GenerateView({ tab, fillable }: { tab: ActiveTab | null; fillable: boolean }) {
  const toast = useToast();
  return (
    <div className="page">
      <GeneratorPanel
        useLabel="Fill"
        onUse={
          fillable && tab
            ? async (pw) => {
                const allowed = fillAllowed([], tab.url);
                if (!allowed.ok) return toast(allowed.reason ?? 'Cannot fill here', { kind: 'error' });
                try {
                  const r = await runInTab(tab.id, fillNewPasswordInPage, [new URL(tab.url).origin, pw]);
                  toast(r.ok ? 'Password filled — remember to save the login' : 'No password fields found', { kind: r.ok ? 'success' : 'error', ms: 3500 });
                } catch (e) {
                  toast(errorMessage(e), { kind: 'error' });
                }
              }
            : undefined
        }
      />
    </div>
  );
}

function AddView({ tab, fillable, preset, onSaved }: { tab: ActiveTab | null; fillable: boolean; preset: Partial<VaultItem> | null; onSaved: () => void }) {
  const data = useVaultData();
  const { actions } = useVault();
  const toast = useToast();
  const origin = tab && fillable ? new URL(tab.url).origin : '';
  const [title, setTitle] = useState(preset?.title ?? (tab && fillable ? titleFromUrl(tab.url) : ''));
  const [url, setUrl] = useState(preset?.urls?.[0] ?? origin);
  const [username, setUsername] = useState(preset?.username ?? '');
  const [password, setPassword] = useState(preset?.password ?? '');
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    if (!tab) return;
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureLoginFromPage });
      const c = res?.result;
      if (!c || (!c.username && !c.password)) {
        toast('Type your username and password on the page first', { kind: 'info', ms: 3500 });
        return;
      }
      if (c.username) setUsername(c.username);
      if (c.password) setPassword(c.password);
      if (!url) setUrl(c.origin);
      toast('Captured from page');
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    }
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await actions.saveItem({ title: title.trim() || titleFromUrl(url) || 'Login', urls: url.trim() ? [url.trim()] : [], username, password, email: /@/.test(username) ? username : '' });
          toast('Login saved');
          onSaved();
        } catch (ex) {
          toast(errorMessage(ex), { kind: 'error' });
          setBusy(false);
        }
      }}
    >
      {fillable && (
        <button type="button" className="btn btn-tinted btn-block" style={{ marginBottom: 12 }} onClick={capture}>
          <Download /> Capture From Page
        </button>
      )}
      <div className="group-section">
        <div className="group">
          <label className="row">
            <div className="row-main">
              <div className="row-label">Title</div>
              <input className="row-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
            </div>
          </label>
          <label className="row">
            <div className="row-main">
              <div className="row-label">Website</div>
              <input className="row-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" spellCheck={false} />
            </div>
          </label>
          <label className="row">
            <div className="row-main">
              <div className="row-label">Username or email</div>
              <input className="row-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" spellCheck={false} autoComplete="off" />
            </div>
          </label>
          <div className="row">
            <div className="row-main">
              <div className="row-label">Password</div>
              <SecretInput className="row-input" value={password} onChange={setPassword} onGenerate={() => setPassword(generatePassword(data.settings.generator))} placeholder="Password" aria-label="Password" />
            </div>
          </div>
        </div>
      </div>
      <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || (!username && !password)}>
        {busy && <Spinner />} Save Login
      </button>
    </form>
  );
}
