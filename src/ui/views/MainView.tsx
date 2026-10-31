import {
  Activity,
  Archive,
  Folder as FolderIcon,
  FolderPlus,
  Grid2x2,
  Lock,
  Settings,
  Star,
  Tag,
  Trash2,
  Wand2,
  Pencil,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORIES, allTags, type Category, type VaultItem } from '../../core/model';
import { ConfirmDialog, MenuButton } from '../components/primitives';
import { useVault, useVaultData } from '../state';
import { useToast } from '../toast';
import { avatarStyle } from '../util';
import { AppIcon } from './AuthViews';
import { GeneratorPage } from './GeneratorView';
import { HealthPage } from './HealthView';
import { ItemDetail } from './ItemDetail';
import { ItemEditor } from './ItemEditor';
import { ItemList } from './ItemList';
import { SettingsPage } from './SettingsView';
import { CategoryIcon } from './icons';

export type Nav =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'category'; id: Category }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'trash' }
  | { kind: 'generator' }
  | { kind: 'health' }
  | { kind: 'settings' };

export type Editing = null | { mode: 'new'; preset?: Partial<VaultItem> } | { mode: 'edit'; id: string };
type Pane = 'sidebar' | 'list' | 'detail';

const isPage = (n: Nav) => n.kind === 'generator' || n.kind === 'health' || n.kind === 'settings';

export function navTitle(nav: Nav, folders: { id: string; name: string }[]): string {
  switch (nav.kind) {
    case 'all':
      return 'All Items';
    case 'favorites':
      return 'Favorites';
    case 'category':
      return CATEGORIES.find((c) => c.id === nav.id)?.label ?? 'Category';
    case 'folder':
      return folders.find((f) => f.id === nav.id)?.name ?? 'Folder';
    case 'tag':
      return `#${nav.tag}`;
    case 'trash':
      return 'Recently Deleted';
    case 'generator':
      return 'Generator';
    case 'health':
      return 'Password Health';
    case 'settings':
      return 'Settings';
  }
}

