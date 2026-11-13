import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Search } from 'lucide-react';
import { SqlPreview } from './SqlPreview';
import type { QueryHistoryEntry } from './types';

const statusLabel = { completed: 'Completed', results: 'First page ready', error: 'Error', cancelled: 'Cancelled' };
export function QueryHistory({ version, queryId, queryName, onOpen, onClose }: { version: number; queryId: string; queryName: string; onOpen: (entry: QueryHistoryEntry) => void; onClose: () => void }) {
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { const origin = document.activeElement as HTMLElement | null; search.current?.focus(); return () => { if (origin?.isConnected) origin.focus(); }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setEntries([]); setSelected(null);
    void invoke<QueryHistoryEntry[]>('query_history', { queryId }).then(value => { if (active) { setEntries(value ?? []); setError(''); } }).catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version, queryId]);
  const matches = entries.filter(e => e.queryId === queryId && [e.sql, e.serverName, e.database, e.error ?? '', statusLabel[e.status]].some(value => value.toLocaleLowerCase().includes(filter.toLocaleLowerCase())));
  const entry = entries.find(e => e.id === selected);
  return <aside className="query-history" aria-label="Query history" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header><strong>History · {queryName}</strong><button aria-label="Close query history" onClick={onClose}><X size={17}/></button></header>
    <label className="history-search"><Search size={14}/><input ref={search} aria-label="Search query history" placeholder="SQL, database, server or error" value={filter} onChange={e => setFilter(e.target.value)}/></label>
    <small className="history-note">Executions from this query · stored on this device</small>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading history…</p>}
    <div className="history-list">{matches.map(e => <button key={e.id} className={'history-entry' + (selected === e.id ? ' selected' : '')} onClick={() => setSelected(e.id)}>
      <span>{e.serverName} / {e.database}</span><small>{new Date(e.startedAt).toLocaleString()} · {e.durationMs.toLocaleString()} ms · {statusLabel[e.status]}</small><code>{e.sql}</code>
    </button>)}{!loading && !matches.length && <p>{filter ? 'No matching executions.' : 'Run a query to start your history.'}</p>}</div>
    {entry && <section className="history-detail"><div><strong>{statusLabel[entry.status]}</strong><button onClick={() => onOpen(entry)}>Open in new query</button></div><small>{entry.status === 'results' ? 'Duration measures time to the first page, not the complete result stream.' : 'Duration measures the execution request.'}</small><SqlPreview value={entry.sql} engine={entry.engine}/>{entry.error && <pre className="history-error">{entry.error}</pre>}</section>}
  </aside>;
}
