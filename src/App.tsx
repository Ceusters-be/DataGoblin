import { QueryOutput, appendLog, sqlEvent, resultEvents, type OutputEvent, type OutputLog } from './QueryOutput';
import type { SqlTarget } from './editorNavigation';
import { ContextMenu, menuPosition, type MenuPosition } from './ContextMenu';
import { tableObjectsSql, parseTableObjects } from './tableObjects';
import type { TableMetadata } from './TableMetadataFolders';
import { DatabaseExplorer } from './DatabaseExplorer';
import { Select } from './Select';
import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { AlignLeft, Pin, History, Database, Plus, Play, Square, RefreshCw, FolderOpen, Table2, Columns3, ChevronRight, X, Search, Settings2, Terminal, CircleHelp, Check, LoaderCircle, FileCode2 } from 'lucide-react';
import { IslandWorkspace, WorkspaceControls, useWorkspacePanels } from './IslandWorkspace';
import { ThemeProvider } from './theme';
import { DialogBoundary } from './DialogBoundary';
import { Editor, type EditorHandle, type ExecutionMark } from './Editor';
import { PagedResults, defaultPageSize } from './PagedResults';
import { parseSqlServerConnectionString } from './connectionString';
import { QuerySettings } from './QuerySettings';
import { QueryHistory } from './QueryHistory';
import { QueryPane } from './QueryPane';
import { useQueryLibrary } from './useQueryLibrary';
import type { Column, ColumnKey, Connection, QueryResult, ResultPage, QueryTab, SavedQuery, Table, QueryHistoryEntry, ForeignReference } from './types';
import { columnsSql, databasesSql, previewSql, tablesSql, toCsv } from './sql';

const uid = () => crypto.randomUUID();
const resultIds = new WeakMap<QueryResult, string>();
function resultVersion(result: QueryResult) {
  if (!resultIds.has(result)) resultIds.set(result, uid());
  return resultIds.get(result)!;
}
const initialTab = (): QueryTab => ({ id: uid(), name: 'Query1', sql: '', savedSql: '', connectionId: '', database: '', draft: true, fresh: true });
const tableKey = (schema: string, name: string) => JSON.stringify([schema, name]);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
const fileFilter = [{ name: 'SQL query', extensions: ['sql'] }];

function restoredTabs(): QueryTab[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('datagoblin.tabs') ?? 'null');
    if (Array.isArray(parsed) && parsed.every(t => typeof t.id === 'string' && typeof t.sql === 'string' && typeof t.name === 'string' && typeof t.savedSql === 'string' && typeof t.connectionId === 'string' && typeof t.database === 'string')) return parsed;
  } catch { /* Recover an empty workspace if session state is invalid. */ }
  return [initialTab()];
}

export default function App() { return <ThemeProvider><Workspace/></ThemeProvider>; }

