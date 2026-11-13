import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, ExternalLink, Table2, X } from 'lucide-react';
import type { ForeignReference } from './types';
export function ReferencePicker({ cacheId, column, onOpen, onClose }: { cacheId: string; column: string; onOpen: (reference: ForeignReference) => void; onClose: () => void }) {
  const [references, setReferences] = useState<ForeignReference[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const latestClose = useRef(onClose); latestClose.current = onClose;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) latestClose.current(); };
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); if (origin?.isConnected) origin.focus(); };
  }, []);
  useEffect(() => { close.current?.focus(); let active = true;
    void invoke<ForeignReference[]>('result_references', { cacheId, column }).then(value => { if (active) setReferences(value); }).catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cacheId, column]);
  return <div ref={container} className="reference-picker" role="dialog" aria-label="Related records" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <header><div><strong>Open related record</strong><small>From column <b>{column}</b></small></div><button className="icon-button" aria-label="Close relationships" title="Close" ref={close} onClick={onClose}><X size={17}/></button></header>
    {loading && <p>Loading relationships…</p>}{error && <p role="alert">{error}</p>}
    {!loading && !error && !references.length && <p>No relationship metadata is available for this column.</p>}
    {references.map(r => <section key={r.id} className="reference-target" title={'Foreign key: ' + r.name}>
      <div className="reference-destination"><Table2 size={18} aria-hidden="true"/><div><small>Referenced table</small><strong>{r.schema}.{r.table}</strong></div></div>
      <div className="reference-mappings">{r.columns.map((source, index) => <div key={index}><code>{source}</code><ArrowRight size={14} aria-label="references"/><code>{r.targetColumns[index]}</code></div>)}</div>
      <button className="reference-open" aria-label={'Open record in ' + r.schema + '.' + r.table} onClick={() => onOpen(r)}>Open record<ExternalLink size={14}/></button>
    </section>)}
    {!loading && references.length > 0 && <p className="reference-hint">Opens in a new query tab on the same database.</p>}
  </div>;
}
