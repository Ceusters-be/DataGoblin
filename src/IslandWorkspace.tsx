import { Database, FolderOpen, Table2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
const storageKey = 'datagoblin.layout';
export const defaultLayout = { left: 248, right: 248, top: 0.62 };
export function savedLayout() {
  try { const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (value && [value.left, value.right, value.top].every(n => typeof n === 'number' && Number.isFinite(n))) return { left: Math.max(160, Math.min(500, value.left)), right: Math.max(160, Math.min(500, value.right)), top: Math.max(0.2, Math.min(0.85, value.top)) };
  } catch { /* Restore a usable layout when settings are missing or invalid. */ }
  return defaultLayout;
}
export function fitLayout(width: number, height: number, layout: typeof defaultLayout) {
  const sideBudget = Math.max(320, width - 16 - 16 - 320);
  let left = Math.min(layout.left, 500), right = Math.min(layout.right, 500);
  if (left + right > sideBudget) { const excess = left + right - sideBudget; const room = left + right - 320; left -= excess * (left - 160) / Math.max(1, room); right -= excess * (right - 160) / Math.max(1, room); }
  const vertical = Math.max(360, height - 24);
  return { left: Math.max(160, left), right: Math.max(160, right), top: Math.max(220, Math.min(vertical - 140, vertical * layout.top)), vertical, sideBudget };
}
export const defaultPanels = { explorer: true, queries: true, results: true };
export function useWorkspacePanels() {
  const [panels, setPanels] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('datagoblin.panels') ?? 'null');
      return Object.fromEntries(Object.entries(defaultPanels).map(([key, fallback]) => [key, typeof stored?.[key] === 'boolean' ? stored[key] : fallback])) as typeof defaultPanels;
    } catch { return defaultPanels; }
  });
  useEffect(() => { try { localStorage.setItem('datagoblin.panels', JSON.stringify(panels)); } catch { /* Panels remain usable without storage. */ } }, [panels]);
  return { panels, togglePanel: (panel: keyof typeof defaultPanels) => setPanels(current => ({ ...current, [panel]: !current[panel] })) };
}
export function WorkspaceControls({ panels, onToggle }: { panels: typeof defaultPanels; onToggle: (panel: keyof typeof defaultPanels) => void }) {
  return <div className="workspace-controls" role="group" aria-label="Workspace panels">
    {([{ key: 'explorer', label: 'Database Explorer', icon: Database }, { key: 'results', label: 'Results', icon: Table2 }, { key: 'queries', label: 'Saved Queries', icon: FolderOpen }] as const).map(({ key, label, icon: Icon }) =>
      <button key={key} className="icon-button" type="button" title={(panels[key] ? 'Hide ' : 'Show ') + label} aria-label={label} aria-pressed={panels[key]} aria-controls={'workspace-' + key} onClick={() => onToggle(key)}><Icon size={17}/></button>)}
  </div>;
}
function Divider({ name, axis, value, min, max, onChange, onReset, direction = 1, hidden = false }: { hidden?: boolean; direction?: 1 | -1; name: string; axis: 'x' | 'y'; value: number; min: number; max: number; onChange: (value: number) => void; onReset: () => void }) {
  const drag = useRef<{ coordinate: number; value: number } | null>(null);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return <div hidden={hidden} className={'workspace-divider ' + (axis === 'x' ? 'vertical' : 'horizontal')} role="separator" tabIndex={0} aria-label={name} aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(value)} aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} title="Drag to resize · Arrow keys to adjust · Double-click to reset"
    onDoubleClick={onReset}
    onKeyDown={event => { const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']; if (keys.includes(event.key)) { event.preventDefault(); onChange(clamp(value + (event.key === keys[0] ? -1 : 1) * (event.shiftKey ? 40 : 10) * direction)); } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); onChange(event.key === 'Home' ? min : max); } }}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { coordinate: axis === 'x' ? event.clientX : event.clientY, value }; event.currentTarget.dataset.dragging = 'true'; }}
    onPointerMove={event => { if (drag.current) onChange(clamp(drag.current.value + ((axis === 'x' ? event.clientX : event.clientY) - drag.current.coordinate) * direction)); }}
    onPointerUp={event => { drag.current = null; delete event.currentTarget.dataset.dragging; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={event => { drag.current = null; delete event.currentTarget.dataset.dragging; }}
    onLostPointerCapture={event => { drag.current = null; delete event.currentTarget.dataset.dragging; }}
  />;
}
export function IslandWorkspace({ explorer, editor, queries, results, footer, panels = defaultPanels }: { panels?: typeof defaultPanels; explorer: ReactNode; editor: ReactNode; queries: ReactNode; results: ReactNode; footer: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(savedLayout);
  const [size, setSize] = useState({ width: 1200, height: 720 });
  useLayoutEffect(() => {
    const measure = () => { const element = host.current; if (element && element.clientWidth && element.clientHeight) setSize({ width: element.clientWidth, height: element.clientHeight }); };
    measure(); const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure); if (host.current) observer?.observe(host.current);
    window.addEventListener('resize', measure); return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* Resizing still works without persistent storage. */ } }, 150); return () => clearTimeout(timer); }, [layout]);
  const fitted = fitLayout(size.width, size.height, layout);
  return <div className="island-workspace"><div className="island-content" ref={host}>
    <div className="island-top" style={results && panels.results ? { flex: '0 0 ' + fitted.top + 'px' } : { flex: 1 }}>
      <div id="workspace-explorer" hidden={!panels.explorer} className="workspace-island explorer-island" style={{ width: fitted.left }}>{explorer}</div>
      <Divider hidden={!panels.explorer} name="Resize explorer" axis="x" value={fitted.left} min={160} max={Math.min(500, fitted.sideBudget - fitted.right)} onChange={left => setLayout(current => ({ ...current, left, right: fitted.right }))} onReset={() => setLayout(current => ({ ...current, left: defaultLayout.left }))}/>
      <div className="workspace-island editor-island">{editor}</div>
      <Divider hidden={!panels.queries} name="Resize saved queries" axis="x" direction={-1} value={fitted.right} min={160} max={Math.min(500, fitted.sideBudget - fitted.left)} onChange={right => setLayout(current => ({ ...current, left: fitted.left, right }))} onReset={() => setLayout(current => ({ ...current, right: defaultLayout.right }))}/>
      <div id="workspace-queries" hidden={!panels.queries} className="workspace-island queries-island" style={{ width: fitted.right }}>{queries}</div>
    </div>
    {results && <><Divider hidden={!panels.results} name="Resize editor and results" axis="y" value={fitted.top} min={220} max={fitted.vertical - 140} onChange={top => setLayout(current => ({ ...current, top: top / fitted.vertical }))} onReset={() => setLayout(current => ({ ...current, top: defaultLayout.top }))}/><div id="workspace-results" hidden={!panels.results} className="workspace-island results-island">{results}</div></>}
  </div>{footer}</div>;
}
