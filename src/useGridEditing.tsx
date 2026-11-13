import { nowForColumn } from './dateCell';
import { sqlEvent, type OutputEvent } from './QueryOutput';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { DialogBoundary } from './DialogBoundary';
import { formatCellJson } from './cellValue';
import { SqlPreview } from './SqlPreview';
import type { Engine, ResultSet } from './types';
type Change = { rowIndex: number; column: string; value: string | null };
type InsertColumn = { name: string; generated: boolean; nullable: boolean; defaultExpression?: string | null; editable: boolean };
const rowDrafts = new Map<string, { added: number[]; deleted: number[] }>();
type Statement = { sql: string; parameters: string[] };
// Keep drafts when another query tab is selected. Cache IDs identify execution snapshots.
const drafts = new Map<string, Change[]>();
const pages = new Map<string, { offset: number; size: number; rows: ResultSet['rows'] }>();
export const editingPage = (cacheId?: string | null) => cacheId ? pages.get(cacheId) : undefined;
export function useGridEditing({ cacheId, data, rowOffset, enabled, blocked, engine, onDirty, onReload, onMove, onLog, logDatabase }: { onLog?: (event: OutputEvent) => void; logDatabase?: string; onMove?: (row: number, column: number, key: string, shift?: boolean) => void; cacheId?: string | null; data: ResultSet; rowOffset: number; enabled: boolean; blocked?: boolean; engine: Engine; onDirty?: (dirty: boolean) => void; onReload?: () => Promise<void> }) {
  const [changes, setChanges] = useState<Change[]>(() => drafts.get(cacheId ?? '') ?? []);
  const [added, setAdded] = useState<number[]>(() => rowDrafts.get(cacheId ?? '')?.added ?? []);
  const [deleted, setDeleted] = useState<number[]>(() => rowDrafts.get(cacheId ?? '')?.deleted ?? []);
  const [insertColumns, setInsertColumns] = useState<InsertColumn[]>([]);
  const nextRow = useRef(Math.max(data.rows.length, ...added.map(r => r + 1)));
  const pendingCount = changes.filter(c => c.rowIndex < data.rows.length + rowOffset).length + added.length + deleted.length;
  const [allowed, setAllowed] = useState<string[]>([]);
  const [dateColumns, setDateColumns] = useState<Record<string, string>>({});
  const [uuidColumns, setUuidColumns] = useState<string[]>([]);
  const [jsonColumns, setJsonColumns] = useState<string[]>([]);
  const closingInline = useRef(false);
  const inspecting = useRef(false);
  const [cellError, setCellError] = useState('');
  const [reason, setReason] = useState('');
  const [cell, setCell] = useState<{ row: number; column: number; text: string; null: boolean; json: boolean; replace: boolean } | null>(null);
  const [preview, setPreview] = useState<Statement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const callback = useRef(onDirty); callback.current = onDirty;
  useEffect(() => {
    let current = true;
    if (enabled && cacheId) void invoke<{ columns: string[]; jsonColumns?: string[]; uuidColumns?: string[]; dateColumns?: Record<string, string>; insertColumns?: InsertColumn[] }>('edit_capabilities', { cacheId }).then(result => { if (current) { setInsertColumns(result?.insertColumns ?? []); setAllowed(result?.columns ?? []); setJsonColumns(result?.jsonColumns ?? []); setUuidColumns(result?.uuidColumns ?? []); setDateColumns(result?.dateColumns ?? {}); setReason(result?.columns.length ? '' : 'No editable columns.'); } }).catch(error => { if (current) setReason(String(error)); });
    return () => { current = false; };
  }, [cacheId, enabled]);
  useEffect(() => {
    if (cacheId) { if (pendingCount) { rowDrafts.set(cacheId, { added, deleted }); drafts.set(cacheId, changes); pages.set(cacheId, { offset: rowOffset, size: data.pageSize ?? 500, rows: data.rows }); } else { drafts.delete(cacheId); pages.delete(cacheId); rowDrafts.delete(cacheId); } }
    callback.current?.(pendingCount > 0 || busy || !!cell);
  }, [changes, added, deleted, busy, cell, cacheId]);
  useEffect(() => {
    if (!pendingCount) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [pendingCount]);
  const editable = (column: number, row?: number) => enabled && !blocked && !busy && !submitted && (row === undefined || !deleted.includes(row + rowOffset)) && (row !== undefined && added.includes(row) ? insertColumns.some(c => c.name === data.columns[column] && c.editable) : allowed.includes(data.columns[column]));
  const original = (row: number, column: number) => data.rows[row]?.[column] ?? null;
  const placeholder = (row: number, column: number) => {
    if (!added.includes(row)) return null;
    const meta = insertColumns.find(c => c.name === data.columns[column]);
    return meta?.generated ? '<generated>' : meta?.defaultExpression != null ? '<default>' : meta?.nullable ? '<null>' : '<required>';
  };
  function payload(pending: Change[]) {
    return { cacheId, changes: pending.filter(c => !added.includes(c.rowIndex - rowOffset)),
      ...(added.length ? { inserts: added.map(row => ({ values: Object.fromEntries(pending.filter(c => c.rowIndex === row + rowOffset).map(c => [c.column, c.value])) })) } : {}),
      ...(deleted.length ? { deletes: deleted } : {}) };
  }
  function revert() { setChanges([]); setAdded([]); setDeleted([]); setCell(null); setPreview(null); setMessage('Changes reverted.'); if (cacheId) { drafts.delete(cacheId); rowDrafts.delete(cacheId); pages.delete(cacheId); } }
  function addRow() {
    if (!enabled || blocked || busy || submitted || !insertColumns.length) return;
    if (pendingCount >= 100) { setMessage('Submit or revert changes first (100 maximum).'); return; }
    const row = Math.max(nextRow.current, data.rows.length); nextRow.current = row + 1; setAdded(current => [...current, row]); setPreview(null); return row;
  }
  function deleteRows(rows: number[]) {
    if (blocked || busy || submitted || !insertColumns.length) return;
    const unique = [...new Set(rows)].filter(r => r >= 0 && (r < data.rows.length || added.includes(r)));
    const next = [...new Set([...deleted, ...unique.filter(r => !added.includes(r)).map(r => r + rowOffset)])];
    if (next.length + added.length + changes.length > 100) { setMessage('Submit or revert changes first (100 maximum).'); return; }
    setAdded(current => current.filter(r => !unique.includes(r))); setDeleted(next);
    setChanges(current => current.filter(c => !unique.includes(c.rowIndex - rowOffset))); setCell(null); setPreview(null);
  }
  const changeMap = useMemo(() => new Map(changes.map(c => [JSON.stringify([c.rowIndex, c.column]), c])), [changes]);
  const changeAt = (row: number, column: number) => changeMap.get(JSON.stringify([row + rowOffset, data.columns[column]]));
  function open(row: number, column: number, initialText?: string) {
    if (!editable(column, row)) return false;
    const value = changeAt(row, column)?.value ?? original(row, column);
    const staged = changeAt(row, column);
    closingInline.current = false; setCellError('');
    const current = staged ? staged.value : value;
    const isJson = jsonColumns.includes(data.columns[column]) || (current != null && /^[\s]*[\[{]/.test(current) && formatCellJson(current) !== null);
    setCell({ row, column, json: isJson, replace: initialText !== undefined, text: initialText ?? (staged ? staged.value : value) ?? '', null: initialText === undefined && (staged ? staged.value : value) === null }); return true;
  }
  function stage(override?: string | null) {
    if (!cell || closingInline.current) return;
    const next = changes.filter(c => c.rowIndex !== cell.row + rowOffset || c.column !== data.columns[cell.column]);
    const value = override !== undefined ? override : cell.null ? null : cell.text;
    if (cell.json && value !== null) { try { JSON.parse(value); } catch { setCellError('Enter valid JSON or set SQL NULL.'); return; } }
    closingInline.current = true;
    const untouchedDefault = added.includes(cell.row) && !changeAt(cell.row, cell.column) && override === undefined && cell.null && cell.text === '';
    if (!untouchedDefault && (added.includes(cell.row) || value !== original(cell.row, cell.column))) next.push({ rowIndex: cell.row + rowOffset, column: data.columns[cell.column], value });
    setChanges(next); setPreview(null); setCell(null); setMessage('');
    return next;
  }
  function validateInserts(pending: Change[]) {
    for (const row of added) for (const col of insertColumns) {
      const change = pending.find(c => c.rowIndex === row + rowOffset && c.column === col.name);
      if (!col.generated && !col.nullable && (change ? change.value === null : col.defaultExpression == null)) {
        setMessage(`${col.name} requires a value in new row ${row + rowOffset + 1}.`); return false;
      }
    }
    return true;
  }
  async function inspect(pending = changes) {
    if ((!pending.length && !added.length && !deleted.length) || busy || submitted || inspecting.current) return;
    if (!validateInserts(pending)) return;
    inspecting.current = true;
    setBusy(true); setMessage('');
    try { setPreview(await invoke<Statement[]>('edit_rows', { ...payload(pending), apply: false })); }
    catch (error) { setMessage(String(error)); }
    finally { inspecting.current = false; setBusy(false); }
  }
  async function apply(pending = changes) {
    if (busy || submitted || inspecting.current) return;
    if (!validateInserts(pending)) return;
    inspecting.current = true;
    setBusy(true); setSubmitted(true); setMessage('');
    const started = performance.now();
    onLog?.({text:`Submitting changes (${new Set(pending.filter(c => !added.includes(c.rowIndex-rowOffset)).map(c => c.rowIndex)).size} updates, ${added.length} inserts, ${deleted.length} deletes)…`});
    try {
      const statements = await invoke<Statement[]>('edit_rows', { ...payload(pending), apply: true });
      const duration = Math.round(performance.now()-started);
      for (const statement of statements) onLog?.(sqlEvent(logDatabase ?? '', statement.sql, statement.parameters));
      onLog?.({kind:'success',text:`${statements.length} ${statements.length === 1 ? 'row' : 'rows'} affected in ${duration} ms · Transaction committed`,duration});
      setChanges([]); setAdded([]); setDeleted([]); rowDrafts.delete(cacheId!); drafts.delete(cacheId!); pages.delete(cacheId!); setPreview(null);
      setMessage('Changes saved. Refreshing results…');
      callback.current?.(false);
      await onReload?.();
    } catch (error) { onLog?.({kind:'error',text:'Submission failed: '+String(error),duration:Math.round(performance.now()-started)}); setMessage(String(error) + ' Reload results before submitting again.'); setPreview(null); }
    finally { inspecting.current = false; setBusy(false); }
  }
  const close = () => { if (!busy) { setCell(null); setPreview(null); } };
  const ui = <>
    {message && <div className="grid-edit-message" role="status">{message}</div>}
    {(cell?.json || preview) && createPortal(<DialogBoundary onClose={close} disabled={busy}><div className="grid-edit-backdrop"><section className="dialog grid-edit-dialog" role="dialog" aria-modal="true" aria-label={cell ? 'Edit JSON' : 'Review changes'}>
      {cell ? <><h2>Edit JSON · {data.columns[cell.column]}</h2><p>Row {rowOffset + cell.row + 1} · Changes are staged until Apply.</p><textarea autoFocus aria-label="Cell value" disabled={cell.null} value={cell.text} onChange={event => setCell({ ...cell, text: event.target.value })}/><label><input type="checkbox" checked={cell.null} onChange={event => setCell({ ...cell, null: event.target.checked })}/>Set SQL NULL</label><button onClick={() => { const formatted = formatCellJson(cell.text); if (formatted !== null) setCell({ ...cell, text: formatted }); else setCellError('Enter valid JSON before formatting.'); }}>Format JSON</button>{cellError && <p role="alert">{cellError}</p>}<div className="dialog-actions"><button onClick={close}>Cancel</button><button className="primary-button" onClick={() => stage()}>Stage change</button></div></> : <><h2>Review changes</h2><p>{preview!.length} rows · Applied together in one transaction.</p><div className="edit-sql-list">{preview!.map((statement, index) => <div key={index}><SqlPreview value={statement.sql} engine={engine}/><pre>{statement.parameters.map((p, i) => `${i + 1}: ${JSON.stringify(p)}`).join('\n')}</pre></div>)}</div><div className="dialog-actions"><button disabled={busy} onClick={close}>Back</button><button className="primary-button" disabled={busy || submitted} onClick={() => void apply()}>{busy ? 'Applying…' : 'Apply changes'}</button></div></>}
    </section></div></DialogBoundary>, document.body)}
  </>;
  function inline(row: number, column: number) {
    if (!cell || cell.json || cell.row !== row || cell.column !== column) return null;
    return <div className="inline-cell-editor" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) stage(); }}>
      <textarea rows={1} autoFocus aria-label="Cell value" placeholder={cell.null ? 'NULL' : ''} value={cell.text} onFocus={event => { if (!cell.replace) event.currentTarget.select(); else event.currentTarget.setSelectionRange(cell.text.length, cell.text.length); }} onChange={event => setCell({ ...cell, text: event.target.value, null: false })} onKeyDown={event => {
        event.stopPropagation();
        const td = event.currentTarget.closest('td')!;
        if (event.ctrlKey && event.key === 'Delete') { event.preventDefault(); stage(null); td.focus(); }
        else if (event.key === 'Escape') { event.preventDefault(); closingInline.current = true; setCell(null); td.focus(); }
        else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); stage(); onMove?.(row, column, 'ArrowDown'); }
        else if (event.key === 'Tab') {
          event.preventDefault();
          stage(); onMove?.(row, column, 'Tab', event.shiftKey);
        }
      }}/>
    </div>;
  }
  function paste(cells: { row: number; column: number }[], value: string, successMessage?: string) {
    if (!cells.length) return 'Select a cell first.';
    if (cells.some(c => !editable(c.column, c.row))) return 'The selection contains read-only cells. Nothing was changed.';
    if (cells.length > 100 || value.length > 1_000_000) return 'Paste up to 100 cells, with at most 1 MB per value.';
    for (const c of cells) {
      const old = changeAt(c.row, c.column)?.value ?? original(c.row, c.column);
      const isJson = jsonColumns.includes(data.columns[c.column]) || (old != null && /^\s*[\[{]/.test(old) && formatCellJson(old) !== null);
      if (isJson) { try { JSON.parse(value); } catch { return 'A selected cell requires valid JSON. Nothing was changed.'; } }
    }
    const next = [...changes];
    for (const c of cells) {
      const at = next.findIndex(change => change.rowIndex === c.row + rowOffset && change.column === data.columns[c.column]);
      if (at >= 0) next.splice(at, 1);
      if (added.includes(c.row) || value !== original(c.row, c.column)) next.push({ rowIndex: c.row + rowOffset, column: data.columns[c.column], value });
    }
    if (next.length > 100) return 'Apply or revert existing changes first; at most 100 changed cells are supported.';
    setChanges(next); setPreview(null); setMessage('');
    return successMessage ?? `Pasted into ${cells.length} ${cells.length === 1 ? 'cell' : 'cells'}. Changes are pending Apply.`;
  }
  const isDate = (column: number) => Object.prototype.hasOwnProperty.call(dateColumns, data.columns[column]);
  function setNow(row: number, column: number) {
    if (!isDate(column) || !editable(column, row)) return;
    setMessage(paste([{ row, column }], nowForColumn(dateColumns[data.columns[column]]), 'Current date/time set. Changes are pending Submit.'));
  }
  const isUuid = (column: number) => uuidColumns.includes(data.columns[column]);
  function generateUuid(row: number, column: number) {
    if (!isUuid(column) || !editable(column, row)) return;
    setMessage(paste([{ row, column }], crypto.randomUUID(), 'UUID generated. Changes are pending Submit.'));
  }
  function setNull(row: number, column: number) {
    if (!editable(column, row)) return;
    const next = changes.filter(c => c.rowIndex !== row + rowOffset || c.column !== data.columns[column]);
    if (added.includes(row) || original(row, column) !== null) next.push({ rowIndex: row + rowOffset, column: data.columns[column], value: null });
    setChanges(next); setPreview(null);
  }
  function requestApply() {
    if (busy || submitted || blocked || inspecting.current || cell?.json) return;
    const pending = cell ? stage() : changes;
    if (pending && (pending.length || added.length || deleted.length)) void apply(pending);
  }
  return { isDate, setNow, isUuid, generateUuid, added, deleted, placeholder, addRow, deleteRows, revert, pendingCount, busy, submitted, canAdd: enabled && !blocked && !busy && !submitted && insertColumns.length > 0, inspect: () => { const pending = cell ? stage() : changes; if (pending) void inspect(pending); }, requestApply, paste, setNull, hint: enabled ? allowed.length ? 'Double-click to edit · Primary keys are read-only' : reason || 'Checking editable columns…' : undefined, active: (row: number, column: number) => cell?.row === row && cell.column === column && !cell.json, inline, open, editable, changeAt, changes, ui, dirty: pendingCount > 0 || !!cell || busy };
}
