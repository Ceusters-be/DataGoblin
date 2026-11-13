import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { foldGutter, foldKeymap, foldAll, unfoldAll } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { Copy, Search, X } from 'lucide-react';
import { editorAppearance } from './editorAppearance';
import { useTheme } from './theme';
import { formatCellJson } from './cellValue';

export function CellValueViewer({ value, column, row, onClose }: { value: string | null; column: string; row: number; onClose: () => void }) {
  const { dark } = useTheme();
  const formatted = useMemo(() => value === null ? null : formatCellJson(value), [value]);
  const [raw, setRaw] = useState(false);
  const [message, setMessage] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const view = useRef<EditorView | null>(null);
  const text = value === null ? '' : !raw && formatted !== null ? formatted : value;
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => {
    if (!host.current || value === null || value === '') return;
    const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: text, extensions: [
      EditorState.readOnly.of(true), EditorView.editable.of(false),
      EditorView.contentAttributes.of({ 'aria-label': 'Cell value', tabindex: '0' }),
      lineNumbers(), EditorView.lineWrapping,
      ...(formatted !== null ? [json(), foldGutter()] : []),
      search({ top: true }), keymap.of([...searchKeymap, ...foldKeymap]),
      editorAppearance(dark),
    ] }) });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, [text, formatted, value, dark]);
  async function copy() {
    try { await navigator.clipboard.writeText(value ?? 'NULL'); setMessage('Original value copied.'); }
    catch { setMessage('Could not access the clipboard. Select the text to copy it manually.'); }
  }
  return <aside className="cell-value-viewer" role="dialog" aria-label="Cell value viewer" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header><div><strong>{column}</strong><small>Row {row} · {value === null ? 'SQL NULL' : value === '' ? 'Empty string' : formatted !== null ? 'JSON' : 'Text'}</small></div><button ref={close} aria-label="Close value viewer" title="Close (Escape)" onClick={onClose}><X size={17}/></button></header>
    <div className="cell-value-actions">
      <button onClick={() => void copy()}><Copy size={13}/>Copy value</button>
      <button disabled={!value} onClick={() => { if (view.current) openSearchPanel(view.current); }}><Search size={13}/>Search</button>
      {formatted !== null && <><button aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? 'Format JSON' : 'Raw text'}</button><button disabled={raw} onClick={() => { if (view.current) foldAll(view.current); }}>Collapse all</button><button disabled={raw} onClick={() => { if (view.current) unfoldAll(view.current); }}>Expand all</button></>}
    </div>
    {value === null && <p className="cell-value-empty">NULL — no value</p>}
    {value === '' && <p className="cell-value-empty">Empty string — 0 characters</p>}
    <div className="cell-value-content" ref={host}/>
    <div className="cell-value-status" role="status">{message || 'Read-only · Copy value copies the original text'}</div>
  </aside>;
}
