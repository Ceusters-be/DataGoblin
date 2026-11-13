import type { OutputEvent } from './QueryOutput';
import { ResultToolbar } from './ResultToolbar';
import { useGridEditing } from './useGridEditing';
import { ContextMenu, menuPosition, type MenuPosition } from './ContextMenu';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Copy, Filter, KeyRound, Link2, Columns2, LoaderCircle } from 'lucide-react';
import type { ResultSet, TableBrowser, ValueChoices, Engine, ForeignReference } from './types';
import { ReferencePicker } from './ReferencePicker';
import { CellValueViewer } from './CellValueViewer';
import { SqlPreview } from './SqlPreview';
import { ColumnFilterMenu } from './ColumnFilterMenu';
import { compareValues as compare, matchesFilter, type ColumnFilter } from './resultFilters';

const GRID_ROW_HEIGHT = 27;
const ROW_NUMBER_WIDTH = 40;

export function ResultsGrid({ data, onExport, rowOffset = 0, cacheId, onReference, engine = "postgres", browser, onBrowse, browserBusy, loadValues, onEditDirty, onReload, onCancel, cancellable, refreshInterval, onRefreshInterval, onLog, logDatabase }: { onLog?: (event: OutputEvent) => void; logDatabase?: string; onCancel?: () => void; cancellable?: boolean; refreshInterval?: number; onRefreshInterval?: (seconds: number) => void; onEditDirty?: (dirty: boolean) => void; onReload?: () => Promise<void>; cacheId?: string | null; onReference?: (reference: ForeignReference, column: string, rowIndex: number) => void; engine?: Engine; browser?: TableBrowser | null; onBrowse?: (filters: TableBrowser["filters"], sort: TableBrowser["sort"]) => void; browserBusy?: boolean; loadValues?: (column: string, search: string) => Promise<ValueChoices>; data: ResultSet; rowOffset?: number; onExport: (rows: ResultSet['rows']) => Promise<void> }) {
  const editing = useGridEditing({ cacheId, data, rowOffset, blocked: browserBusy, enabled: !!cacheId && !!browser && !!onReload, engine, onDirty: onEditDirty, onReload, onMove: moveCell, onLog, logDatabase });
  const externalBusy = browserBusy;
  browserBusy = browserBusy || editing.dirty;
  type Cell = { row: number; column: number };
  const anchor = useRef<Cell | null>(null);
  const [range, setRange] = useState<{ start: Cell; end: Cell } | null>(null);
  function selectCell(row: number, column: number, extend = false) {
    const cell = { row, column };
    if (extend && anchor.current) setRange({ start: anchor.current, end: cell });
    else { anchor.current = cell; setRange(null); }
    setSelection(cell);
  }
  const pendingFocus = useRef<{ row: number; column: number } | null>(null);
  function moveCell(row: number, column: number, key: string, shift = false) {
    let r = rows.findIndex(item => item.index === row), c = column;
    if (r < 0) return;
    if (key === 'Tab') { c += shift ? -1 : 1; if (c >= data.columns.length) { c = 0; r++; } else if (c < 0) { c = data.columns.length - 1; r--; } }
    else if (key === 'ArrowDown') r++;
    else if (key === 'ArrowUp') r--;
    else if (key === 'ArrowRight') c++;
    else if (key === 'ArrowLeft') c--;
    else if (key === 'Home') c = 0;
    else if (key === 'End') c = data.columns.length - 1;
    r = Math.max(0, Math.min(rows.length - 1, r)); c = Math.max(0, Math.min(data.columns.length - 1, c));
    const target = { row: rows[r].index, column: c }; pendingFocus.current = target;
    selectCell(target.row, target.column);
    if (virtual && (r < start || r >= end) && scroll.current) { scroll.current.scrollTop = r * GRID_ROW_HEIGHT; setScrollTop(r * GRID_ROW_HEIGHT); }
  }
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const node = scroll.current?.querySelector<HTMLElement>(`td[data-row="${target.row}"][data-column="${target.column}"]`);
    if (node) { pendingFocus.current = null; node.focus(); node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  });
  const [cellMenu, setCellMenu] = useState<{ position: MenuPosition; row: number; column: number; displayRow: number } | null>(null);
  useEffect(() => { setCellMenu(null); }, [data, rowOffset]);
  const [localSort, setSort] = useState<{ column: number; descending: boolean } | null>(null);
  const [localFilters, setLocalFilters] = useState<Record<number, ColumnFilter>>({});
  const [filterScope, setFilterScope] = useState<"local" | "database">("local");
  const databaseFilters = useMemo(() => Object.fromEntries((browser?.filters ?? []).map(f => [data.columns.indexOf(f.column), f])), [browser, data.columns]);
  const filters = filterScope === "database" && browser ? databaseFilters : localFilters;
  const sort = useMemo(() => browser ? browser.sort ? { column: data.columns.indexOf(browser.sort.column), descending: browser.sort.descending } : null : localSort, [browser, data.columns, localSort]);
  const [referenceCell, setReferenceCell] = useState<{ column: string; index: number } | null>(null);
  const [cellViewer, setCellViewer] = useState<{ value: string | null; column: string; row: number } | null>(null);
  const viewerOrigin = useRef<HTMLElement | null>(null);
  function closeCellViewer() { setCellViewer(null); if (viewerOrigin.current?.isConnected) viewerOrigin.current.focus(); }
  function openCellViewer(value: string | null, column: number, row: number, origin: HTMLElement) {
    viewerOrigin.current = origin; setCellViewer({ value, column: data.columns[column], row });
  }
  const [inspect, setInspect] = useState(false);
  function setFilters(update: Record<number, ColumnFilter> | ((current: Record<number, ColumnFilter>) => Record<number, ColumnFilter>)) {
    if (filterScope === "database" && browserBusy) return;
    const next = typeof update === 'function' ? update(filters) : update;
    if (browser && filterScope === "database") onBrowse?.(Object.entries(next).map(([column, f]) => ({ ...f, column: data.columns[Number(column)] })), browser.sort);
    else setLocalFilters(next);
  }
  const [filterColumn, setFilterColumn] = useState<number | null>(null);
  const loadChoices = useCallback((search: string) => loadValues!(data.columns[filterColumn!], search), [loadValues, data.columns, filterColumn]);
  const filterAnchor = useRef<HTMLButtonElement | null>(null);
  const closeFilter = () => { setFilterColumn(null); filterAnchor.current?.focus(); };
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [selection, setSelection] = useState<{ row: number; column: number | null } | null>(null);
  const [message, setMessage] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    setReferenceCell(null); setCellViewer(null); setSelection(null); setRange(null); anchor.current = null; setSort(null); setMessage(''); setScrollTop(0);
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [data.rows]);
  useEffect(() => {
    const element = scroll.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const drag = useRef<{ column: number; x: number; width: number } | null>(null);
  const predicates = useMemo(() => Object.entries(localFilters).map(([column, filter]) => {
    const selected = filter.operator === 'in' ? new Set(filter.values) : null;
    return { column: Number(column), test: (value: string | null) => selected ? selected.has(value) : matchesFilter(value, filter) };
  }), [localFilters]);
  const rows = useMemo(() => {
    const values = data.rows.map((original, index) => ({ values: original.map((value, column) => { const change = editing.changeAt(index, column); return change ? change.value : value; }), index })).filter(row => predicates.every(({ column, test }) => test(row.values[column])));
    if (sort && !browser) values.sort((a, b) => {
      const av = a.values[sort.column], bv = b.values[sort.column];
      // NULL stays last in either direction; ties retain database order.
      const order = av === null || bv === null ? compare(av, bv) : compare(av, bv) * (sort.descending ? -1 : 1);
      return order || a.index - b.index;
    });
    return [...values, ...editing.added.map(index => ({ index, values: data.columns.map((_, column) => editing.changeAt(index, column)?.value ?? null) }))];
  }, [data.rows, sort, predicates, browser, editing.changes, editing.added]);
  useEffect(() => { setSelection(null); setRange(null); anchor.current = null; }, [filters]);
  useEffect(() => { setRange(null); anchor.current = null; }, [sort]);
  useLayoutEffect(() => { setScrollTop(0); if (scroll.current) scroll.current.scrollTop = 0; }, [filters, sort]);
  const filterValues = useMemo(() => filterColumn === null ? [] : data.rows
    .filter(row => predicates.every(({ column, test }) => column === filterColumn || test(row[column])))
    .map(row => row[filterColumn]), [data.rows, predicates, filterColumn]);
  const keys = new Map(data.columnKeys?.map(key => [key.name, key]));
  const filterCount = Object.keys(localFilters).length;
  const databaseFilterCount = Object.keys(databaseFilters).length;
  const cycleSort = (column: number) => {
    if (browserBusy) return;
    const next = sort?.column !== column ? { column, descending: false } : !sort.descending ? { column, descending: true } : null;
    if (browser) onBrowse?.(browser.filters, next ? { ...next, column: data.columns[next.column] } : null); else setSort(next);
  };
  const virtual = rows.length > 1000;
  const start = virtual ? Math.max(0, Math.min(rows.length - 1, Math.floor(scrollTop / GRID_ROW_HEIGHT) - 10)) : 0;
  const end = virtual ? Math.min(rows.length, start + Math.ceil(viewportHeight / GRID_ROW_HEIGHT) + 22) : rows.length;
  const defaultWidths = useMemo(() => data.columns.map((name, column) => Math.min(320, Math.max(110, name.length * 8 + 68,
    ...data.rows.slice(0, 50).map(row => Math.min(40, (row[column] ?? 'NULL').length) * 8 + 22)))), [data.columns, data.rows]);
  const width = (column: number) => widths[column] ?? defaultWidths[column];
  const selectedCells = useMemo(() => {
    if (!range) return selection?.column != null ? [{ row: selection.row, column: selection.column }] : [];
    const first = rows.findIndex(r => r.index === range.start.row), last = rows.findIndex(r => r.index === range.end.row);
    if (first < 0 || last < 0) return [];
    const cells: Cell[] = [];
    for (let r = Math.min(first, last); r <= Math.max(first, last); r++) {
      for (let c = Math.min(range.start.column, range.end.column); c <= Math.max(range.start.column, range.end.column); c++) cells.push({ row: rows[r].index, column: c });
    }
    return cells;
  }, [range, selection, rows]);
  const selectedSet = new Set(selectedCells.map(c => `${c.row}:${c.column}`));
  const pasteRows = useRef(data.rows); pasteRows.current = data.rows;
  async function pasteClipboard() {
    const originalRows = data.rows;
    const target = selectedCells;
    try { const text = await navigator.clipboard.readText(); if (pasteRows.current !== originalRows) { setMessage('The displayed page changed. Paste again into the current selection.'); return; } setMessage(editing.paste(target, text)); }
    catch { setMessage('Clipboard access failed. Use Ctrl/Cmd+V on the selected cells.'); }
  }
  async function copy(rowOnly = false, target = selection) {
    const selection = target;
    if (!selection) return;
    const row = (data.rows[selection.row] ?? data.columns.map(() => null)).map((value, column) => { const change = editing.changeAt(selection.row, column); return change ? change.value : value; });
    const value = !rowOnly && selection.column !== null ? row[selection.column] ?? 'NULL'
      : row.map(value => {
        const text = value ?? 'NULL';
        return /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
      }).join('\t');
    try { await navigator.clipboard.writeText(value); setMessage(rowOnly || selection.column === null ? 'Row copied.' : 'Cell copied.'); }
    catch { setMessage('Could not access the clipboard. Try selecting and copying the text manually.'); }
  }
  return <div className="results-grid-container" style={{ '--grid-row-height': `${GRID_ROW_HEIGHT}px` } as CSSProperties} onKeyDownCapture={event => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).closest('[role="dialog"]')) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) editing.requestApply();
  }}>
    <ResultToolbar dirty={editing.dirty} count={editing.pendingCount} busy={!!externalBusy || editing.busy} submitted={editing.submitted} canAdd={editing.canAdd} canDelete={editing.canAdd && (!!selectedCells.length || !!selection)}
      onRefresh={onReload} onCancel={onCancel} cancellable={cancellable} interval={refreshInterval} onInterval={onRefreshInterval}
      onAdd={() => { const row = editing.addRow(); if (row !== undefined) { selectCell(row, 0); pendingFocus.current = { row, column: 0 }; if (scroll.current) { scroll.current.scrollTop = (rows.length + 1) * GRID_ROW_HEIGHT; setScrollTop((rows.length + 1) * GRID_ROW_HEIGHT); } } }}
      onDelete={() => editing.deleteRows(selectedCells.length ? selectedCells.map(c => c.row) : selection ? [selection.row] : [])}
      onRevert={editing.revert} onPreview={editing.inspect} onSubmit={editing.requestApply} onExport={() => void onExport(rows.map(row => row.values))}/>
    <span className="sr-only">{editing.hint}</span>
    {editing.ui}
    {inspect && browser && <div className="generated-sql"><SqlPreview value={browser.sql} engine={engine}/><pre>{browser.parameters.map((value, i) => `${i + 1}: ${JSON.stringify(value)}`).join('\n')}</pre><button onClick={() => setInspect(false)}>Close SQL</button></div>}
    {(message || range) && <div className="grid-feedback" role="status">{message || `${selectedCells.length} cells selected · Ctrl/Cmd+V fills the selection`}</div>}
    {filterCount > 0 && <div className="grid-filter-status"><span>{rows.length} of {data.rows.length} loaded rows match · {filterCount} column {filterCount === 1 ? 'filter' : 'filters'}</span><button onClick={() => setLocalFilters({})}>Clear filters</button></div>}
    {databaseFilterCount > 0 && <div className="grid-filter-status"><span>{databaseFilterCount} database {databaseFilterCount === 1 ? "filter" : "filters"} active</span><button disabled={browserBusy} onClick={() => onBrowse?.([], browser!.sort)}>Clear database filters</button></div>}
    {data.keyMetadataError && <span className="key-metadata-note" title={data.keyMetadataError}>Key metadata unavailable</span>}
    {filterColumn !== null && filterAnchor.current && <ColumnFilterMenu onViewSql={browser ? () => { setInspect(true); closeFilter(); } : undefined} scope={filterScope} onScopeChange={browser && loadValues ? setFilterScope : undefined} databaseDisabled={browserBusy} loadChoices={filterScope === "database" && browser && loadValues ? loadChoices : undefined} key={filterColumn + ":" + filterScope} name={data.columns[filterColumn]} initial={filters[filterColumn]} values={filterValues} onSelect={values => setFilters(current => { const next = { ...current }; if (values.length) next[filterColumn] = { operator: 'in', value: '', values }; else delete next[filterColumn]; return next; })} anchor={filterAnchor.current} onClose={closeFilter} onApply={filter => { setFilters(current => ({ ...current, [filterColumn]: filter })); closeFilter(); }} onClear={() => { setFilters(current => { const next = { ...current }; delete next[filterColumn]; return next; }); closeFilter(); }}/>}
    <div className="grid-viewport" aria-busy={!!externalBusy}>
    <div className="grid-scroll" onPaste={event => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault(); setMessage(editing.paste(selectedCells, event.clipboardData.getData('text/plain')));
    }} ref={scroll} onScroll={event => { if (virtual) setScrollTop(event.currentTarget.scrollTop); }} onKeyDown={event => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) { event.preventDefault(); void copy(); }
    }}>
      <table className="result-grid interactive-grid" style={{ width: ROW_NUMBER_WIDTH + data.columns.reduce((total, _, column) => total + width(column), 0) }}>
        <colgroup><col style={{ width: ROW_NUMBER_WIDTH }}/>{data.columns.map((_, column) => <col key={column} style={{ width: width(column) }}/>)}</colgroup>
        <thead><tr><th scope="col">#</th>{data.columns.map((name, column) => <th key={column} scope="col" aria-sort={sort?.column === column ? sort.descending ? 'descending' : 'ascending' : 'none'}>
          <div className="result-column-heading">
            <span className="column-key-icons">
              {keys.get(name)?.primaryKey && <span role="img" aria-label="Primary key" title="Primary key" className="primary-key"><KeyRound size={13}/></span>}
              {keys.get(name)?.foreignKey && <span role="img" aria-label="Foreign key" title="Foreign key" className="foreign-key"><Link2 size={13}/></span>}
              {!keys.get(name)?.primaryKey && !keys.get(name)?.foreignKey && <Columns2 size={13} aria-hidden="true"/>}
            </span>
            <button disabled={!!browser && browserBusy} className="column-name" title={name} onClick={() => cycleSort(column)}>{name}</button>
            <button className={'column-filter-button' + (localFilters[column] || databaseFilters[column] ? ' active' : '')} title={'Filter ' + name} aria-label={'Filter ' + name} aria-pressed={!!localFilters[column] || !!databaseFilters[column]} onClick={event => { filterAnchor.current = event.currentTarget; setFilterColumn(current => current === column ? null : column); }}><Filter size={13}/></button>
            <button disabled={!!browser && browserBusy} className="sort-column" aria-label={'Sort ' + name} title={'Sort by ' + name + ' (ascending, descending, original order)'} onClick={() => cycleSort(column)}>{sort?.column === column ? sort.descending ? <ArrowDown size={13}/> : <ArrowUp size={13}/> : <ChevronsUpDown size={13}/>}</button>
          </div>
          <div className="column-resizer" role="separator" aria-label={'Resize ' + name} aria-orientation="vertical" aria-valuenow={width(column)} aria-valuemin={80} aria-valuemax={1000} tabIndex={0}
            onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidths(current => ({ ...current, [column]: Math.max(80, Math.min(1000, width(column) + (event.key === 'ArrowRight' ? 20 : -20))) })); } }}
            onDoubleClick={() => setWidths(current => ({ ...current, [column]: Math.min(600, data.rows.reduce((maximum, row) => Math.max(maximum, (row[column] ?? 'NULL').length * 8 + 35), Math.max(140, name.length * 8 + 35))) }))}
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { column, x: event.clientX, width: width(column) }; }}
            onPointerMove={event => { const start = drag.current; if (start?.column === column) setWidths(current => ({ ...current, [column]: Math.max(80, Math.min(1000, start.width + event.clientX - start.x)) })); }}
            onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}/>
        </th>)}</tr></thead>
        <tbody>{start > 0 && <tr aria-hidden="true"><td colSpan={data.columns.length + 1} style={{ height: start * GRID_ROW_HEIGHT, padding: 0, border: 0 }}/></tr>}{rows.slice(start, end).map(({ values, index }, visibleIndex) => <tr key={index} className={(selection?.row === index && selection.column === null ? 'selected-row ' : '') + (editing.added.includes(index) ? 'inserted-row ' : '') + (editing.deleted.includes(index + rowOffset) ? 'deleted-row' : '')}>
          <td><button className="row-selector" aria-label={'Select row ' + (rowOffset + start + visibleIndex + 1)} onClick={() => { setRange(null); anchor.current = null; setSelection({ row: index, column: null }); setMessage(''); }}>{rowOffset + start + visibleIndex + 1}</button></td>
          {values.map((value, column) => <td key={column} data-row={index} data-column={column} tabIndex={0} aria-selected={selectedSet.has(`${index}:${column}`)} onMouseDown={event => { if (event.shiftKey && event.button === 0) event.preventDefault(); }} onContextMenu={event => { event.preventDefault(); if (!selectedSet.has(`${index}:${column}`)) selectCell(index, column); setCellMenu({ position: menuPosition(event), row: index, column, displayRow: rowOffset + start + visibleIndex + 1 }); }} onDoubleClick={event => { if (!editing.open(index, column)) openCellViewer(value, column, rowOffset + start + visibleIndex + 1, event.currentTarget); }} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const origin = event.currentTarget; const rect = origin.getBoundingClientRect(); setCellMenu({ position: { x: rect.left, y: rect.bottom, origin }, row: index, column, displayRow: rowOffset + start + visibleIndex + 1 }); } else if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); if (!editing.open(index, column)) openCellViewer(value, column, rowOffset + start + visibleIndex + 1, event.currentTarget); }
            else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Home','End'].includes(event.key)) { event.preventDefault(); moveCell(index, column, event.key, event.shiftKey); }
            else if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && (event.key.length === 1 || event.key === 'Backspace')) { if (editing.open(index, column, event.key === 'Backspace' ? '' : event.key)) event.preventDefault(); }
          }} className={(selectedSet.has(`${index}:${column}`) ? 'selected-cell ' : '') + (editing.changeAt(index, column) ? 'edited-cell ' : '') + (editing.active(index, column) ? 'editing-cell' : '')} title={editing.active(index, column) ? undefined : value ?? 'NULL (no value)'} onFocus={() => { setSelection({ row: index, column }); setMessage(''); }} onClick={event => selectCell(index, column, event.shiftKey)}>
            {value !== null && keys.get(data.columns[column])?.foreignKey && cacheId && onReference && <button className="foreign-key-link" disabled={browserBusy} title={'Open related record for ' + data.columns[column]} aria-label={'Open related record for ' + data.columns[column] + ' row ' + (rowOffset + start + visibleIndex + 1)} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setReferenceCell({ column: data.columns[column], index: index + rowOffset }); }}><Link2 size={13}/></button>}
            {editing.inline(index, column) ?? (editing.placeholder(index, column) && !editing.changeAt(index, column) ? <span className="draft-placeholder">{editing.placeholder(index, column)}</span> : editing.changeAt(index, column) ? <span className="edited-value">{editing.changeAt(index, column)!.value === null ? <span className="null-value">NULL</span> : editing.changeAt(index, column)!.value === '' ? <span className="empty-value">empty</span> : editing.changeAt(index, column)!.value}</span> : value === null ? <span className="null-value">NULL</span> : value === '' ? <span className="empty-value" aria-label="Empty string">empty</span> : value)}
          </td>)}
        </tr>)}{end < rows.length && <tr aria-hidden="true"><td colSpan={data.columns.length + 1} style={{ height: (rows.length - end) * GRID_ROW_HEIGHT, padding: 0, border: 0 }}/></tr>}</tbody>
      </table>
      {!rows.length && <div className="muted padded">{filterCount ? 'No rows match the filters on this page.' : 'Query returned no rows.'}</div>}
    </div>
    {externalBusy && <div className="grid-loading-overlay" role="status" aria-label="Loading results"><LoaderCircle size={28} className="spin" aria-hidden="true"/><span className="sr-only">Loading results…</span></div>}
    </div>
    {cellMenu && <ContextMenu position={cellMenu.position} label="Result cell actions" onClose={() => setCellMenu(null)} actions={[
      { label: 'Copy cell', icon: <Copy size={14}/>, action: () => void copy(false, cellMenu) },
      { label: 'Paste', disabled: !selectedCells.length || selectedCells.some(c => !editing.editable(c.column, c.row)), action: () => void pasteClipboard() },
      { label: 'Copy row', icon: <Copy size={14}/>, action: () => void copy(true, cellMenu) },
      { label: 'Edit cell', disabled: !editing.editable(cellMenu.column, cellMenu.row), action: () => { editing.open(cellMenu.row, cellMenu.column); } },
      ...(editing.isUuid(cellMenu.column) ? [{ label: 'Generate UUID', disabled: !editing.editable(cellMenu.column, cellMenu.row), action: () => editing.generateUuid(cellMenu.row, cellMenu.column) }] : []),
      ...(editing.isDate(cellMenu.column) ? [{ label: 'Set now', disabled: !editing.editable(cellMenu.column, cellMenu.row), action: () => editing.setNow(cellMenu.row, cellMenu.column) }] : []),
      { label: 'Set NULL', disabled: !editing.editable(cellMenu.column, cellMenu.row), action: () => editing.setNull(cellMenu.row, cellMenu.column) },
      { label: 'View full value', separator: true, action: () => openCellViewer((editing.changeAt(cellMenu.row, cellMenu.column)?.value ?? data.rows[cellMenu.row]?.[cellMenu.column] ?? null), cellMenu.column, cellMenu.displayRow, cellMenu.position.origin) },
      { label: 'Filter locally by this value', icon: <Filter size={14}/>, action: () => setLocalFilters(current => ({ ...current, [cellMenu.column]: { operator: 'in', value: '', values: [(editing.changeAt(cellMenu.row, cellMenu.column)?.value ?? data.rows[cellMenu.row]?.[cellMenu.column] ?? null)] } })) },
      { label: 'Open related records', icon: <Link2 size={14}/>, disabled: browserBusy || !cacheId || !onReference || !keys.get(data.columns[cellMenu.column])?.foreignKey || (editing.changeAt(cellMenu.row, cellMenu.column)?.value ?? data.rows[cellMenu.row]?.[cellMenu.column] ?? null) === null, action: () => setReferenceCell({ column: data.columns[cellMenu.column], index: cellMenu.row + rowOffset }) },
    ]}/>}
    {referenceCell && cacheId && onReference && <ReferencePicker cacheId={cacheId} column={referenceCell.column} onClose={() => setReferenceCell(null)} onOpen={reference => { onReference(reference, referenceCell.column, referenceCell.index); setReferenceCell(null); }}/>}
    {cellViewer && <CellValueViewer key={cellViewer.column + ":" + cellViewer.row} {...cellViewer} onClose={closeCellViewer}/>}
  </div>;
}
