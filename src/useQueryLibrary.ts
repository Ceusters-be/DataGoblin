import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Connection, QueryLibrary, QueryTab, SavedQuery } from './types';

export function useQueryLibrary(tabs: QueryTab[], connections: Connection[], ready: boolean, setTabs: Dispatch<SetStateAction<QueryTab[]>>, onError: (message: string) => void) {
  const [library, setLibrary] = useState<QueryLibrary | null>(null);
  const [status, setStatus] = useState('Loading query library…');
  const latest = useRef({ tabs, connections }); latest.current = { tabs, connections };
  const saved = useRef(new Map<string, string>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const loaded = useRef(false);
  const deleted = useRef(new Set<string>());
  const reservedNumbers = useRef(new Set<number>());
  useEffect(() => { reservedNumbers.current.clear(); }, [tabs]);
  function nextDraftName() {
    const queries = [
      ...latest.current.tabs.filter(tab => !tab.fresh),
      ...Array.from(saved.current.values(), value => JSON.parse(value) as SavedQuery),
    ];
    const used = new Set(reservedNumbers.current);
    for (const query of queries) {
      const match = /^Query\s*(\d+)(?:\.sql)?$/i.exec(query.name);
      if (match) used.add(Number(match[1]));
    }
    let number = 1;
    while (used.has(number)) number++;
    reservedNumbers.current.add(number);
    return 'Query' + number;
  }
  const record = (tab: QueryTab): SavedQuery => {
    const connection = latest.current.connections.find(c => c.id === tab.connectionId);
    return { id: tab.id, name: tab.name, sql: tab.sql, connectionId: tab.connectionId, serverName: connection?.name ?? (tab.connectionId ? 'Unknown server' : 'Unassigned'), database: tab.database || connection?.database || '', draft: tab.draft ?? false, pinned: tab.pinned ?? false };
  };
  function load(value: QueryLibrary) {
    saved.current = new Map(value.queries.map(query => [query.id, JSON.stringify(query)]));
    setLibrary(value); loaded.current = true;
  }
  useEffect(() => {
    if (!ready || !isTauri()) return;
    let cancelled = false;
    invoke<QueryLibrary>('query_library').then(value => {
      if (cancelled) return;
      load(value);
      const freshNames = new Map(latest.current.tabs.filter(tab => tab.fresh).map(tab => [tab.id, nextDraftName()]));
      setTabs(current => current.map(tab => {
        if (freshNames.has(tab.id)) return { ...tab, name: freshNames.get(tab.id)!, draft: true, fresh: false };
        const stored = value.queries.find(query => query.id === tab.id);
        return stored && tab.sql === tab.savedSql ? { ...tab, ...stored, savedSql: stored.sql } : tab;
      }));
      setStatus('Autosave ready');
    }).catch(error => { if (!cancelled) { setStatus('Autosave unavailable'); onError('Could not load query library: ' + String(error)); } });
    return () => { cancelled = true; };
  }, [ready]);

  function flush() {
    if (!loaded.current) return Promise.reject(new Error('The query library is not available yet.'));
    const task = queue.current.catch(() => {}).then(async () => {
      while (true) {
        const dirty = latest.current.tabs.map(record).filter(query => !deleted.current.has(query.id) && query.sql.trim().length > 0 && saved.current.get(query.id) !== JSON.stringify(query));
        if (!dirty.length) break;
        setStatus('Saving queries…');
        for (const query of dirty) {
          if (deleted.current.has(query.id)) continue;
          await invoke('save_library_query', { query });
          saved.current.set(query.id, JSON.stringify(query));
          setLibrary(prev => prev ? { ...prev, queries: [...prev.queries.filter(q => q.id !== query.id), query] } : prev);
          setTabs(prev => prev.map(tab => tab.id === query.id && tab.sql === query.sql ? { ...tab, savedSql: query.sql } : tab));
        }
      }
      setStatus('All queries saved');
    });
    queue.current = task;
    return task.catch(error => { setStatus('Autosave failed'); onError('Could not save queries: ' + String(error)); throw error; });
  }
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => {
    // Recovery drafts are synchronous, including edits made just before a crash.
    try { localStorage.setItem('datagoblin.tabs', JSON.stringify(tabs)); }
    catch { onError('Could not keep recovery drafts. Check your query library save status.'); }
    if (!library) return;
    const timer = setTimeout(() => { void flushRef.current().catch(() => {}); }, 600);
    return () => clearTimeout(timer);
  }, [tabs, connections, !!library]);

  useEffect(() => {
    if (!isTauri() || !('__TAURI_INTERNALS__' in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const handle = getCurrentWindow();
    handle.onCloseRequested(async event => {
      event.preventDefault();
      try { await flushRef.current(); await handle.destroy(); }
      catch { /* Stay open so failed writes can be retried. */ }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(error => onError(String(error)));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  async function changeFolder(folder: string | null) {
    await flush();
    const task = queue.current.catch(() => {}).then(async () => {
      const value = await invoke<QueryLibrary>('set_query_folder', { folder });
      load(value);
      setStatus('All queries saved');
    });
    queue.current = task;
    return task;
  }
  function updateQuery(id: string, patch: { name?: string; pinned?: boolean }) {
    const task = queue.current.catch(() => {}).then(async () => {
      if (deleted.current.has(id)) throw new Error('This query has been deleted.');
      const previous = saved.current.get(id);
      if (!previous) throw new Error('Query not found in the library.');
      const stored = JSON.parse(previous) as SavedQuery;
      const openTab = latest.current.tabs.find(tab => tab.id === id);
      const changes = patch.name !== undefined ? { ...patch, name: patch.name.trim(), draft: false, fresh: false } : patch;
      if (patch.name !== undefined && !patch.name.trim()) throw new Error('Enter a query name.');
      const query = { ...stored, ...(openTab ? record(openTab) : {}), ...changes };
      if (!query.sql.trim()) query.sql = stored.sql;
      await invoke('save_library_query', { query });
      saved.current.set(id, JSON.stringify(query));
      latest.current.tabs = latest.current.tabs.map(tab => tab.id === id ? { ...tab, ...changes } : tab);
      setTabs(current => current.map(tab => tab.id === id ? { ...tab, ...changes } : tab));
      setLibrary(current => current ? { ...current, queries: current.queries.map(entry => entry.id === id ? query : entry) } : current);
      setStatus('All queries saved');
    });
    queue.current = task;
    return task;
  }
  function deleteQuery(id: string) {
    deleted.current.add(id);
    const task = queue.current.catch(() => {}).then(async () => {
      try {
        await invoke('delete_library_query', { id });
        saved.current.delete(id);
        latest.current.tabs = latest.current.tabs.filter(tab => tab.id !== id);
        setTabs(current => current.filter(tab => tab.id !== id));
        setLibrary(current => current ? { ...current, queries: current.queries.filter(query => query.id !== id) } : current);
        setStatus('Query deleted');
      } catch (error) { deleted.current.delete(id); throw error; }
    });
    queue.current = task;
    return task;
  }
  return { library, status, flush, changeFolder, nextDraftName, updateQuery, deleteQuery };
}
