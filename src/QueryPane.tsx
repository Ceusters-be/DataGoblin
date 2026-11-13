import { useEffect, useRef, useState } from 'react';
import { FileCode2, FolderOpen, Plus, Search, Settings2, Pin, PinOff, Pencil, Trash2, MoreHorizontal, X } from 'lucide-react';
import { DialogBoundary } from './DialogBoundary';
import type { QueryLibrary, SavedQuery } from './types';

export function QueryPane({ library, activeId, onOpen, onNew, onSettings, onUpdate, onDelete }: {
  library: QueryLibrary | null; activeId: string; onOpen: (query: SavedQuery) => void; onNew: () => void; onSettings: () => void;
  onUpdate: (id: string, patch: { name?: string; pinned?: boolean }) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ query: SavedQuery; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<SavedQuery | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const origin = document.activeElement as HTMLElement | null;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setMenu(null); origin?.focus(); } else if (event.key === 'Tab') setMenu(null); };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [menu]);
  async function perform(action: () => Promise<void>) {
    setMenu(null); setBusy(true); setError('');
    try { await action(); setRenaming(null); } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  function showMenu(query: SavedQuery, x: number, y: number) {
    if (!busy) { setError(''); setMenu({ query, x: Math.max(8, Math.min(x, window.innerWidth - 218)), y: Math.max(8, Math.min(y, window.innerHeight - 142)) }); }
  }
  const queries = (library?.queries ?? []).filter(query => (query.name + ' ' + query.serverName + ' ' + query.database).toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const pinned = queries.filter(query => query.pinned);
  const drafts = queries.filter(query => query.draft && !query.pinned);
  const named = queries.filter(query => !query.draft && !query.pinned);
  const groups = [...new Set(named.map(query => JSON.stringify([query.connectionId, query.database])))];
  const item = (query: SavedQuery) => <div className="saved-query-row" key={query.id} onContextMenu={event => { event.preventDefault(); showMenu(query, event.clientX, event.clientY); }}>
    <button title={query.name + (query.database ? ' · ' + query.database : '')} className={query.id === activeId ? 'current-query' : ''} onClick={() => onOpen(query)} onKeyDown={event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); showMenu(query, rect.left, rect.bottom); }
    }}>{query.pinned ? <Pin size={14}/> : <FileCode2 size={14}/>}<span>{query.name}</span></button>
    <button className="icon-button query-actions" aria-label={'Actions for ' + query.name} disabled={busy} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); showMenu(query, rect.left, rect.bottom); }}><MoreHorizontal size={14}/></button>
  </div>;
  return <aside className="query-pane"><section aria-label="Saved queries" className="query-library">
    <div className="section-title">SAVED QUERIES <div><button className="icon-button" title="Query storage settings" onClick={onSettings}><Settings2 size={14}/></button><button className="icon-button" title="New saved query" disabled={!library} onClick={onNew}><Plus size={16}/></button></div></div>
    <div className="query-location" title={library?.folder}><FolderOpen size={13}/><span>{library?.folder ?? 'Loading query library…'}</span></div>
    <div className="search"><Search size={14}/><input aria-label="Find saved queries" placeholder="Find a query…" value={filter} onChange={event => setFilter(event.target.value)}/></div>
    <div className="query-library-list">
      {pinned.length > 0 && <details open className="pinned-folder"><summary><Pin size={14}/>Pinned<span>{pinned.length}</span></summary>{pinned.map(item)}</details>}
      <details open className="draft-folder"><summary><FolderOpen size={14}/>Unsaved<span>{drafts.length}</span></summary>
        {drafts.map(item)}{!drafts.length && <p className="muted">New Query1, Query2… drafts are saved here automatically.</p>}
      </details>
      {groups.map(group => {
        const entries = named.filter(query => JSON.stringify([query.connectionId, query.database]) === group);
        return <details key={group} open><summary><FolderOpen size={14}/>{entries[0].serverName} / {entries[0].database || 'No database'}<span>{entries.length}</span></summary>{entries.map(item)}</details>;
      })}
      {filter && !queries.length && <p className="muted padded">No matching queries.</p>}
    </div>
    {error && !renaming && <div className="form-message error" role="alert">{error}</div>}
    <p className="query-pane-note">Unsaved drafts are kept on disk too. Rename a draft to organize it by server and database.</p>
  </section>
    {menu && <div ref={menuRef} className="query-context-menu" role="menu" aria-label={'Actions for ' + menu.query.name} style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }}>
      <button role="menuitem" onClick={() => void perform(() => onUpdate(menu.query.id, { pinned: !menu.query.pinned }))}>{menu.query.pinned ? <PinOff size={14}/> : <Pin size={14}/>}{menu.query.pinned ? 'Unpin' : 'Pin'}</button>
      <button role="menuitem" onClick={() => { setRenaming(menu.query); setName(menu.query.name); setMenu(null); }}><Pencil size={14}/>Rename</button>
      <button role="menuitem" className="delete-query" onClick={() => void perform(() => onDelete(menu.query.id))}><Trash2 size={14}/>Delete</button>
    </div>}
    {renaming && <DialogBoundary onClose={() => { setRenaming(null); setError(''); }} disabled={busy}><div className="overlay"><form className="modal" role="dialog" aria-modal="true" aria-label="Rename query" onSubmit={event => { event.preventDefault(); void perform(() => onUpdate(renaming.id, { name: name.trim() })); }}>
      <div className="modal-heading"><h2>Rename query</h2><button type="button" className="icon-button" title="Close rename dialog" disabled={busy} onClick={() => { setRenaming(null); setError(''); }}><X size={18}/></button></div>
      <label>Name<input aria-label="New query name" autoFocus value={name} onChange={event => setName(event.target.value)} required/></label>
      {error && <div className="form-message error" role="alert">{error}</div>}
      <div className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setRenaming(null); setError(''); }}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !name.trim()}>Rename</button></div>
    </form></div></DialogBoundary>}
  </aside>;
}
