import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Clock3, Square, Plus, Minus, Undo2, Eye, ArrowUp, Check, Download } from 'lucide-react';
import { ContextMenu, type MenuPosition } from './ContextMenu';
import { DialogBoundary } from './DialogBoundary';

type Props = {
  dirty: boolean; count: number; busy: boolean; submitted: boolean; canAdd: boolean; canDelete: boolean;
  onRefresh?: () => Promise<void>; onCancel?: () => void; cancellable?: boolean;
  interval?: number; onInterval?: (seconds: number) => void;
  onAdd: () => void; onDelete: () => void; onRevert: () => void; onPreview: () => void; onSubmit: () => void; onExport: () => void;
};
export function ResultToolbar(p: Props) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [dialog, setDialog] = useState<'refresh' | 'interval' | null>(null);
  const [seconds, setSeconds] = useState('30');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const latest = useRef(p); latest.current = p;
  async function refresh(discard = false) {
    const current = latest.current;
    if (!current.onRefresh || current.busy || inFlight.current) return;
    if (current.dirty && !discard) { setDialog('refresh'); return; }
    if (discard) current.onRevert();
    setDialog(null); inFlight.current = true; setRefreshing(true); setError('');
    try { await current.onRefresh(); } catch (e) { setError(String(e)); }
    finally { inFlight.current = false; setRefreshing(false); }
  }
  useEffect(() => {
    if (!p.interval || !p.onRefresh) return;
    const timer = window.setInterval(() => {
      const current = latest.current;
      if (!current.dirty && !current.busy && !current.submitted && !dialog && !menu && document.visibilityState !== 'hidden') void refresh();
    }, p.interval * 1000);
    return () => window.clearInterval(timer);
  }, [p.interval, !!p.onRefresh, dialog, menu]);
  const busy = p.busy || refreshing;
  const close = () => { setDialog(null); setError(''); };
  return <>
    <div className="grid-actions result-toolbar" role="toolbar" aria-label="Result actions">
      <button className="icon-button" title="Refresh results" aria-label="Refresh results" disabled={!p.onRefresh || busy} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? 'spin' : ''}/></button>
      <button className={'icon-button' + (p.interval ? ' active' : '')} title={p.interval ? `Auto-refresh every ${p.interval} seconds${p.dirty ? ' (paused while editing)' : ''}` : 'Auto-refresh'} aria-label="Auto-refresh" aria-haspopup="menu" aria-expanded={!!menu} disabled={!p.onRefresh || !p.onInterval} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom, origin: e.currentTarget }); }}><Clock3 size={15}/></button>
      <button className="icon-button" title="Cancel result query" aria-label="Cancel result query" disabled={!p.cancellable || !p.onCancel} onClick={p.onCancel}><Square size={12} fill="currentColor"/></button>
      <span className="toolbar-divider"/>
      <button className="icon-button" title="Add row" aria-label="Add row" disabled={!p.canAdd || busy} onClick={p.onAdd}><Plus size={16}/></button>
      <button className="icon-button" title="Delete selected rows" aria-label="Delete selected rows" disabled={!p.canDelete || busy || p.submitted} onClick={p.onDelete}><Minus size={16}/></button>
      <button className="icon-button" title="Revert changes" aria-label="Revert changes" disabled={!p.dirty || busy} onClick={p.onRevert}><Undo2 size={16}/></button>
      <button className="icon-button" title="Preview pending changes" aria-label="Preview pending changes" disabled={!p.count || busy || p.submitted} onClick={p.onPreview}><Eye size={16}/></button>
      <button className="icon-button submit-changes" title="Submit changes (Ctrl/Cmd+Enter)" aria-label="Submit changes" disabled={!p.dirty || busy || p.submitted} onClick={p.onSubmit}><ArrowUp size={17}/></button>
      <span className="toolbar-divider"/>
      <span className="grid-help" aria-live="polite">{p.count ? `${p.count} pending ${p.count === 1 ? 'change' : 'changes'}` : ''}{p.interval ? ` · Auto ${p.interval}s${p.dirty ? ' paused' : ''}` : ''}</span>
      <button className="icon-button" title="Export displayed results as CSV" aria-label="Export CSV" onClick={p.onExport}><Download size={15}/></button>
    </div>
    {error && !dialog && <div role="alert" className="grid-edit-message">{error}</div>}
    {menu && <ContextMenu position={menu} label="Auto-refresh interval" onClose={() => setMenu(null)} actions={[
      ...[0, 5, 10, 30, 60, 300].map(value => ({ label: value === 0 ? 'Disabled' : value < 60 ? `${value} s` : `${value / 60} m`, icon: (p.interval ?? 0) === value ? <Check size={14}/> : undefined, action: () => p.onInterval?.(value) })),
      { label: 'Custom…', separator: true, action: () => { setSeconds(String(p.interval || 30)); setError(''); setDialog('interval'); } },
    ]}/>}
    {dialog && createPortal(<DialogBoundary onClose={close}><div className="grid-edit-backdrop"><section role="dialog" aria-modal="true" aria-label={dialog === 'refresh' ? 'Ignore Unsubmitted Changes' : 'Custom Update Interval'} className="dialog result-toolbar-dialog">
      {dialog === 'refresh' ? <><h2>Ignore Unsubmitted Changes</h2><p>Changes are not submitted. Data will be lost.<br/>Continue?</p><div className="dialog-actions"><button className="primary-button" onClick={() => void refresh(true)}>Yes</button><button autoFocus onClick={close}>No</button></div></> : <form onSubmit={e => { e.preventDefault(); const value = Number(seconds); if (!Number.isInteger(value) || value < 1 || value > 86400) { setError('Enter a whole number from 1 to 86400 seconds.'); return; } p.onInterval?.(value); close(); }}><h2>Custom Update Interval</h2><label>Update interval in seconds<input autoFocus type="number" min="1" max="86400" step="1" value={seconds} onChange={e => setSeconds(e.target.value)}/></label>{error && <p role="alert">{error}</p>}<div className="dialog-actions"><button className="primary-button" type="submit">OK</button><button type="button" onClick={close}>Cancel</button></div></form>}
    </section></div></DialogBoundary>, document.body)}
  </>;
}
