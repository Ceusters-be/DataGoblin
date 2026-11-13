import { Select } from './Select';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { compareValues, type ColumnFilter, type FilterOperator } from './resultFilters';
import type { ValueChoices } from './types';
import { Search } from 'lucide-react';

export function ColumnFilterMenu({ name, initial, values, anchor, onApply, onSelect, onClear, onClose, loadChoices, scope = "local", onScopeChange, databaseDisabled, onViewSql }: {
  onViewSql?: () => void;
  scope?: "local" | "database"; onScopeChange?: (scope: "local" | "database") => void; databaseDisabled?: boolean;
  loadChoices?: (search: string) => Promise<ValueChoices>;
  name: string; initial?: ColumnFilter; values: (string | null)[]; anchor: HTMLButtonElement;
  onApply: (filter: ColumnFilter) => void; onSelect: (values: (string | null)[]) => void; onClear: () => void; onClose: () => void;
}) {
  const [operator, setOperator] = useState<FilterOperator>(initial?.operator === 'in' ? 'contains' : initial?.operator ?? 'contains');
  const [value, setValue] = useState(initial?.value ?? '');
  const [search, setSearch] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const allCheck = useRef<HTMLInputElement>(null);
  const initialSelected = useMemo(() => new Set(initial?.operator === 'in' ? initial.values : []), [initial]);
  const [draft, setDraft] = useState(initialSelected);
  const selected = loadChoices ? draft : initialSelected;
  const [remote, setRemote] = useState<ValueChoices>({ values: [], hasMore: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!loadChoices) return;
    let active = true; setLoading(true); setError('');
    const timer = setTimeout(() => { void loadChoices(search).then(result => { if (active) setRemote(result); }).catch(error => { if (active) { setError(String(error)); setRemote({ values: [], hasMore: false }); } }).finally(() => { if (active) setLoading(false); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [loadChoices, search]);
  function select(values: (string | null)[]) { if (loadChoices) setDraft(new Set(values)); else onSelect(values); }
  const choices = useMemo(() => {
    const counts = new Map<string | null, number>();
    if (loadChoices) { for (const item of remote.values) counts.set(item.value, item.count); }
    else for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    for (const value of selected) if (!counts.has(value)) counts.set(value, 0);
    return [...counts].sort(([a], [b]) => compareValues(a, b)).filter(([value]) => (value === null ? 'NULL' : value === '' ? '(empty string)' : value).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  }, [values, search, selected, remote, loadChoices]);
  const allSelected = choices.length > 0 && choices.every(([value]) => selected.has(value));
  useEffect(() => { if (allCheck.current) allCheck.current.indeterminate = !allSelected && choices.some(([value]) => selected.has(value)); }, [choices, allSelected, selected]);
  useEffect(() => { setScrollTop(0); if (list.current) list.current.scrollTop = 0; }, [search]);
  const start = Math.max(0, Math.min(choices.length - 1, Math.floor(scrollTop / 28) - 4));
  const end = Math.min(choices.length, start + 22);
  function toggle(value: string | null) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value); else next.add(value);
    select([...next]);
  }
  const menu = useRef<HTMLFormElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: Math.max(0, window.innerHeight - 16) });
  function positionMenu() {
    const element = menu.current;
    if (!element) return;
    const anchorRect = anchor.getBoundingClientRect();
    const maxHeight = Math.max(0, window.innerHeight - 16);
    const height = Math.min(element.getBoundingClientRect().height, maxHeight);
    const width = Math.min(element.getBoundingClientRect().width || 360, Math.max(0, window.innerWidth - 16));
    const next = { left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(anchorRect.bottom + 6, window.innerHeight - height - 8)), maxHeight };
    setPosition(current => current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next);
  }
  useLayoutEffect(() => {
    positionMenu();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionMenu);
    if (menu.current) observer?.observe(menu.current);
    window.addEventListener('resize', positionMenu);
    return () => { observer?.disconnect(); window.removeEventListener('resize', positionMenu); };
  }, [anchor]);
  useLayoutEffect(positionMenu, [operator, choices.length]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [anchor, onClose]);
  return createPortal(<form className="column-filter-menu value-filter-menu" ref={menu} role="dialog" aria-label={'Filter ' + name}
    style={position}
    onSubmit={event => { event.preventDefault(); if (menu.current?.querySelector('details')?.open) onApply({ operator, value }); }}>
    {onScopeChange && <div className="filter-scope" role="group" aria-label="Filter scope"><button type="button" aria-pressed={scope === 'local'} onClick={() => onScopeChange('local')}>Local</button><button type="button" disabled={databaseDisabled} aria-pressed={scope === 'database'} onClick={() => onScopeChange('database')}>Database</button></div>}
    {scope === "database" && onViewSql && <button type="button" onClick={onViewSql}>View SQL</button>}
    <strong>{loadChoices ? 'Database' : 'Local'} Filter For '{name}'</strong>
    {loading && <small role="status">Loading values…</small>}
    {error && <small role="alert">{error}</small>}
    {loadChoices && remote.hasMore && <small>First 100 values · refine your search for more</small>}
    <div className="value-filter-search"><Search size={14}/><input autoFocus onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} aria-label="Search filter values" value={search} onChange={event => setSearch(event.target.value)}/></div>
    <div className="value-filter-head"><label><input ref={allCheck} type="checkbox" aria-label="Select all matching values" disabled={!choices.length} checked={allSelected} onChange={() => {
      const next = new Set(selected);
      for (const [value] of choices) { if (allSelected) next.delete(value); else next.add(value); }
      select([...next]);
    }}/>Value</label><span>Count</span></div>
    <div className="value-filter-list" ref={list} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      {start > 0 && <div aria-hidden="true" style={{ height: start * 28 }}/>}
      {choices.slice(start, end).map(([value, count]) => <label className="value-filter-row" key={value === null ? 'null' : 'text:' + value} title={value === null ? 'NULL (no value)' : value === '' ? 'Empty string' : value}>
        <input type="checkbox" aria-label={value === null ? 'Select NULL (no value)' : value === '' ? 'Select empty string' : 'Select value ' + value} checked={selected.has(value)} onChange={() => toggle(value)}/>
        <span className={value === null ? 'filter-null-value' : ''}>{value === null ? 'NULL' : value === '' ? '(empty string)' : value}</span><span className="value-filter-count">{count.toLocaleString()}</span>
      </label>)}
      {end < choices.length && <div aria-hidden="true" style={{ height: (choices.length - end) * 28 }}/>}
      {!choices.length && <div className="value-filter-empty">No matching values</div>}
    </div>
    <div className="value-filter-footer"><small>{loadChoices ? `${selected.size} selected · database rows` : selected.size ? `${selected.size} selected · loaded rows only` : 'Select a checkbox to filter loaded rows'}</small><button type="button" aria-label="Clear selected values" onClick={() => select([])}>Clear</button></div>
    {loadChoices && <button type="button" className="primary-button" disabled={loading || !!error} onClick={() => { onSelect([...selected]); onClose(); }}>Apply selection</button>}
    <details className="advanced-column-filter" onToggle={positionMenu}><summary>Advanced condition</summary>
    <label>Condition<Select label="Filter condition" value={operator} onChange={value => setOperator(value as FilterOperator)} options={
      Object.entries({ contains: 'Contains', equals: 'Equals', notEquals: 'Does not equal', startsWith: 'Starts with', endsWith: 'Ends with', greater: 'Greater than', less: 'Less than', isNull: 'Is NULL', notNull: 'Is not NULL', isEmpty: 'Is empty string' }).map(([value, label]) => ({ value, label }))}/></label>
    {!['isNull', 'notNull', 'isEmpty'].includes(operator) && <label>Value<input aria-label="Filter value" value={value} onChange={event => setValue(event.target.value)}/></label>}
    <small>{loadChoices ? "Filters the database. Comparisons use database types and collation." : "Filters loaded rows on this page. Text matching ignores case."}</small>
    <div><button className="secondary-button" type="button" onClick={onClear}>Clear</button><button className="primary-button" type="submit">Apply</button></div>
    </details>
  </form>, document.body);
}
