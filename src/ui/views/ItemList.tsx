import { ChevronLeft, KeyRound, Plus, Search, ShieldAlert, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { reusedIds } from '../../core/health';
import { matchesQuery, sortItems, type SortKey } from '../../core/search';
import { Avatar, EmptyState } from '../components/primitives';
import { useVaultData } from '../state';
import { isTypingTarget, itemSubtitle, relativeTime } from '../util';
import { navTitle, type Nav } from './MainView';

const SORT_KEY = 'myvault-sort';

export function ItemList({
  nav,
  selectedId,
  onSelect,
  onNew,
  onBack,
  onNavigate,
}: {
  nav: Nav;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onBack: () => void;
  onNavigate: (n: Nav) => void;
}) {
  const data = useVaultData();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(() => {
    try {
      return (localStorage.getItem(SORT_KEY) as SortKey) || 'name';
    } catch {
      return 'name';
    }
  });
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === '/' && !isTypingTarget(e.target)) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reused = useMemo(() => reusedIds(data.items), [data.items]);

  const items = useMemo(() => {
    const scoped = data.items.filter((i) => {
      if (nav.kind === 'trash') return !!i.deletedAt;
      if (i.deletedAt) return false;
      switch (nav.kind) {
        case 'favorites':
          return i.favorite;
        case 'category':
          return i.category === nav.id;
        case 'folder':
          return i.folderId === nav.id;
        case 'tag':
          return i.tags.includes(nav.tag);
        default:
          return true;
      }
    });
    return sortItems(
      scoped.filter((i) => matchesQuery(i, query)),
      nav.kind === 'trash' ? 'updated' : sort,
    );
  }, [data.items, nav, query, sort]);

  const groups = useMemo(() => {
    if (sort !== 'name' || nav.kind === 'trash' || query) return [{ key: '', items }];
    const out: Array<{ key: string; items: typeof items }> = [];
    for (const i of items) {
      const ch = i.title.trim()[0]?.toUpperCase() ?? '#';
      const key = /[A-Z]/.test(ch) ? ch : '#';
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(i);
      else out.push({ key, items: [i] });
    }
    return out;
  }, [items, sort, nav.kind, query]);

  const live = data.items.filter((i) => !i.deletedAt).length;
  const { lastBackupAt, backupReminderDays } = data.settings;
  const backupDue = live > 0 && backupReminderDays > 0 && (!lastBackupAt || Date.now() - Date.parse(lastBackupAt) > backupReminderDays * 86_400_000);

  // Keyboard navigation through the list.
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = items.findIndex((i) => i.id === selectedId);
    const next = items[Math.min(items.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      onSelect(next.id);
      document.getElementById(`item-${next.id}`)?.focus();
    }
  };

  return (
    <section className="list-col" aria-label="Items">
      <div className="mobile-bar">
        <button className="back" onClick={onBack}>
          <ChevronLeft /> Library
        </button>
      </div>
      <div className="list-head">
        <div className="list-title-row">
          <h1>{navTitle(nav, data.folders)}</h1>
          {nav.kind !== 'trash' && (
            <button className="icon-btn" onClick={onNew} title="New item" aria-label="New item">
              <Plus />
            </button>
          )}
        </div>
        <div className="search">
          <Search />
          <input
            ref={searchRef}
            className="input"
            type="search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
              if (e.key === 'Enter' && items[0]) onSelect(items[0].id);
            }}
            aria-label="Search items"
            autoComplete="off"
            spellCheck={false}
          />
          {!query && <kbd>/</kbd>}
        </div>
        <div className="list-toolbar">
          <span>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
          {nav.kind !== 'trash' && (
            <label>
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(e) => {
                  const v = e.target.value as SortKey;
                  setSort(v);
                  try {
                    localStorage.setItem(SORT_KEY, v);
                  } catch {
                    /* non-essential */
                  }
                }}
              >
                <option value="name">Sort by Name</option>
                <option value="updated">Recently Modified</option>
                <option value="used">Recently Used</option>
                <option value="created">Date Created</option>
              </select>
            </label>
          )}
        </div>
      </div>
      {backupDue && nav.kind !== 'trash' && (
        <div className="banner" role="note">
          <ShieldAlert />
          <span>{lastBackupAt ? `Last backup ${relativeTime(lastBackupAt)}.` : "You haven't backed up your vault yet."}</span>
          <button className="btn btn-sm btn-tinted" onClick={() => onNavigate({ kind: 'settings' })}>
            Back Up
          </button>
        </div>
      )}
      {nav.kind === 'trash' && items.length > 0 && (
        <p className="faint" style={{ fontSize: 12, margin: '0 18px 8px' }}>
          Items are permanently deleted 30 days after being moved here.
        </p>
      )}
      <div className="list-body scroll" role="listbox" aria-label="Items" onKeyDown={onListKey}>
        {items.length === 0 ? (
          query ? (
            <EmptyState icon={<Search />} title="No Results" text={`Nothing matches “${query}”.`} />
          ) : nav.kind === 'trash' ? (
            <EmptyState icon={<Trash2 />} title="No Deleted Items" text="Deleted items stay here for 30 days." />
          ) : (
            <EmptyState
              icon={<KeyRound />}
              title={live === 0 ? 'Your vault is empty' : 'No items here'}
              text={live === 0 ? 'Add your first password to get started.' : 'Items you add here will appear in this list.'}
              action={
                <button className="btn btn-primary" onClick={onNew}>
                  <Plus /> New Item
                </button>
              }
            />
          )
        ) : (
          groups.map((g) => (
            <div key={g.key || 'all'}>
              {g.key && <div className="list-group-head">{g.key}</div>}
              {g.items.map((i) => (
                <button
                  key={i.id}
                  id={`item-${i.id}`}
                  role="option"
                  aria-selected={i.id === selectedId}
                  className="item-row"
                  onClick={() => onSelect(i.id)}
                >
                  <Avatar item={i} />
                  <div className="item-text">
                    <div className="item-title">{i.title}</div>
                    <div className="item-sub">{nav.kind === 'trash' ? `Deleted ${relativeTime(i.deletedAt)}` : itemSubtitle(i) || '—'}</div>
                  </div>
                  <div className="item-meta">
                    {reused.has(i.id) && <ShieldAlert aria-label="Reused password" />}
                    {i.favorite && <Star className="fav" aria-label="Favorite" />}
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
