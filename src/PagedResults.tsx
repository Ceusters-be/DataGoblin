import type { OutputEvent } from './QueryOutput';
import { editingPage } from './useGridEditing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { ResultsGrid } from './ResultsGrid';
import type { QueryResult, ResultPage, ResultSet, TableBrowser, ValueChoices, Engine, ForeignReference } from './types';

export function defaultPageSize() {
  try {
    const saved = Number(localStorage.getItem('datagoblin.pageSize') ?? 500);
    return Number.isInteger(saved) && saved >= 0 && saved <= 10000 ? saved : 500;
  } catch { return 500; }
}

export function PagedResults({ data, cacheId, setIndex, truncated, onExport, initialSize = 500, closed = false, onUpdate, onBusy, onReference, engine, browser, onBrowse, browserBusy, onReload, onEditingChange, onCancel, cancellable, refreshInterval, onRefreshInterval, onLog, logDatabase }: {
  onLog?: (event: OutputEvent) => void; logDatabase?: string;
  onCancel?: () => void; cancellable?: boolean; refreshInterval?: number; onRefreshInterval?: (seconds: number) => void;
  onReload?: () => Promise<void>; onEditingChange?: (dirty: boolean) => void;
  onReference?: (reference: ForeignReference, column: string, rowIndex: number) => void; engine?: Engine; browser?: TableBrowser | null; onBrowse?: (filters: TableBrowser["filters"], sort: TableBrowser["sort"]) => void; browserBusy?: boolean;
  data: ResultSet; cacheId?: string | null; setIndex: number; truncated: boolean;
  onExport: (rows: ResultSet['rows']) => Promise<void>;
  initialSize?: number; closed?: boolean; onUpdate?: (result: QueryResult) => void; onBusy?: (busy: boolean) => void;
}) {
  const loadValues = useCallback((column: string, search: string) => invoke<ValueChoices>("table_values", { cacheId, column, search }), [cacheId]);
  const [page, setPage] = useState(() => editingPage(cacheId) ?? { offset: 0, size: initialSize, rows: data.rows });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [menu, setMenu] = useState(false);
  const [savedSize, setSavedSize] = useState(defaultPageSize);
  const [menuPosition, setMenuPosition] = useState({ left: 0, bottom: 0, maxHeight: 300 });
  const menuRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [custom, setCustom] = useState(false);
  const [customSize, setCustomSize] = useState('500');
  const generation = useRef(0);
  const [total, setTotal] = useState(data.totalRows ?? data.rows.length);
  const [hasMore, setHasMore] = useState(data.hasMore ?? false);
  const [countedTotal, setCountedTotal] = useState<number | null>(null);
  async function load(offset: number, size: number) {
    if (closed || busy || browserBusy || editing) return;
    setMenu(false);
    const request = ++generation.current;
    const started = performance.now();
    setBusy(true); onBusy?.(true); setError(''); setStatus('');
    try {
      if (!Number.isInteger(size) || size < 0 || size > 10000) throw new Error('Choose a page size between 1 and 10,000.');
      const response = cacheId
        ? await invoke<ResultPage>('result_page', { cacheId, setIndex, offset, pageSize: size })
        : { rows: data.rows.slice(offset, size === 0 ? undefined : offset + size), totalRows: data.rows.length, hasMore: false };
      if (request === generation.current) {
        const duration = Math.round(performance.now()-started);
        onLog?.({kind:'success',text:`${response.rows.length} rows retrieved starting from ${offset+1} in ${duration} ms${cacheId ? ' · Result page' : ' · Local page'}`,duration});
        setPage({ offset, size, rows: response.rows });
        setCustom(false);
        setTotal(response.totalRows ?? total); setHasMore(response.hasMore ?? false);
        if (!response.hasMore && !response.result?.truncated) setCountedTotal(null);
        if (response.result) onUpdate?.(response.result);
      }
    } catch (error) {
      if (request === generation.current) { const text=error instanceof Error ? error.message : String(error); setError(text); onLog?.({kind:'error',text,duration:Math.round(performance.now()-started)}); }
    } finally { if (request === generation.current) { setBusy(false); onBusy?.(false); } }
  }
  async function countRows() {
    if (!cacheId || closed || busy || browserBusy || editing) return;
    const request = ++generation.current;
    const started = performance.now();
    setBusy(true); onBusy?.(true); setError(''); setStatus('');
    try {
      const count = await invoke<number>('result_count', { cacheId, setIndex });
      if (request === generation.current) { setCountedTotal(count); const duration=Math.round(performance.now()-started); onLog?.({kind:'success',text:`Count completed: ${count} rows in ${duration} ms`,duration}); }
    } catch (error) {
      if (request === generation.current) { const text=error instanceof Error ? error.message : String(error); setError(text); onLog?.({kind:'error',text,duration:Math.round(performance.now()-started)}); }
    } finally { if (request === generation.current) { setBusy(false); onBusy?.(false); } }
  }
  useEffect(() => {
    const size = defaultPageSize();
    if (size !== initialSize || (!cacheId && data.rows.length > initialSize)) void load(0, size);
    return () => { generation.current++; onBusy?.(false); };
  }, []);
  function closeMenu() { setMenu(false); trigger.current?.focus(); }
  function openMenu() {
    if (menu) { closeMenu(); return; }
    const rect = trigger.current!.getBoundingClientRect();
    setMenuPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 198)), bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(100, rect.top - 16) });
    setMenu(true); setCustom(false);
  }
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(); } };
    const resize = () => setMenu(false);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', resize); };
  }, [menu]);
  const range = total === 0 ? '0' : `${page.offset + 1}–${page.offset + page.rows.length}`;
  const displayTotal = countedTotal ?? total;
  const unknown = countedTotal === null && (truncated || hasMore);
  const totalLabel = `of ${displayTotal.toLocaleString()}${unknown ? '+' : ''}`;
  const last = page.size === 0 ? 0 : Math.max(0, Math.floor(((truncated ? total : displayTotal) - 1) / page.size) * page.size);
  const presets = [10, 100, 250, 500, 1000];
  return <div className="paged-results">
    <div className="pagination" role="group" aria-label="Result pages">
      <button className="icon-button" title="First page" disabled={closed || busy || browserBusy || editing || page.offset === 0} onClick={() => void load(0, page.size)}><ChevronsLeft size={16}/></button>
      <button className="icon-button" title="Previous page" disabled={closed || busy || browserBusy || editing || page.offset === 0} onClick={() => void load(Math.max(0, page.offset - page.size), page.size)}><ChevronLeft size={16}/></button>
      <div className="pager-readout" aria-label={range + ' ' + totalLabel} aria-live="polite">
        <button ref={trigger} className="page-range" aria-label="Page size" aria-haspopup="menu" aria-expanded={menu} disabled={closed || busy || browserBusy || editing} onClick={openMenu} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!menu) openMenu(); } }}>{range}<ChevronDown size={12}/></button>
        <button className="row-count" aria-label="Count all rows" title={unknown ? 'Run a separate table COUNT query' : 'Total rows'} disabled={closed || busy || browserBusy || editing || !unknown} onClick={() => void countRows()}>{totalLabel}</button>
      </div>
      <button className="icon-button" title="Next page" disabled={closed || busy || browserBusy || editing || (!hasMore && page.offset >= last)} onClick={() => void load(page.offset + page.size, page.size)}><ChevronRight size={16}/></button>
      <button className="icon-button" title={unknown ? "Last page (total not known yet)" : "Last page"} disabled={closed || busy || browserBusy || editing || unknown || page.offset >= last} onClick={() => void load(last, page.size)}><ChevronsRight size={16}/></button>


    </div>
    {menu && createPortal(<div ref={menuRef} className="page-size-menu" role="menu" aria-label="Page size options" style={menuPosition} onKeyDown={event => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Tab') { setMenu(false); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
      <div className="page-menu-heading">Page Size</div>
      {[...presets, ...(!presets.includes(page.size) && page.size !== 0 ? [page.size] : []), 0].map(size => <button role="menuitemradio" aria-checked={page.size === size} key={size} onClick={() => { closeMenu(); void load(0, size); }}>
        {page.size === size ? <Check size={13}/> : <span className="menu-check-space"/>}{size === 0 ? 'All' : size.toLocaleString()}{savedSize === size && <span className="page-menu-default">Default</span>}
      </button>)}
      <button role="menuitem" onClick={() => { setCustom(true); setCustomSize(String(page.size || 500)); }}>Custom…</button>
      {custom && <div className="custom-page-size"><input autoFocus aria-label="Custom page size" type="number" min="1" max="10000" value={customSize} onChange={event => setCustomSize(event.target.value)}/><button onClick={() => {
        const size = Number(customSize);
        if (!Number.isInteger(size) || size < 1 || size > 10000) { setError('Choose a page size between 1 and 10,000.'); return; }
        closeMenu(); void load(0, size);
      }}>Apply</button></div>}
      <button role="menuitem" className="save-page-default" onClick={() => {
        try { localStorage.setItem('datagoblin.pageSize', String(page.size)); setSavedSize(page.size); setStatus('Default page size saved.'); closeMenu(); }
        catch { setError('Could not save the default page size.'); }
      }}>Set as default</button>
    </div>, document.body)}
    {status && <span className="sr-only" role="status">{status}</span>}
    {closed && !browserBusy && <div className="banner info">Result session closed. Run the query again to fetch more rows.</div>}
    {error && <div className="banner error" role="alert">{error}</div>}
    <ResultsGrid onLog={onLog} logDatabase={logDatabase} onCancel={onCancel} cancellable={cancellable || busy} refreshInterval={refreshInterval} onRefreshInterval={onRefreshInterval} onReload={onReload} onEditDirty={dirty => { setEditing(dirty); onBusy?.(dirty); onEditingChange?.(dirty); }} cacheId={!closed && setIndex === 0 ? cacheId : null} onReference={onReference} engine={engine} browser={browser} onBrowse={onBrowse} browserBusy={browserBusy || busy} loadValues={loadValues} data={{ ...data, rows: page.rows, pageSize: page.size }} rowOffset={page.offset} onExport={onExport}/>
  </div>;
}