function Workspace() {
  const { panels, togglePanel } = useWorkspacePanels();
  const [reveal, setReveal] = useState<{ connection: Connection; table: Table; id: string }>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionsReady, setConnectionsReady] = useState(false);
  const [tabs, setTabs] = useState<QueryTab[]>(restoredTabs);
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const [explorerSelection, setExplorerSelection] = useState({ connectionId: tabs[0]?.connectionId ?? '', database: tabs[0]?.database ?? '' });
  const tab = tabs.find(t => t.id === active) ?? tabs.at(0);
  const selectedContext = tab ?? explorerSelection;
  const connection = connections.find(c => c.id === selectedContext.connectionId);
  const effective = connection ? { ...connection, database: selectedContext.database || connection.database } : undefined;
  const context = effective ? JSON.stringify([effective.id, effective.database]) : '';
  const [databases, setDatabases] = useState<Record<string, string[]>>({});
  const [tableCache, setTableCache] = useState<Record<string, Table[]>>({});
  const [objectCache, setObjectCache] = useState<Record<string, Record<string, TableMetadata>>>({});
  const objectRequests = useRef(new Set<string>());
  const [columnCache, setColumnCache] = useState<Record<string, Record<string, Column[]>>>({});
  const [results, setResults] = useState<Record<string, QueryResult>>({});
  const [pinnedResults, setPinnedResults] = useState<Record<string, { owner: string; connection: Connection; name: string }>>({});
  const [selectedResult, setSelectedResult] = useState<Record<string, string>>({});
  const [executionMarks, setExecutionMarks] = useState<Record<string, ExecutionMark | undefined>>({});
  const [outputs, setOutputs] = useState<Record<string, OutputLog>>({});
  function logOutput(id: string, database: string, ...events: OutputEvent[]) {
    setOutputs(prev => ({ ...prev, [id]: appendLog(prev[id], database, events) }));
  }

  useEffect(() => {
    const removed = Object.keys(pinnedResults).filter(id => !tabs.some(tab => tab.id === pinnedResults[id].owner));
    if (!removed.length) return;
    setPinnedResults(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !removed.includes(id))));
    setResults(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !removed.includes(id))));
  }, [tabs, pinnedResults]);
  const retainedCaches = useRef(new Set<string>());
  useEffect(() => {
    const current = new Set(Object.values(results).flatMap(result => result.cacheId ? [result.cacheId] : []));
    for (const cacheId of retainedCaches.current) if (!current.has(cacheId)) void invoke('release_results', { cacheId }).catch(() => {});
    retainedCaches.current = current;
  }, [results]);
  useEffect(() => () => { for (const cacheId of retainedCaches.current) void invoke('release_results', { cacheId }).catch(() => {}); }, []);
  const [running, setRunning] = useState<Record<string, string>>({});
  const [editPending, setEditPending] = useState<Record<string, boolean>>({});
  const [fetching, setFetching] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Connection | 'new' | null>(null);
  const [help, setHelp] = useState(false);
  const [tabMenu, setTabMenu] = useState<{ query: QueryTab; position: MenuPosition } | null>(null);
  const [renameTab, setRenameTab] = useState<QueryTab | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closedResultSets, setClosedResultSets] = useState<Record<string, { execution: string; indexes: number[] }>>({});
  const [resultIndex, setResultIndex] = useState(0);
  const passwords = useRef(new Map<string, string>());
  const activeRequests = useRef(new Map<string, string>());
  const tables = tableCache[context] ?? [];
  const columns = columnCache[context];
  const schema = useMemo(() => Object.fromEntries(tables.flatMap(t => {
    const names = (columns?.[tableKey(t.schema, t.name)] ?? []).map(c => c.name);
    return [[t.name, names], [t.schema + '.' + t.name, names]];
  })), [tableCache, context, columns]);
  const selectedResultId = tab ? selectedResult[tab.id] ?? tab.id : '';
  const resultId = selectedResultId === 'output' ? tab?.id ?? '' : selectedResultId;
  const result = results[resultId];
  const resultConnection = pinnedResults[resultId]?.connection ?? effective;
  const outputVisible = selectedResultId === 'output';
  function resultSetClosed(id: string, index: number) {
    const entry = closedResultSets[id], result = results[id];
    return !!entry && !!result && entry.execution === (result.cacheId ?? resultVersion(result)) && entry.indexes.includes(index);
  }
  function selectResult(id: string, index = 0) {
    if (!tab || fetching[tab.id]) return;
    setSelectedResult(prev => ({ ...prev, [tab.id]: id })); setResultIndex(index);
  }
  function pinResult() {
    if (!tab || !result || !resultConnection || pinnedResults[resultId]) return;
    const id = uid();
    setPinnedResults(prev => ({ ...prev, [id]: { owner: tab.id, connection: { ...resultConnection }, name: result.browser?.table ?? tab.name } }));
    setResults(prev => { const next = { ...prev, [id]: result }; delete next[tab.id]; return next; });
    if (closedResultSets[resultId]) setClosedResultSets(prev => ({ ...prev, [id]: prev[resultId] }));
    selectResult(id, resultIndex);
  }
  function closeResultTab(id: string, index: number) {
    if (!tab || fetching[tab.id] || running[tab.id]) return;
    const execution = results[id];
    if (!execution) return;
    const remaining = [tab.id, ...Object.keys(pinnedResults).filter(key => pinnedResults[key].owner === tab.id)].flatMap(key =>
      (results[key]?.sets ?? []).flatMap((set, i) => set.columns.length && !resultSetClosed(key, i) && !(key === id && i === index) ? [{ id: key, index: i }] : []));
    if (!remaining.some(item => item.id === id)) {
      setPinnedResults(prev => { const next = { ...prev }; delete next[id]; return next; });
      setResults(prev => { const next = { ...prev }; delete next[id]; return next; });
      setClosedResultSets(prev => { const next = { ...prev }; delete next[id]; return next; });
    } else {
      const indexes = execution.sets.flatMap((_, i) => i === index || resultSetClosed(id, i) ? [i] : []);
      setClosedResultSets(prev => ({ ...prev, [id]: { execution: execution.cacheId ?? resultVersion(execution), indexes } }));
    }
    if (!outputVisible && resultId === id && resultIndex === index) {
      const next = remaining.find(item => item.id === id) ?? remaining[0];
      selectResult(next?.id ?? 'output', next?.index ?? 0);
    }
  }
  const currentRequest = tab ? running[tab.id] : undefined;
  const set = result?.sets[Math.min(resultIndex, result.sets.length - 1)];

  const queryStorage = useQueryLibrary(tabs, connections, connectionsReady, setTabs, setError);
  useEffect(() => { if (isTauri()) invoke<Connection[]>('load_connections').then(value => { setConnections(value); setConnectionsReady(true); }).catch(e => setError(errorText(e))); }, []);
  const updateTab = (id: string, patch: Partial<QueryTab>) => {
    setTabs(tabs => tabs.map(t => t.id === id ? { ...t, ...patch } : t));
    if (patch.connectionId !== undefined || patch.database !== undefined) {
      setResults(prev => { const next = { ...prev }; delete next[id]; return next; });
    }
  };
  function selectDatabase(connectionId: string, database: string) {
    if (tab && (activeRequests.current.has(tab.id) || fetching[tab.id])) return;
    setExplorerSelection({ connectionId, database });
    if (tab) updateTab(tab.id, { connectionId, database });
  }
  const rawQuery = (c: Connection, sql: string, requestId = uid(), paged = false) => {
    if (!isTauri()) return Promise.reject(new Error('Database connections are available in the desktop app. Start it with npm run desktop.'));
    return invoke<QueryResult>('query', { connection: c, password: passwords.current.get(c.id) ?? null, sql, requestId, ...(paged ? { paged: true, pageSize: defaultPageSize() || 500 } : {}) });
  };
  const metadataRequests = useRef(new Map<string, Promise<boolean>>());
  function browse(c: Connection, force = false): Promise<boolean> {
    const key = JSON.stringify([c.id, c.database]);
    const pending = metadataRequests.current.get(key);
    if (pending) return pending;
    const request = loadMetadata(c, force).finally(() => metadataRequests.current.delete(key));
    metadataRequests.current.set(key, request);
    return request;
  }
  async function loadMetadata(c: Connection, force = false) {
    const key = JSON.stringify([c.id, c.database]);
    if (tableCache[key] && !force) return true;
    setLoading(n => n + 1); setError('');
    try {
      const [dbs, ts] = await Promise.all([rawQuery(c, databasesSql(c.engine)), rawQuery(c, tablesSql)]);
      setDatabases(prev => ({ ...prev, [c.id]: (dbs.sets[0]?.rows ?? []).map(r => r[0]!).filter(Boolean) }));
      setTableCache(prev => ({ ...prev, [key]: (ts.sets[0]?.rows ?? []).map(r => ({ schema: r[0]!, name: r[1]!, kind: r[2]! })) }));
      if (force) { setColumnCache(prev => ({ ...prev, [key]: {} })); setObjectCache(prev => ({ ...prev, [key]: {} })); }
      if (ts.truncated) setNotice('Explorer shows the first 1,000 tables. Large-schema pagination is not available yet.');
      return true;
    } catch (e) { setError(errorText(e)); return false; }
    finally { setLoading(n => n - 1); }
  }
  useEffect(() => { if (effective) void browse(effective); }, [context]);

  async function expandTable(c: Connection, t: Table, force = false) {
    const key = tableKey(t.schema, t.name), context = JSON.stringify([c.id, c.database]);
    const requestKey = context + key;
    if (objectRequests.current.has(requestKey) || (!force && columnCache[context]?.[key] && objectCache[context]?.[key]?.objects && !objectCache[context]?.[key]?.error)) return;
    objectRequests.current.add(requestKey);
    const update = (value: TableMetadata) => setObjectCache(prev => ({ ...prev, [context]: { ...prev[context], [key]: value } }));
    update({ loading: true });
    try {
      const [cols, objects] = await Promise.allSettled([rawQuery(c, columnsSql(t.schema, t.name)), rawQuery(c, tableObjectsSql(t.schema, t.name, c.engine))]);
      if (cols.status === 'fulfilled') setColumnCache(prev => ({ ...prev, [context]: { ...prev[context], [key]: (cols.value.sets[0]?.rows ?? []).map(r => ({ name: r[0]!, type: r[1]!, nullable: r[2] === 'YES' })) } }));
      const errors: string[] = [];
      if (cols.status === 'rejected') errors.push('Could not load columns: ' + errorText(cols.reason));
      if (objects.status === 'rejected') errors.push('Could not load keys and indexes: ' + errorText(objects.reason));
      if (cols.status === 'fulfilled' && cols.value.truncated || objects.status === 'fulfilled' && objects.value.truncated) errors.push('Metadata is incomplete: row limit reached.');
      update({ objects: objects.status === 'fulfilled' ? parseTableObjects(objects.value.sets[0]?.rows ?? []) : undefined, error: errors.join(' ') || undefined });
    } finally { objectRequests.current.delete(requestKey); }
  }
  function revealTable(table: Table) {
    if (!effective) return;
    if (!panels.explorer) togglePanel('explorer');
    setReveal({ connection: { ...effective }, table, id: uid() });
  }
  async function editorMetadata(target: SqlTarget) {
    if (!effective) return 'Choose a connection to load metadata.';
    const c = { ...effective }, ctx = JSON.stringify([c.id, c.database]), key = tableKey(target.table.schema, target.table.name);
    let cols = columnCache[ctx]?.[key], metadata = objectCache[ctx]?.[key];
    if (!cols || !metadata?.objects) {
      const [colResult, objectResult] = await Promise.allSettled([rawQuery(c, columnsSql(target.table.schema, target.table.name)), rawQuery(c, tableObjectsSql(target.table.schema, target.table.name, c.engine))]);
      if (colResult.status === 'rejected') throw colResult.reason;
      cols = (colResult.value.sets[0]?.rows ?? []).map(r => ({ name: r[0]!, type: r[1]!, nullable: r[2] === 'YES' }));
      metadata = { objects: objectResult.status === 'fulfilled' ? parseTableObjects(objectResult.value.sets[0]?.rows ?? []) : undefined, error: objectResult.status === 'rejected' ? 'Keys unavailable: ' + errorText(objectResult.reason) : undefined };
      setColumnCache(prev => ({ ...prev, [ctx]: { ...prev[ctx], [key]: cols! } }));
      setObjectCache(prev => ({ ...prev, [ctx]: { ...prev[ctx], [key]: metadata! } }));
    }
    const objects = metadata.objects ?? [];
    if (target.column) {
      const col = cols.find(col => c.engine === 'sqlserver' ? col.name.toLowerCase() === target.column!.toLowerCase() : col.name === target.column);
      if (!col) return 'Column metadata unavailable.';
      return [col.type + (col.nullable ? ' · nullable' : ' · NOT NULL'), ...objects.filter(o => o.columns.includes(col.name) && ['primary', 'foreign'].includes(o.kind)).map(o => (o.kind === 'primary' ? 'Primary key: ' : 'Foreign key: ') + o.name), metadata.error].filter(Boolean).join('\n');
    }
    return [c.database + ' · ' + target.table.kind, cols.length + ' columns', ...objects.filter(o => o.kind === 'primary').map(o => 'Primary key: ' + o.columns.join(', ')), metadata.error].filter(Boolean).join('\n');
  }
  async function openEditorData(table: Table) {
    if (!effective || !queryStorage.library) return;
    const c = { ...effective }, id = uid(), requestId = uid(), sql = previewSql(table.schema, table.name, c.engine);
    const next: QueryTab = { id, name: table.name + '.sql', sql, savedSql: '', connectionId: c.id, database: c.database, draft: false };
    setTabs(prev => [...prev, next]); setActive(id); setResultIndex(0);
    activeRequests.current.set(id, requestId); setRunning(prev => ({ ...prev, [id]: requestId }));
    const startedAt = new Date().toISOString(), started = performance.now();
    let failure: string | null = null;
    logOutput(id, c.database, sqlEvent(c.database, sql));
    try {
      const result = await rawQuery(c, sql, requestId, true);
      setResults(prev => ({ ...prev, [id]: result }));
      logOutput(id, c.database, ...resultEvents(result));
      if (!result.cancelled) setExecutionMarks(prev => ({ ...prev, [id]: { document: sql, from: 0, duration: result.elapsedMs } }));
      if (result.cacheId) void invoke<ColumnKey[]>('result_column_keys', { cacheId: result.cacheId }).then(columnKeys => setResults(prev => prev[id]?.cacheId === result.cacheId ? { ...prev, [id]: { ...prev[id], sets: prev[id].sets.map((set, index) => index === 0 ? { ...set, columnKeys } : set) } } : prev)).catch(() => {});
    } catch (error) {
      failure = errorText(error);
      logOutput(id, c.database, {kind:'error',text:failure!,duration:Math.round(performance.now()-started)});
      setSelectedResult(prev => ({ ...prev, [id]: 'output' }));
    } finally {
      activeRequests.current.delete(id); setRunning(prev => { const next = { ...prev }; delete next[id]; return next; });
      const entry: QueryHistoryEntry = { id: requestId, queryId: id, sql, connectionId: c.id, serverName: c.name, database: c.database, engine: c.engine, startedAt, durationMs: Math.round(performance.now() - started), status: failure ? /cancelled/i.test(failure) ? 'cancelled' : 'error' : 'results', error: failure };
      void invoke('record_query_history', { entry }).then(() => setHistoryVersion(v => v + 1)).catch(e => setNotice('Could not save query history: ' + errorText(e)));
    }
  }
  function newTab(sql = '', name?: string, target = selectedContext) {
    if (!queryStorage.library) return;
    const next: QueryTab = { id: uid(), name: name ?? queryStorage.nextDraftName(), sql, savedSql: '', connectionId: target.connectionId, database: target.database, draft: !name };
    setTabs(prev => [...prev, next]); setActive(next.id); setResultIndex(0);
  }
  async function run(sql: string, from = 0) {
    if (!tab) return;
    if (!effective) { setError('Choose a connection before running SQL.'); return; }
    if (!sql.trim() || (activeRequests.current.has(tab.id) || fetching[tab.id])) return;
    const id = tab.id, requestId = uid();
    setExecutionMarks(prev => ({ ...prev, [id]: undefined }));
    const startedAt = new Date().toISOString(), started = performance.now();
    let historyStatus: QueryHistoryEntry["status"] = "error", historyError: string | null = null;
    activeRequests.current.set(id, requestId);
    setRunning(prev => ({ ...prev, [id]: requestId })); setError(''); setNotice('');
    logOutput(id, effective.database, sqlEvent(effective.database, sql));
    try {
      if (results[id]?.cacheId) {
        await invoke('release_results', { cacheId: results[id].cacheId });
        setResults(prev => ({ ...prev, [id]: { ...prev[id], cancelled: true, complete: true } }));
      }
      const result = await rawQuery(effective, sql, requestId, true);
      if (!result.cancelled) setExecutionMarks(prev => ({ ...prev, [id]: { document: tab.sql, from, duration: result.elapsedMs } }));
      historyStatus = result.complete ? "completed" : "results";
      logOutput(id, effective.database, ...resultEvents(result));
      setResults(prev => ({ ...prev, [id]: result })); setSelectedResult(prev => ({ ...prev, [id]: result.sets.some(set => set.columns.length) ? id : 'output' })); setResultIndex(Math.max(0, result.sets.findIndex(set => set.columns.length > 0)));
      if (result.cacheId) {
        const cacheId = result.cacheId;
        const applyKeys = (metadata: Partial<QueryResult['sets'][number]>) => setResults(prev => Object.fromEntries(Object.entries(prev).map(([key, result]) => [key, result.cacheId === cacheId ? { ...result, sets: result.sets.map((set, index) => index === 0 ? { ...set, ...metadata } : set) } : result])));
        void invoke<ColumnKey[]>('result_column_keys', { cacheId }).then(columnKeys => applyKeys({ columnKeys: columnKeys ?? [] })).catch(error => applyKeys({ keyMetadataError: errorText(error) }));
      }
    } catch (e) { historyError = errorText(e); historyStatus = /cancelled/i.test(historyError) ? "cancelled" : "error"; setError(historyError); logOutput(id, effective.database, {kind:'error',text:historyError!,duration:Math.round(performance.now()-started)}); setSelectedResult(prev => ({ ...prev, [id]: 'output' })); }
    finally {
      const entry: QueryHistoryEntry = { id: requestId, queryId: id, sql, connectionId: effective.id, serverName: effective.name, database: effective.database, engine: effective.engine, startedAt, durationMs: Math.round(performance.now() - started), status: historyStatus, error: historyError };
      void invoke('record_query_history', { entry }).then(() => setHistoryVersion(v => v + 1)).catch(e => setNotice('Could not save query history: ' + errorText(e)));
      activeRequests.current.delete(id); setRunning(prev => { const next = { ...prev }; delete next[id]; return next; }); }
  }
  async function browseResults(filters: NonNullable<QueryResult['browser']>['filters'], sort: NonNullable<QueryResult['browser']>['sort'], afterEdit = false) {
    if (!tab || !result?.cacheId || activeRequests.current.has(tab.id) || fetching[tab.id] && !afterEdit) return;
    const id = tab.id, cacheId = result.cacheId, requestId = uid();
    const database = resultConnection?.database ?? tab.database;
    const started = performance.now();
    logOutput(id, database, {text:'Refreshing results…'});
    activeRequests.current.set(id, requestId); setRunning(prev => ({ ...prev, [id]: requestId })); setError('');
    setResults(prev => ({ ...prev, [resultId]: { ...prev[resultId], cancelled: true } }));
    try {
      const next = await invoke<QueryResult>('browse_table', { cacheId, requestId, filters, sort, pageSize: defaultPageSize() || 500 });
      setResults(prev => prev[resultId]?.cacheId === cacheId ? { ...prev, [resultId]: { ...next, sets: next.sets.map((set, index) => ({ ...set, columnKeys: prev[resultId].sets[index]?.columnKeys })) } } : prev);
      logOutput(id, database, ...(next.browser ? [sqlEvent(database, next.browser.sql, next.browser.parameters)] : []), ...resultEvents(next));
      setResultIndex(0);
    } catch (error) { setError(errorText(error)); logOutput(id, database, {kind:'error',text:errorText(error),duration:Math.round(performance.now()-started)}); }
    finally { activeRequests.current.delete(id); setRunning(prev => { const next = { ...prev }; delete next[id]; return next; }); }
  }
  async function openReference(reference: ForeignReference, column: string, rowIndex: number) {
    if (!tab || !result?.cacheId || activeRequests.current.has(tab.id) || fetching[tab.id] || !queryStorage.library) return;
    const sourceId = tab.id, cacheId = result.cacheId, requestId = uid();
    const navigationConnection = resultConnection, navigationStartedAt = new Date().toISOString();
    const connectionId = resultConnection?.id ?? tab.connectionId, database = resultConnection?.database ?? tab.database;
    activeRequests.current.set(sourceId, requestId); setRunning(prev => ({ ...prev, [sourceId]: requestId })); setError('');
    try {
      const response = await invoke<{ result: QueryResult; sql: string; name: string }>('open_reference', { cacheId, column, referenceId: reference.id, rowIndex, requestId });
      const next: QueryTab = { id: uid(), name: queryStorage.nextDraftName(), sql: response.sql, savedSql: '', connectionId, database, draft: true };
      setTabs(prev => [...prev, next]); setActive(next.id); setResultIndex(0);
      setResults(prev => ({ ...prev, [next.id]: response.result }));
      logOutput(next.id, database, sqlEvent(database, response.sql), ...resultEvents(response.result));
      if (navigationConnection) {
        const entry: QueryHistoryEntry = { id: requestId, queryId: next.id, sql: response.sql, connectionId, serverName: navigationConnection.name, database, engine: navigationConnection.engine, startedAt: navigationStartedAt, durationMs: response.result.elapsedMs, status: response.result.complete ? 'completed' : 'results', error: null };
        void invoke('record_query_history', { entry }).then(() => setHistoryVersion(v => v + 1)).catch(e => setNotice('Could not save query history: ' + errorText(e)));
      }
      if (!response.result.sets[0]?.rows.length) setNotice('No referenced record was found. It may have been deleted or hidden by database permissions.');
      const newCacheId = response.result.cacheId;
      void invoke<ColumnKey[]>('result_column_keys', { cacheId: newCacheId }).then(columnKeys => setResults(prev => prev[next.id]?.cacheId === newCacheId ? { ...prev, [next.id]: { ...prev[next.id], sets: prev[next.id].sets.map((set, i) => i === 0 ? { ...set, columnKeys } : set) } } : prev)).catch(() => {});
    } catch (error) { setError(errorText(error)); }
    finally { activeRequests.current.delete(sourceId); setRunning(prev => { const next = { ...prev }; delete next[sourceId]; return next; }); }
  }
  function updatePagedResult(id: string, cacheId: string, result: QueryResult) {
    setResults(prev => prev[id]?.cacheId === cacheId && !prev[id].cancelled ? { ...prev, [id]: { ...result, sets: result.sets.map((set, index) => ({ ...set, columnKeys: prev[id].sets[index]?.columnKeys, keyMetadataError: prev[id].sets[index]?.keyMetadataError })), elapsedMs: prev[id].elapsedMs } } : prev);
  }
  async function nextResult() {
    if (!tab || !result?.cacheId) return;
    const id = tab.id, cacheId = result.cacheId;
    const started=performance.now(), database=resultConnection?.database ?? tab.database;
    logOutput(id,database,{text:'Fetching next result set…'});
    setFetching(prev => ({ ...prev, [id]: true }));
    try {
      const page = await invoke<ResultPage>('result_page', { cacheId, setIndex: result.sets.length, offset: 0, pageSize: defaultPageSize() || 500 });
      if (page.result) {
        const duration=Math.round(performance.now()-started);
        logOutput(id,database,{kind:'success',text:page.result.sets.length > result.sets.length ? `${page.rows.length} rows retrieved starting from 1 in ${duration} ms · Result ${result.sets.length+1}` : `No more result sets · completed in ${duration} ms`,duration});
        updatePagedResult(resultId, cacheId, page.result);
        if (page.result.sets.length > result.sets.length) setResultIndex(result.sets.length);
        else setNotice('No more result sets.');
      }
    } catch (error) { setError(errorText(error)); logOutput(id,database,{kind:'error',text:errorText(error),duration:Math.round(performance.now()-started)}); }
    finally { setFetching(prev => ({ ...prev, [id]: false })); }
  }
  const [refreshIntervals, setRefreshIntervals] = useState<Record<string, number>>({});
  async function cancelCurrent() {
    if (!tab) return;
    const id = tab.id, requestId = running[id] ?? result?.cacheId;
    if (!requestId) return;
    try {
      await invoke('cancel_query', { requestId });
      logOutput(id,resultConnection?.database ?? tab.database,{text:running[id] ? 'Cancellation requested.' : 'Result fetching cancelled.'});
      if (!running[id]) setResults(prev => prev[resultId]?.cacheId === requestId ? { ...prev, [resultId]: { ...prev[resultId], cancelled: true, complete: true } } : prev);
    } catch (error) { setError(errorText(error)); }
  }
  async function saveTab() {
    try { await queryStorage.flush(); } catch (error) { setError(errorText(error)); }
  }
  async function openQuery() {
    try {
      const path = await open({ multiple: false, filters: fileFilter });
      if (!path) return;
      const sql = await readTextFile(path);
      const next = { ...initialTab(), name: path.split(/[\\/]/).pop()!, path, sql, savedSql: sql, connectionId: selectedContext.connectionId, database: selectedContext.database, draft: false, fresh: false };
      setTabs(prev => [...prev, next]); setActive(next.id);
    } catch (e) { setError(errorText(e)); }
  }
  async function closeTab(id: string) {
    const closing = tabs.find(t => t.id === id);
    if (!closing || activeRequests.current.has(id) || fetching[id]) return;
    try { await queryStorage.flush(); } catch (error) { setError(errorText(error)); return; }
    if (tab?.id === id) setExplorerSelection({ connectionId: closing.connectionId, database: closing.database });
    setTabs(current => current.filter(t => t.id !== id));
    setActive(current => current === id ? '' : current);
    setResults(prev => { const next = { ...prev }; delete next[id]; return next; });
  }
  async function changeTabDetails(query: QueryTab, patch: { name?: string; pinned?: boolean }) {
    if (query.sql.trim()) { await queryStorage.flush(); await queryStorage.updateQuery(query.id, patch); }
    else updateTab(query.id, { ...patch, ...(patch.name ? { draft: false, fresh: false } : {}) });
  }
  async function closeTabs(ids: string[]) {
    const closable = ids.filter(id => !activeRequests.current.has(id) && !fetching[id]);
    try { await queryStorage.flush(); } catch (e) { setError(errorText(e)); return; }
    setTabs(current => current.filter(t => !closable.includes(t.id)));
    setActive(current => closable.includes(current) ? '' : current);
    setResults(current => Object.fromEntries(Object.entries(current).filter(([id]) => !closable.includes(id))));
  }
  async function exportCsv(rows: (string | null)[][]) {
    if (!set) return;
    try {
      const path = await save({ defaultPath: 'results.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (path) { await writeTextFile(path, toCsv(set.columns, rows)); setNotice('Displayed rows exported.'); }
    } catch (e) { setError(errorText(e)); }
  }
  const editorHandle = useRef<EditorHandle>(null);
  const shortcuts = useRef({ newTab, tab, tabs }); shortcuts.current = { newTab, tab, tabs };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        const { tabs, tab } = shortcuts.current;
        if (tabs.length) { event.preventDefault(); const index = tabs.findIndex(t => t.id === tab?.id); setActive(tabs[(index + (event.key === 'PageDown' ? 1 : tabs.length - 1)) % tabs.length].id); setResultIndex(0); }
      }
      if (event.key === ',') { event.preventDefault(); setSettingsOpen(true); }
      if (event.shiftKey && event.key.toLowerCase() === 'h' && shortcuts.current.tab) { event.preventDefault(); setHistoryOpen(v => !v); }
      if (event.altKey && event.key.toLowerCase() === 'n') { event.preventDefault(); shortcuts.current.newTab(); }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, []);
  function openHistory(entry: QueryHistoryEntry) {
    if (!queryStorage.library) return;
    const next: QueryTab = { id: uid(), name: queryStorage.nextDraftName(), sql: entry.sql, savedSql: '', connectionId: entry.connectionId, database: entry.database, draft: true };
    setTabs(prev => [...prev, next]); setActive(next.id); setResultIndex(0); setHistoryOpen(false);
    if (!connections.some(c => c.id === entry.connectionId)) setNotice('The original connection is no longer saved. Select a connection before running this query.');
  }
  function reopenQuery(query: SavedQuery) {
    const existing = tabs.find(t => t.id === query.id);
    if (!existing) setTabs(prev => [...prev, { ...query, savedSql: query.sql }]);
    setActive(query.id);
  }
  return <div className="app">
    <header className="topbar">
      <div className="brand"><img src="/goblin.svg" alt="" /><strong>DataGoblin</strong><span className="alpha">EARLY ACCESS</span></div>
      <WorkspaceControls panels={panels} onToggle={togglePanel}/><div className="top-actions"><button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17}/></button><button className="icon-button" title="Keyboard shortcuts" onClick={() => setHelp(true)}><CircleHelp size={17}/></button></div>
    </header>
    <IslandWorkspace panels={panels}
      explorer={<DatabaseExplorer reveal={reveal} connections={connections} databases={databases} tables={tableCache} columns={columnCache} objects={objectCache} onBrowse={browse} onColumns={expandTable}
        onSelect={c => { setExplorerSelection({ connectionId: c.id, database: c.database }); if (tab && !tab.connectionId) updateTab(tab.id, { connectionId: c.id, database: c.database }); }}
        onOpen={(c, table) => newTab(table ? previewSql(table.schema, table.name, c.engine) : '', table ? table.name + '.sql' : undefined, { connectionId: c.id, database: c.database })}
        onEdit={setDialog} onNew={() => setDialog('new')}/>}
      editor={<main>
        <div className="tabs">{tabs.map(t => <div key={t.id} className={'tab ' + (t.id === tab?.id ? 'active' : '')} onContextMenu={event => { event.preventDefault(); setTabMenu({ query: t, position: menuPosition(event) }); }} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const origin = event.target as HTMLElement; const rect = origin.getBoundingClientRect(); setTabMenu({ query: t, position: { x: rect.left, y: rect.bottom, origin } }); } }} onMouseDown={event => { if (event.button === 1) event.preventDefault(); }} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); void closeTab(t.id); } }}><button onClick={() => { setActive(t.id); setResultIndex(0); }}><FileCode2 size={14}/><span className="tab-name" title={t.name}>{t.pinned && <span aria-label="Pinned query"><Pin size={11}/></span>}{t.name}</span>{t.sql !== t.savedSql && <span className="dirty"/>}</button><button className="icon-button" title="Close query" disabled={!!running[t.id]} onClick={() => closeTab(t.id)}><X size={12}/></button></div>)}<button className="icon-button add-tab" title="New query" onClick={() => newTab()}><Plus size={16}/></button></div>
        {tab && <div className="toolbar"><button className="run-button" aria-label="Run all" disabled={!!running[tab.id] || !!fetching[tab.id] || !effective} title="Run all SQL in this tab; use keyboard shortcut for current statement" onClick={() => void run(tab.sql)}><Play size={19}/></button><span className="separator" aria-hidden="true"/>
          <button className="icon-button cancel-query-button" disabled={editPending[tab.id] || !running[tab.id] && !(result?.cacheId && result.complete === false && !result.cancelled)} title="Cancel query" onClick={() => void cancelCurrent()}><Square size={19}/></button><button className="icon-button" title="Query history" aria-label="Query history" aria-pressed={historyOpen} onClick={() => setHistoryOpen(v => !v)}><History size={17}/></button>
          <button className="icon-button" aria-label="Format SQL" title={`Format SQL (selection or entire query) · ${mod}+Alt+L`} onClick={() => editorHandle.current?.format()}><AlignLeft size={17}/></button>
          <span className="toolbar-context" title={effective?.host}>{effective ? effective.name : 'No connection selected'}</span>
          {effective && <label className="query-database-picker"><Database size={14}/><Select label="Query database" title="Database for this query" searchable disabled={!!running[tab.id] || !!fetching[tab.id]} value={effective.database} onChange={value => selectDatabase(effective.id, value)} options={[...new Set([effective.database, ...(databases[effective.id] ?? [])])].map(value => ({ value, label: value }))}/></label>}<span className="dialect">{effective?.engine === 'sqlserver' ? 'T-SQL' : 'PostgreSQL'}</span>
        </div>}
        {!isTauri() && <div className="banner info">Browser shell only. Run <code>npm run desktop</code> for database connections and file access.</div>}
        {error && <div className="banner error" role="alert"><span>{error}</span><button className="icon-button" title="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
        {notice && <div className="banner info" role="status"><span>{notice}</span><button className="icon-button" title="Dismiss notification" onClick={() => setNotice('')}><X size={14}/></button></div>}
        {tab ? <section className="editor-pane"><Editor ref={editorHandle} onFormatError={setError} tables={tables} columns={columns} onReveal={revealTable} onMetadata={editorMetadata} onOpenData={table => void openEditorData(table)} execution={executionMarks[tab.id]} key={tab.id} value={tab.sql} engine={effective?.engine ?? 'postgres'} schema={schema} onChange={sql => updateTab(tab.id, { sql })} onRun={(sql, from) => void run(sql, from)} onSave={() => void saveTab()}/></section>

        : <section className="workspace-empty"><div className="empty-mark"><FileCode2 size={28}/></div><h2>No queries open</h2><p>Create a query, import a SQL file, or reopen one from Saved Queries.</p><div><button className="primary-button" disabled={!queryStorage.library} onClick={() => newTab()}><Plus size={15}/>Create query</button><button className="secondary-button" onClick={() => void openQuery()}><FolderOpen size={15}/>Import SQL file</button></div></section>}

      </main>}
      queries={<QueryPane library={queryStorage.library} activeId={tab?.id ?? ''} onOpen={reopenQuery} onNew={() => newTab()} onSettings={() => setSettingsOpen(true)} onUpdate={queryStorage.updateQuery} onDelete={async id => {
        if (activeRequests.current.has(id) || fetching[id]) throw new Error('Finish the running query or apply/revert pending edits before deleting it.');
        await queryStorage.deleteQuery(id);
        setResults(current => { const next = { ...current }; delete next[id]; return next; });
        setActive(current => current === id ? '' : current);
      }}/>}
      results={tab ? <section className="results-pane"><div className="result-toolbar result-tabs-toolbar">
        <span className="result-panel-title">Database Output</span>
        <div className="result-tabs" role="tablist" aria-label="Query results" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          event.preventDefault(); buttons[next]?.focus(); buttons[next]?.click();
        }}>
          <button role="tab" aria-selected={outputVisible} disabled={!!fetching[tab.id]} onClick={() => selectResult('output')}><Terminal size={13}/>Output{outputs[tab.id]?.failed && <span className="output-error-dot"/>}</button>
          {[tab.id, ...Object.keys(pinnedResults).filter(id => pinnedResults[id].owner === tab.id)].flatMap(id => (results[id]?.sets ?? []).map((set, index) => set.columns.length && !resultSetClosed(id, index) ? <div className={"result-tab-item" + (!outputVisible && resultId === id && Math.min(resultIndex, results[id].sets.length - 1) === index ? " selected" : "")} key={id + ':' + index} onMouseDown={event => { if (event.button === 1) event.preventDefault(); }} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); event.stopPropagation(); closeResultTab(id, index); } }}>
            <button role="tab" aria-selected={!outputVisible && resultId === id && Math.min(resultIndex, results[id].sets.length - 1) === index} disabled={!!fetching[tab.id]} onClick={() => selectResult(id, index)} title={pinnedResults[id] ? 'Pinned result · ' + pinnedResults[id].connection.database : undefined}>
              {pinnedResults[id] ? <Pin size={12}/> : <Table2 size={13}/>}<span>{results[id].browser?.table ? [pinnedResults[id]?.connection.database ?? effective?.database, results[id].browser.table].filter(Boolean).join('.') : pinnedResults[id]?.name ?? tab.name}{results[id].sets.length > 1 ? ` · ${index + 1}` : ''}</span>
            </button>
            <button className="result-tab-close" title="Close result tab" aria-label={pinnedResults[id] ? 'Close pinned result ' + pinnedResults[id].name : 'Close result ' + (index + 1)} disabled={!!fetching[tab.id] || !!running[tab.id]} onClick={() => closeResultTab(id, index)}><X size={12}/></button>
          </div> : null))}
        </div>
        <div className="result-toolbar-context">
          {running[tab.id] && (outputVisible || !set?.columns.length) && <LoaderCircle size={13} className="spin"/>}
          <span className="result-meta">{outputVisible ? outputs[tab.id]?.database : resultConnection?.database}{(outputVisible ? outputs[tab.id] : result) && ` · ${outputVisible ? outputs[tab.id]?.duration : result?.elapsedMs} ms`}</span>
          {!outputVisible && result && !pinnedResults[resultId] && <button className="icon-button" aria-label="Pin result" disabled={!!running[tab.id] || !!fetching[tab.id]} onClick={pinResult}><Pin size={13}/></button>}
          {!outputVisible && result?.cacheId && result.complete === false && !result.cancelled && <button className="text-button" disabled={!!fetching[tab.id] || !!running[tab.id]} title="Fetch remaining rows in the current result to reach the next result set" onClick={() => void nextResult()}>Next result set</button>}
        </div>
      </div>
      {outputVisible ? <QueryOutput log={outputs[tab.id]}/> : <>
          {result?.truncated && <div className="banner info">Result cache limit reached (1,000,000 rows or 128 MiB). Only cached rows can be paged. Connection closed; later batch statements may not have completed.</div>}
          {set?.columns.length ? <PagedResults onLog={event => logOutput(tab.id, resultConnection?.database ?? tab.database, event)} logDatabase={resultConnection?.database ?? tab.database} onCancel={() => void cancelCurrent()} cancellable={!!running[tab.id] || !!(result?.cacheId && result.complete === false && !result.cancelled)} refreshInterval={refreshIntervals[resultId] ?? 0} onRefreshInterval={seconds => setRefreshIntervals(prev => ({ ...prev, [resultId]: seconds }))} onEditingChange={dirty => setEditPending(prev => prev[tab.id] === dirty ? prev : { ...prev, [tab.id]: dirty })} onReload={result?.browser ? () => browseResults(result.browser!.filters, result.browser!.sort, true) : undefined} onReference={openReference} engine={resultConnection?.engine} browser={result?.browser} onBrowse={browseResults} browserBusy={!!running[tab.id]} key={resultId + ":" + resultIndex + ":" + (result?.cacheId ?? resultVersion(result!))} data={set} cacheId={result?.cacheId} setIndex={Math.min(resultIndex, result!.sets.length - 1)} truncated={result!.truncated} initialSize={set.pageSize ?? result?.pageSize ?? 500} closed={result?.cancelled} onUpdate={next => updatePagedResult(resultId, result!.cacheId!, next)} onBusy={busy => setFetching(prev => prev[tab.id] === busy ? prev : { ...prev, [tab.id]: busy })} onExport={exportCsv}/>
            : result ? <div className="result-empty"><Check size={28}/><h3>Query completed</h3><p>{set?.affected != null ? set.affected + ' rows affected' : 'No result set returned.'}</p></div>
            : <div className="result-empty"><div className="empty-mark"><Terminal size={25}/></div><h3>Ready to run</h3><p>Run your query to view and explore its results.</p><span>Ctrl / Cmd + Enter to run the current statement</span></div>}
        </>}</section> : null}
      footer={<footer><span className="status-dot"/>{currentRequest ? 'Running query…' : tab && editPending[tab.id] ? 'Pending cell changes · Apply or Revert' : tab && fetching[tab.id] ? 'Fetching rows…' : queryStorage.status}<span className="footer-right">Auto-commit · Results fetched on demand</span></footer>}
    />
    {tabMenu && <ContextMenu position={tabMenu.position} label={'Query actions for ' + tabMenu.query.name} onClose={() => setTabMenu(null)} actions={[
      { label: 'Close', disabled: !!running[tabMenu.query.id] || !!fetching[tabMenu.query.id], action: () => void closeTab(tabMenu.query.id) },
      { label: 'Close other tabs', disabled: !tabs.some(t => t.id !== tabMenu.query.id && !t.pinned && !running[t.id] && !fetching[t.id]), action: () => void closeTabs(tabs.filter(t => t.id !== tabMenu.query.id && !t.pinned).map(t => t.id)) },
      { label: 'Close all unpinned tabs', disabled: !tabs.some(t => !t.pinned && !running[t.id] && !fetching[t.id]), action: () => void closeTabs(tabs.filter(t => !t.pinned).map(t => t.id)) },
      { label: tabMenu.query.pinned ? 'Unpin' : 'Pin', separator: true, action: () => { void changeTabDetails(tabMenu.query, { pinned: !tabMenu.query.pinned }).catch(e => setError(errorText(e))); } },
      { label: 'Rename', action: () => { setRenameTab(tabMenu.query); setRenameName(tabMenu.query.name); setRenameError(''); } },
      { label: 'Duplicate', action: () => newTab(tabMenu.query.sql, undefined, tabMenu.query) },
    ]}/>}
    {renameTab && <DialogBoundary onClose={() => setRenameTab(null)} disabled={renameBusy}><div className="overlay"><form className="modal" role="dialog" aria-modal="true" aria-label="Rename query tab" onSubmit={event => { event.preventDefault(); setRenameBusy(true); void changeTabDetails(renameTab, { name: renameName.trim() }).then(() => setRenameTab(null)).catch(e => setRenameError(errorText(e))).finally(() => setRenameBusy(false)); }}>
      <h2>Rename query</h2><label>Name<input autoFocus aria-label="Query tab name" value={renameName} onChange={event => setRenameName(event.target.value)} required/></label>
      {renameError && <p role="alert">{renameError}</p>}<div className="modal-footer"><button type="button" disabled={renameBusy} onClick={() => setRenameTab(null)}>Cancel</button><button className="primary-button" disabled={renameBusy || !renameName.trim()}>Rename</button></div>
    </form></div></DialogBoundary>}
    {historyOpen && tab && <QueryHistory key={tab.id} queryId={tab.id} queryName={tab.name} version={historyVersion} onOpen={openHistory} onClose={() => setHistoryOpen(false)}/>}

    {dialog && <ConnectionDialog initial={dialog === 'new' ? undefined : dialog} onClose={() => setDialog(null)} onTest={async (c, password) => { await invoke('query', { connection: c, password: password === '' && dialog !== 'new' ? null : password, sql: 'SELECT 1', requestId: uid() }); }} onSave={async (c, password, remember) => {
      if (!isTauri()) throw new Error('Open the desktop app to save connections.');
      if (!remember) {
        if (password === '' && dialog !== 'new') throw new Error('Enter the password to switch this connection to session-only storage.');
        await invoke('forget_password', { id: c.id });
      }
      if (password !== '' || dialog === 'new') { if (remember) await invoke('save_password', { id: c.id, password }); passwords.current.set(c.id, password); }
      const next = [...connections.filter(x => x.id !== c.id), c];
      await invoke('save_connections', { connections: next }); setConnections(next);
      setTableCache(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => JSON.parse(key)[0] !== c.id)));
      setColumnCache(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => JSON.parse(key)[0] !== c.id)));
      setObjectCache(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => JSON.parse(key)[0] !== c.id)));
      setExplorerSelection({ connectionId: c.id, database: c.database });
      if (tab && !tab.connectionId) updateTab(tab.id, { connectionId: c.id, database: c.database });
      setDialog(null);
      await browse(c, true);
    }}/>}
    {help && <DialogBoundary onClose={() => setHelp(false)}><div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setHelp(false); }}><section className="modal shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><div className="modal-heading"><h2>Keep your hands on the keyboard.</h2><button className="icon-button" title="Close shortcuts" onClick={() => setHelp(false)}><X size={18}/></button></div>{[[mod + ' + Enter', 'Run selection or current statement'], [mod + ' + S', 'Save SQL file'], [mod + ' + Alt + L', 'Format SQL selection or entire query'], ['Ctrl + Space', 'Show autocomplete'], ['sel + Tab', 'Expand SELECT template'], [mod + ' + /', 'Toggle line comment'], [mod + ' + F', 'Find in query'], [mod + ' + Z', 'Undo'], [mod + ' + ,', 'Settings'], [mod + ' + Shift + H', 'Query history'], [mod + ' + Alt + N', 'New query'], [mod + ' + Page Up / Down', 'Previous / next query tab'], ['Escape', 'Dismiss dialog or popover']].map(([key, action]) => <div className="shortcut-row" key={key}><span>{action}</span><kbd>{key}</kbd></div>)}<p className="muted">Expand a table in the explorer to load its columns into autocomplete.</p></section></div></DialogBoundary>}
    {settingsOpen && <QuerySettings library={queryStorage.library} onChange={queryStorage.changeFolder} onClose={() => setSettingsOpen(false)}/>}
  </div>;
}

