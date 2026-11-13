import { ContextMenu, menuPosition, type MenuPosition } from './ContextMenu';
import { quoteIdentifier } from './sql';
import { TableMetadataFolders, type TableMetadata } from './TableMetadataFolders';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Database, FileCode2, Folder, Network, Server, Plus, RefreshCw, Search, Settings2, Table2, X } from 'lucide-react';
import type { Column, Connection, Table } from './types';
const contextKey = (c: Connection) => JSON.stringify([c.id, c.database]);
const tableKey = (t: Table) => JSON.stringify([t.schema, t.name]);
export function DatabaseExplorer({ connections, databases, tables, columns, objects, onBrowse, onColumns, onSelect, onOpen, onEdit, onNew, reveal }: {
  reveal?: { connection: Connection; table: Table; id: string };
  connections: Connection[]; databases: Record<string, string[]>; tables: Record<string, Table[]>;
  objects: Record<string, Record<string, TableMetadata>>;
  columns: Record<string, Record<string, Column[]>>;
  onBrowse: (connection: Connection, force?: boolean) => Promise<boolean | undefined>;
  onColumns: (connection: Connection, table: Table, force?: boolean) => Promise<void>;
  onSelect: (connection: Connection) => void; onOpen: (connection: Connection, table?: Table) => void;
  onEdit: (connection: Connection) => void; onNew: () => void;
}) {
  const treeRoot = useRef<HTMLElement>(null);
  const [tableMenu, setTableMenu] = useState<{ c: Connection; table: Table; position: MenuPosition } | null>(null);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Connection>();
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!reveal) return;
    const c = reveal.connection, t = reveal.table, key = contextKey(c), schemaKey = key + ':schema:' + t.schema;
    setFilter(''); setSelected(c);
    setOpen(prev => ({ ...prev, [c.id]: true, [key]: true, [schemaKey]: true, [schemaKey + ':' + (t.kind.toUpperCase().includes('VIEW') ? 'Views' : 'Tables')]: true, [key + tableKey(t)]: true }));
    void onColumns(c, t);
    const timer = window.setTimeout(() => { const node = treeRoot.current?.querySelector<HTMLElement>('[data-editor-reveal="true"]'); node?.scrollIntoView?.({ block: 'nearest' }); node?.focus(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reveal]);
  const term = filter.trim().toLowerCase();
  const toggle = (key: string) => setOpen(prev => ({ ...prev, [key]: !prev[key] }));
  async function load(c: Connection, force = false) {
    const key = contextKey(c);
    if (pending[key]) return;
    setPending(prev => ({ ...prev, [key]: true })); setErrors(prev => ({ ...prev, [key]: false }));
    try { const result = await onBrowse(c, force); if (result === false) setErrors(prev => ({ ...prev, [key]: true })); }
    catch { setErrors(prev => ({ ...prev, [key]: true })); }
    finally { setPending(prev => ({ ...prev, [key]: false })); }
  }
  function select(c: Connection) { setSelected(c); onSelect(c); }
  function database(c: Connection) {
    const key = contextKey(c), loaded = tables[key], items = loaded ?? [];
    const matches = items.filter(t => `${t.schema}.${t.name}`.toLowerCase().includes(term));
    const schemas = [...new Set(matches.map(t => t.schema))];
    return <div className="explorer-database" key={key}>
      <div className={'explorer-node-row' + (selected && contextKey(selected) === key ? ' selected' : '')}>
        <button className="explorer-node" aria-label={'Database ' + c.database + ' on ' + c.name} aria-expanded={!!open[key]} onClick={() => { select(c); toggle(key); if (!open[key]) void load(c); }}><ChevronRight size={12} className={open[key] ? 'rotated' : ''}/><Database size={14} className="object-database"/><span>{c.database}</span></button>
        <button className="icon-button peek" title={'New query in ' + c.database} onClick={() => onOpen(c)}><Plus size={13}/></button>
      </div>
      {open[key] && <div className="explorer-children">
        {pending[key] && <p className="explorer-inline-state" role="status">Loading…</p>}
        {errors[key] && <p className="explorer-inline-state">Could not load database. <button onClick={() => void load(c, true)}>Retry</button></p>}
        {!pending[key] && !errors[key] && loaded && !matches.length && <p className="explorer-inline-state">{term ? 'No matching tables or views.' : 'No tables or views.'}</p>}
        {schemas.map(schema => {
          const schemaKey = key + ':schema:' + schema;
          const schemaItems = matches.filter(t => t.schema === schema);
          return <details key={schemaKey} open={!!term || !!open[schemaKey]}><summary onClick={event => { event.preventDefault(); if (!term) toggle(schemaKey); }}><ChevronRight size={12}/><Network size={14} className="object-schema"/><strong>{schema}</strong><span>{schemaItems.length}</span></summary>
            {['Tables', 'Views'].map(kind => {
              const group = schemaItems.filter(t => (t.kind.toUpperCase().includes('VIEW') ? 'Views' : 'Tables') === kind);
              const groupKey = schemaKey + ':' + kind;
              return group.length > 0 && <details className="explorer-object-group" key={kind} open={!!term || !!open[groupKey]}><summary onClick={event => { event.preventDefault(); if (!term) toggle(groupKey); }}><ChevronRight size={12}/><Folder size={14} className="object-folder"/><strong>{kind}</strong><span>{group.length}</span></summary>
                {group.map(t => {
                  const columnKey = tableKey(t), nodeKey = key + columnKey;
                  return <div key={columnKey}><div className="table-row" onContextMenu={event => { event.preventDefault(); setTableMenu({ c, table: t, position: menuPosition(event) }); }} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const origin = event.target as HTMLElement; const rect = origin.getBoundingClientRect(); setTableMenu({ c, table: t, position: { x: rect.left, y: rect.bottom, origin } }); } }}>
                    <button data-editor-reveal={reveal && contextKey(reveal.connection) === key && tableKey(reveal.table) === columnKey ? 'true' : undefined} aria-label={'Expand columns for ' + t.schema + '.' + t.name} aria-expanded={!!open[nodeKey]} onClick={() => { toggle(nodeKey); if (!open[nodeKey]) void onColumns(c, t); }} onDoubleClick={() => onOpen(c, t)} title="Expand table metadata; double-click to open query"><ChevronRight size={12} className={open[nodeKey] ? 'rotated' : ''}/><Table2 size={14} className="object-table"/><span>{t.name}</span></button>
                    <button className="icon-button peek" title="Open SELECT query" onClick={() => onOpen(c, t)}><FileCode2 size={13}/></button>
                  </div>{open[nodeKey] && <TableMetadataFolders columns={columns[key]?.[columnKey] ?? []} metadata={objects[key]?.[columnKey]} onRetry={() => void onColumns(c, t)}/>}</div>;
                })}
              </details>;
            })}
          </details>;
        })}
      </div>}
    </div>;
  }
  return <aside ref={treeRoot} className="sidebar database-explorer">
    <div className="section-title">Database Explorer<div><button className="icon-button" title="Refresh schema" disabled={!selected || !!pending[contextKey(selected)]} onClick={() => selected && void load(selected, true)}><RefreshCw size={14}/></button><button className="icon-button" title="New connection" onClick={onNew}><Plus size={16}/></button></div></div>
    {connections.length > 0 && <><div className="explorer-search search"><Search size={14}/><input aria-label="Filter tables" placeholder="Find table or schema…" value={filter} onChange={event => setFilter(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setFilter(''); event.stopPropagation(); } }}/>{filter && <button className="icon-button" title="Clear table search" onClick={() => setFilter('')}><X size={13}/></button>}</div>
    <div className="tree-heading"><span>{term ? 'Search in expanded databases' : 'Connections'}</span><button className="icon-button" title="Collapse all schemas" disabled={!!term} onClick={() => setOpen(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.includes(':schema:'))))}><ChevronRight size={13}/></button></div></>}
    <div className="tree">{connections.map(c => <div className="explorer-server" key={c.id}>
      <div className="explorer-node-row"><button className="explorer-node" aria-label={c.name} aria-expanded={!!open[c.id]} title={`${c.name} · ${c.engine === 'postgres' ? 'PostgreSQL' : 'SQL Server'} · ${c.host}`} onClick={() => { select(c); toggle(c.id); if (!open[c.id]) { setOpen(prev => ({ ...prev, [contextKey(c)]: true })); void load(c); } }}><ChevronRight size={12} className={open[c.id] ? 'rotated' : ''}/><Server size={15} className="object-server"/><span>{c.name}</span></button><button className="icon-button peek" title={'Edit ' + c.name} onClick={() => onEdit(c)}><Settings2 size={13}/></button></div>
      {open[c.id] && <div className="explorer-children">{[...new Set([c.database, ...(databases[c.id] ?? []), ...(reveal?.connection.id === c.id ? [reveal.connection.database] : [])])].map(name => database({ ...c, database: name }))}</div>}
    </div>)}
    {!connections.length && <div className="explorer-empty"><Database size={28}/><p>Your databases live here.</p><small>Add a connection to explore schemas, tables, and columns.</small><button className="text-button" onClick={onNew}><Plus size={14}/>Add connection</button></div>}
    </div>{message && <p className="explorer-inline-state" role="status">{message}</p>}
    {tableMenu && <ContextMenu position={tableMenu.position} label={'Table actions for ' + tableMenu.table.name} onClose={() => setTableMenu(null)} actions={[
      { label: 'Open query', icon: <FileCode2 size={14}/>, action: () => onOpen(tableMenu.c, tableMenu.table) },
      { label: 'Copy qualified name', action: () => { const { c, table } = tableMenu; void navigator.clipboard.writeText(`${quoteIdentifier(table.schema, c.engine)}.${quoteIdentifier(table.name, c.engine)}`).then(() => setMessage('Table name copied.')).catch(() => setMessage('Could not access the clipboard.')); } },
      { label: 'Refresh metadata', separator: true, icon: <RefreshCw size={14}/>, disabled: !!pending[contextKey(tableMenu.c)], action: () => { const { c, table } = tableMenu; void onColumns(c, table, true); } },
    ]}/>}
  </aside>;
}
