import { shallowRef, computed, watchSyncEffect, toValue, type MaybeRefOrGetter} from 'vue';
import { stateSetter, watchMounted, type StateSetter } from './vueLifecycle';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Connection, QueryLibrary, QueryTab, SavedQuery } from './types';
export function useQueryLibrary(_tabs: MaybeRefOrGetter<QueryTab[]>, _connections: MaybeRefOrGetter<Connection[]>, _ready: MaybeRefOrGetter<boolean>, setTabs: StateSetter<QueryTab[]>, onError: (message: string) => void) {
  const tabs = computed(() => toValue(_tabs));
  const connections = computed(() => toValue(_connections));
  const ready = computed(() => toValue(_ready));
  const library = shallowRef<QueryLibrary | null>(null);
  const setLibrary = stateSetter(library);
  const status = shallowRef('Loading query library…');
  const setStatus = stateSetter(status);
  const latest = shallowRef({
    tabs: tabs.value,
    connections: connections.value
  });
  watchSyncEffect(() => {
    const _tabs2 = tabs.value;
    const _connections2 = connections.value;
    return latest.value = {
      tabs: _tabs2,
      connections: _connections2
    };
  });
  const saved = shallowRef(new Map<string, string>());
  const queue = shallowRef<Promise<unknown>>(Promise.resolve());
  const loaded = shallowRef(false);
  const deleted = shallowRef(new Set<string>());
  const reservedNumbers = shallowRef(new Set<number>());
  watchMounted(() => {
    const _tabs3 = tabs.value;
    return [_tabs3];
  }, () => {
    reservedNumbers.value.clear();
  });
  function nextDraftName() {
    const queries = [...latest.value.tabs.filter(tab => !tab.fresh), ...Array.from(saved.value.values(), value => JSON.parse(value) as SavedQuery)];
    const used = new Set(reservedNumbers.value);
    for (const query of queries) {
      const match = /^Query\s*(\d+)(?:\.sql)?$/i.exec(query.name);
      if (match) used.add(Number(match[1]));
    }
    let number = 1;
    while (used.has(number)) number++;
    reservedNumbers.value.add(number);
    return 'Query' + number;
  }
  const record = (tab: QueryTab): SavedQuery => {
    const connection = latest.value.connections.find(c => c.id === tab.connectionId);
    return {
      id: tab.id,
      name: tab.name,
      sql: tab.sql,
      connectionId: tab.connectionId,
      serverName: connection?.name ?? (tab.connectionId ? 'Unknown server' : 'Unassigned'),
      database: tab.database || connection?.database || '',
      draft: tab.draft ?? false,
      pinned: tab.pinned ?? false
    };
  };
  function load(value: QueryLibrary) {
    saved.value = new Map(value.queries.map(query => [query.id, JSON.stringify(query)]));
    setLibrary(value);
    loaded.value = true;
  }
  watchMounted(() => {
    const _ready2 = ready.value;
    return [_ready2];
  }, () => {
    const _ready3 = ready.value;
    if (!_ready3 || !isTauri()) return;
    let cancelled = false;
    invoke<QueryLibrary>('query_library').then(value => {
      if (cancelled) return;
      load(value);
      const freshNames = new Map(latest.value.tabs.filter(tab => tab.fresh).map(tab => [tab.id, nextDraftName()]));
      setTabs(current => current.map(tab => {
        if (freshNames.has(tab.id)) return {
          ...tab,
          name: freshNames.get(tab.id)!,
          draft: true,
          fresh: false
        };
        const stored = value.queries.find(query => query.id === tab.id);
        return stored && tab.sql === tab.savedSql ? {
          ...tab,
          ...stored,
          savedSql: stored.sql
        } : tab;
      }));
      setStatus('Autosave ready');
    }).catch(error => {
      if (!cancelled) {
        setStatus('Autosave unavailable');
        onError('Could not load query library: ' + String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  });
  function flush(ids?: string[]) {
    if (!loaded.value) return Promise.reject(new Error('The query library is not available yet.'));
    const task = queue.value.catch(() => {}).then(async () => {
      while (true) {
        const dirty = latest.value.tabs.map(record).filter(query => (!ids || ids.includes(query.id)) && !deleted.value.has(query.id) && query.sql.trim().length > 0 && saved.value.get(query.id) !== JSON.stringify(query));
        if (!dirty.length) break;
        setStatus('Saving queries…');
        for (const query of dirty) {
          if (deleted.value.has(query.id)) continue;
          await invoke('save_library_query', {
            query
          });
          saved.value.set(query.id, JSON.stringify(query));
          setLibrary(prev => prev ? {
            ...prev,
            queries: [...prev.queries.filter(q => q.id !== query.id), query]
          } : prev);
          setTabs(prev => prev.map(tab => tab.id === query.id && tab.sql === query.sql ? {
            ...tab,
            savedSql: query.sql
          } : tab));
        }
      }
      setStatus('All queries saved');
    });
    queue.value = task;
    return task.catch(error => {
      setStatus('Autosave failed');
      onError('Could not save queries: ' + String(error));
      throw error;
    });
  }
  const flushRef = shallowRef(flush);
  watchSyncEffect(() => flushRef.value = flush);
  watchMounted(() => {
    const _tabs4 = tabs.value;
    const _connections3 = connections.value;
    const _library = library.value;
    return [_tabs4, _connections3, !!_library];
  }, () => {
    const _tabs5 = tabs.value;
    const _library2 = library.value;
    // Recovery drafts are synchronous, including edits made just before a crash.
    try {
      localStorage.setItem('datagoblin.tabs', JSON.stringify(_tabs5));
    } catch {
      onError('Could not keep recovery drafts. Check your query library save status.');
    }
    if (!_library2) return;
    const timer = setTimeout(() => {
      void flushRef.value().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  });
  watchMounted(() => [], () => {
    if (!isTauri() || !('__TAURI_INTERNALS__' in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const handle = getCurrentWindow();
    handle.onCloseRequested(async event => {
      event.preventDefault();
      try {
        await flushRef.value();
        await handle.destroy();
      } catch {/* Stay open so failed writes can be retried. */}
    }).then(stop => {
      if (disposed) stop();else unlisten = stop;
    }).catch(error => onError(String(error)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  });
  async function changeFolder(folder: string | null) {
    await flush();
    const task = queue.value.catch(() => {}).then(async () => {
      const value = await invoke<QueryLibrary>('set_query_folder', {
        folder
      });
      load(value);
      setStatus('All queries saved');
    });
    queue.value = task;
    return task;
  }
  function updateQuery(id: string, patch: {
    name?: string;
    pinned?: boolean;
  }) {
    const task = queue.value.catch(() => {}).then(async () => {
      if (deleted.value.has(id)) throw new Error('This query has been deleted.');
      const previous = saved.value.get(id);
      if (!previous) throw new Error('Query not found in the library.');
      const stored = JSON.parse(previous) as SavedQuery;
      const openTab = latest.value.tabs.find(tab => tab.id === id);
      const changes = patch.name !== undefined ? {
        ...patch,
        name: patch.name.trim(),
        draft: false,
        fresh: false
      } : patch;
      if (patch.name !== undefined && !patch.name.trim()) throw new Error('Enter a query name.');
      const query = {
        ...stored,
        ...(openTab ? record(openTab) : {}),
        ...changes
      };
      if (!query.sql.trim()) query.sql = stored.sql;
      await invoke('save_library_query', {
        query
      });
      saved.value.set(id, JSON.stringify(query));
      latest.value.tabs = latest.value.tabs.map(tab => tab.id === id ? {
        ...tab,
        ...changes
      } : tab);
      setTabs(current => current.map(tab => tab.id === id ? {
        ...tab,
        ...changes
      } : tab));
      setLibrary(current => current ? {
        ...current,
        queries: current.queries.map(entry => entry.id === id ? query : entry)
      } : current);
      setStatus('All queries saved');
    });
    queue.value = task;
    return task;
  }
  function deleteQuery(id: string) {
    deleted.value.add(id);
    const task = queue.value.catch(() => {}).then(async () => {
      try {
        await invoke('delete_library_query', {
          id
        });
        saved.value.delete(id);
        latest.value.tabs = latest.value.tabs.filter(tab => tab.id !== id);
        setTabs(current => current.filter(tab => tab.id !== id));
        setLibrary(current => current ? {
          ...current,
          queries: current.queries.filter(query => query.id !== id)
        } : current);
        setStatus('Query deleted');
      } catch (error) {
        deleted.value.delete(id);
        throw error;
      }
    });
    queue.value = task;
    return task;
  }
  async function prepareClose(ids: string[]) {
    const emptyDrafts = latest.value.tabs.filter(tab => ids.includes(tab.id) && tab.draft && !tab.sql.trim());
    // Block queued autosaves before waiting for any write already in flight.
    for (const tab of emptyDrafts) deleted.value.add(tab.id);
    if (emptyDrafts.length) {
      const task = queue.value.catch(() => {}).then(async () => {
        for (const tab of emptyDrafts) {
          try {
            if (saved.value.has(tab.id)) await invoke('delete_library_query', { id: tab.id });
            saved.value.delete(tab.id);
            setLibrary(current => current ? { ...current, queries: current.queries.filter(q => q.id !== tab.id) } : current);
          } catch (error) { deleted.value.delete(tab.id); throw error; }
        }
      });
      queue.value = task;
      await task.catch(error => {
        for (const tab of emptyDrafts) deleted.value.delete(tab.id);
        throw error;
      });
    }
    // Empty tabs can close even when the library is unavailable. Closing one
    // query must not force an unrelated dirty query to save successfully.
    if (latest.value.tabs.some(tab => ids.includes(tab.id) && tab.sql.trim())) await flush(ids);
  }
  return {
    get library() {
      const _library3 = library.value;
      return _library3;
    },
    get status() {
      const _status = status.value;
      return _status;
    },
    get flush() {
      return flush;
    },
    get changeFolder() {
      return changeFolder;
    },
    get nextDraftName() {
      return nextDraftName;
    },
    get updateQuery() {
      return updateQuery;
    },
    get deleteQuery() {
      return deleteQuery;
    },
    prepareClose,
  };
}