function ConnectionDialog({ initial, onClose, onSave, onTest }: { initial?: Connection; onClose: () => void; onSave: (c: Connection, password: string, remember: boolean) => Promise<void>; onTest: (c: Connection, password: string) => Promise<void> }) {
  const [connectionString, setConnectionString] = useState('');
  function importConnectionString() {
    setOk(false);
    try {
      const parsed = parseSqlServerConnectionString(connectionString);
      setC(prev => ({ ...prev, ...parsed.connection, name: prev.name || parsed.connection.database + ' @ ' + parsed.connection.host }));
      setPassword(parsed.password);
      setConnectionString('');
      setOk(true);
      setMessage('Connection details filled in. Review the fields below.' + (parsed.ignoredOptions ? ' Application, pooling, timeout and other client-only options are not imported; DataGoblin uses its own settings.' : ''));
    } catch (error) { setMessage(errorText(error)); }
  }
  const [c, setC] = useState<Connection>(initial ?? { id: uid(), name: '', engine: 'postgres', host: 'localhost', port: 5432, database: 'postgres', username: 'postgres', tls: true, trustCertificate: false });
  const [password, setPassword] = useState(''), [remember, setRemember] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [ok, setOk] = useState(false);
  const patch = (value: Partial<Connection>) => { setC(prev => ({ ...prev, ...value })); setMessage(''); };
  async function perform(test: boolean) {
    setBusy(true); setMessage(''); setOk(false);
    try {
      if (!c.name.trim() || !c.host.trim() || !c.database.trim() || !c.username.trim() || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error('Enter a name, host, database, username, and valid port.');
      if (test) { await onTest(c, password); setOk(true); setMessage('Connection successful. Your goblin is in.'); }
      else await onSave(c, password, remember);
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }
  return <DialogBoundary onClose={onClose} disabled={busy}><div className="overlay"><form className="modal" role="dialog" aria-modal="true" aria-label="Database connection" onSubmit={e => { e.preventDefault(); void perform(false); }}><div className="modal-heading"><div><div className="eyebrow">MAKE YOURSELF AT HOME</div><h2>{initial ? 'Edit connection' : 'Connect a database'}</h2></div><button type="button" className="icon-button" title="Close connection dialog" disabled={busy} onClick={onClose}><X size={18}/></button></div>
    <div className="engine-options">{(['sqlserver', 'postgres'] as const).map(engine => <button key={engine} type="button" className={c.engine === engine ? 'chosen' : ''} onClick={() => patch({ engine, port: engine === 'postgres' ? 5432 : 1433, database: engine === 'postgres' ? 'postgres' : 'master', username: engine === 'postgres' ? 'postgres' : 'sa' })}><Database size={19}/>{engine === 'postgres' ? 'PostgreSQL' : 'SQL Server'}</button>)}</div>
    <details><summary>Paste a SQL Server connection string</summary><label>Connection string<input type="password" autoComplete="off" spellCheck={false} placeholder="Server=localhost;Database=master;User Id=sa;Password=...;" value={connectionString} onChange={e => setConnectionString(e.target.value)}/></label><button type="button" className="secondary-button" disabled={busy || !connectionString.trim()} onClick={importConnectionString}>Fill connection details</button></details>
    <label>Connection name<input autoFocus required placeholder="Local development" value={c.name} onChange={e => patch({ name: e.target.value })}/></label>
    <div className="form-row"><label>Host<input required value={c.host} onChange={e => patch({ host: e.target.value })}/></label><label className="port">Port<input type="number" min="1" max="65535" required value={c.port} onChange={e => patch({ port: Number(e.target.value) })}/></label></div>
    <label>Initial database<input required value={c.database} onChange={e => patch({ database: e.target.value })}/></label>
    <div className="form-row"><label>Username<input required autoComplete="username" value={c.username} onChange={e => patch({ username: e.target.value })}/></label><label>Password<input type="password" autoComplete="current-password" placeholder={initial ? 'Leave blank to keep saved password' : ''} value={password} onChange={e => { setPassword(e.target.value); setMessage(''); }}/></label></div>
    <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/>Remember password in system credential store</label>
    <div className="tls-options"><label className="check"><input type="checkbox" checked={c.tls} onChange={e => patch({ tls: e.target.checked })}/>Use TLS encryption</label><label className="check"><input type="checkbox" disabled={!c.tls} checked={c.trustCertificate} onChange={e => patch({ trustCertificate: e.target.checked })}/>Trust self-signed certificate</label></div>
    <p className="muted">Password authentication. Settings stay on this device.</p>{message && <div className={'form-message ' + (ok ? 'success' : 'error')} role="status">{message}</div>}
    <div className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(true)}>{busy ? <LoaderCircle size={14} className="spin"/> : <Terminal size={14}/>}Test connection</button><button className="primary-button" disabled={busy} type="submit">{initial ? 'Save connection' : 'Add connection'}<ChevronRight size={14}/></button></div>
  </form></div></DialogBoundary>;
}