export function MainView() {
  const data = useVaultData();
  const [nav, setNavState] = useState<Nav>({ kind: 'all' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [pane, setPane] = useState<Pane>('list');

  const setNav = useCallback((n: Nav) => {
    setNavState(n);
    setEditing(null);
    setSelectedId(null);
    setPane(isPage(n) ? 'detail' : 'list');
  }, []);

  // Drop the selection if the item disappears (deleted elsewhere / purged).
  useEffect(() => {
    if (selectedId && !data.items.some((i) => i.id === selectedId)) setSelectedId(null);
  }, [data.items, selectedId]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setEditing(null);
    setPane('detail');
  }, []);

  const startNew = useCallback(
    (preset?: Partial<VaultItem>) => {
      const p: Partial<VaultItem> = { ...preset };
      if (nav.kind === 'folder') p.folderId = nav.id;
      if (nav.kind === 'category') p.category = nav.id;
      if (nav.kind === 'favorites') p.favorite = true;
      if (nav.kind === 'tag') p.tags = [nav.tag];
      if (isPage(nav) || nav.kind === 'trash') setNavState({ kind: 'all' });
      setEditing({ mode: 'new', preset: p });
      setSelectedId(null);
      setPane('detail');
    },
    [nav],
  );

  const page = isPage(nav);
  const selected = selectedId ? (data.items.find((i) => i.id === selectedId) ?? null) : null;

  let detail: React.ReactNode;
  if (nav.kind === 'generator') detail = <GeneratorPage onBack={() => setPane('sidebar')} />;
  else if (nav.kind === 'health') detail = <HealthPage onBack={() => setPane('sidebar')} onOpen={(id) => { setNavState({ kind: 'all' }); select(id); }} />;
  else if (nav.kind === 'settings') detail = <SettingsPage onBack={() => setPane('sidebar')} />;
  else if (editing)
    detail = (
      <ItemEditor
        key={editing.mode === 'edit' ? editing.id : 'new'}
        item={editing.mode === 'edit' ? (data.items.find((i) => i.id === editing.id) ?? null) : null}
        preset={editing.mode === 'new' ? editing.preset : undefined}
        onDone={(saved) => {
          setEditing(null);
          if (saved) setSelectedId(saved.id);
          else if (!selectedId) setPane('list');
        }}
      />
    );
  else
    detail = (
      <ItemDetail
        key={selected?.id ?? 'none'}
        item={selected}
        onBack={() => setPane('list')}
        onEdit={() => selected && setEditing({ mode: 'edit', id: selected.id })}
        onNew={() => startNew()}
      />
    );

  return (
    <div className={`shell ${page ? 'no-list' : ''}`} data-pane={pane}>
      <Sidebar nav={nav} setNav={setNav} />
      {!page && <ItemList nav={nav} selectedId={selectedId} onSelect={select} onNew={() => startNew()} onBack={() => setPane('sidebar')} onNavigate={setNav} />}
      <main className="detail-col">{detail}</main>
    </div>
  );
}

function Sidebar({ nav, setNav }: { nav: Nav; setNav: (n: Nav) => void }) {
  const data = useVaultData();
  const { actions } = useVault();
  const toast = useToast();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const live = useMemo(() => data.items.filter((i) => !i.deletedAt), [data.items]);
  const trashCount = data.items.length - live.length;
  const tags = useMemo(() => allTags(data.items), [data.items]);
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of live) m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return m;
  }, [live]);
  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of live) if (i.folderId) m.set(i.folderId, (m.get(i.folderId) ?? 0) + 1);
    return m;
  }, [live]);
  const is = (n: Nav) => JSON.stringify(n) === JSON.stringify(nav);

  const item = (n: Nav, icon: React.ReactNode, label: string, count?: number) => (
    <button className="nav-item" aria-current={is(n)} onClick={() => setNav(n)}>
      <span className="nav-ico">{icon}</span>
      <span className="nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </button>
  );

  return (
    <aside className="sidebar" aria-label="Library">
      <div className="sidebar-head">
        <AppIcon size="sm" />
        <span className="brand">MyVault</span>
      </div>
      <nav className="sidebar-nav scroll">
        {item({ kind: 'all' }, <Grid2x2 />, 'All Items', live.length)}
        {item({ kind: 'favorites' }, <Star />, 'Favorites', live.filter((i) => i.favorite).length)}

        {catCounts.size > 0 && (
          <div className="nav-section">
            <div className="nav-section-head">Categories</div>
            {CATEGORIES.filter((c) => catCounts.has(c.id)).map((c) => (
              <div key={c.id}>{item({ kind: 'category', id: c.id }, <CategoryIcon id={c.id} />, c.label, catCounts.get(c.id))}</div>
            ))}
          </div>
        )}

        <div className="nav-section">
          <div className="nav-section-head">
            Folders
            <button
              className="icon-btn"
              title="New folder"
              aria-label="New folder"
              onClick={async () => {
                const f = await actions.addFolder('New Folder');
                setRenaming(f.id);
                setRenameText(f.name);
              }}
            >
              <FolderPlus />
            </button>
          </div>
          {data.folders.length === 0 && <div className="faint" style={{ fontSize: 12.5, padding: '2px 10px 4px' }}>No folders yet</div>}
          {[...data.folders]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((f) =>
              renaming === f.id ? (
                <form
                  key={f.id}
                  className="nav-item editing"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await actions.renameFolder(f.id, renameText);
                    setRenaming(null);
                  }}
                >
                  <span className="nav-ico">
                    <FolderIcon />
                  </span>
                  <input
                    autoFocus
                    value={renameText}
                    aria-label="Folder name"
                    onChange={(e) => setRenameText(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onBlur={async () => {
                      await actions.renameFolder(f.id, renameText);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  />
                </form>
              ) : (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center' }} onDoubleClick={() => { setRenaming(f.id); setRenameText(f.name); }}>
                  <div style={{ flex: 1, minWidth: 0 }}>{item({ kind: 'folder', id: f.id }, <FolderIcon />, f.name, folderCounts.get(f.id))}</div>
                  {is({ kind: 'folder', id: f.id }) && (
                    <MenuButton
                      align="right"
                      button={(open) => (
                        <button className="icon-btn sm" aria-label={`Folder options for ${f.name}`} onClick={open}>
                          <Pencil />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <button onClick={() => { close(); setRenaming(f.id); setRenameText(f.name); }}>
                            <Pencil /> Rename
                          </button>
                          <button onClick={() => { close(); setDeleting(f); }}>
                            <Trash2 /> Delete Folder
                          </button>
                        </>
                      )}
                    </MenuButton>
                  )}
                </div>
              ),
            )}
        </div>

        {tags.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-head">Tags</div>
            {tags.map((t) => (
              <div key={t}>
                {item(
                  { kind: 'tag', tag: t },
                  <span className="tag-dot" style={avatarStyle(t)} />,
                  t,
                  live.filter((i) => i.tags.includes(t)).length,
                )}
              </div>
            ))}
          </div>
        )}

        <div className="nav-section">
          <div className="nav-section-head">Tools</div>
          {item({ kind: 'generator' }, <Wand2 />, 'Generator')}
          {item({ kind: 'health' }, <Activity />, 'Password Health')}
          {item({ kind: 'trash' }, trashCount ? <Trash2 /> : <Archive />, 'Recently Deleted', trashCount)}
        </div>
      </nav>
      <div className="sidebar-foot">
        {item({ kind: 'settings' }, <Settings />, 'Settings')}
        <button className="lock-btn" onClick={() => void actions.lock()}>
          <Lock /> Lock Vault
        </button>
      </div>
      {deleting && (
        <ConfirmDialog
          danger
          icon={<Tag />}
          title={`Delete “${deleting.name}”?`}
          message="Items in this folder will not be deleted — they'll move to All Items."
          confirmLabel="Delete Folder"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await actions.deleteFolder(deleting.id);
            setDeleting(null);
            setNav({ kind: 'all' });
            toast('Folder deleted');
          }}
        />
      )}
    </aside>
  );
}
