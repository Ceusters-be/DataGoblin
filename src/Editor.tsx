import { syntaxTree } from '@codemirror/language';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, hoverTooltip, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { sqlEditorLanguage } from './sqlCompletion';
import { autocompletion, snippet, acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { ContextMenu, type MenuPosition } from './ContextMenu';
import { sqlTargetAt, type SqlTarget } from './editorNavigation';
import type { Column, Table, Engine } from './types';
import { useTheme } from './theme';
import { editorAppearance } from './editorAppearance';
import { statementAt } from './sql';
import { formatEditorSql } from './sqlFormat';
export interface EditorHandle { format: () => void }

export interface ExecutionMark { document: string; from: number; duration: number }
class SuccessMarker extends GutterMarker {
  toDOM() { const node = document.createElement('span'); node.className = 'cm-execution-check'; const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'M3 8l3 3 7-7'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.8'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path); node.append(svg); node.title = 'Query executed successfully'; node.setAttribute('aria-label', node.title); return node; }
}
class RuntimeWidget extends WidgetType {
  constructor(readonly duration: number) { super(); }
  eq(other: RuntimeWidget) { return other.duration === this.duration; }
  toDOM() { const node = document.createElement('span'); node.className = 'cm-execution-time'; node.textContent = this.duration < 1000 ? `${Math.round(this.duration)} ms` : `${(this.duration / 1000).toFixed(2)} s`; node.title = 'Time to return this query result'; return node; }
}
interface Props { ref?: Ref<EditorHandle>; onFormatError?: (message: string) => void; tables?: Table[]; columns?: Record<string, Column[]>; onReveal?: (table: Table) => void; onOpenData?: (table: Table) => void; onMetadata?: (target: SqlTarget) => Promise<string>; execution?: ExecutionMark; value: string; engine: Engine; schema: Record<string, string[]>; onChange: (value: string) => void; onRun: (sql: string, from?: number) => void; onSave: () => void }
export function Editor(props: Props) {
  const [menu, setMenu] = useState<{ target: SqlTarget; position: MenuPosition } | null>(null);
  const { dark } = useTheme();
  useEffect(() => setMenu(null), [props.tables, props.engine]);
  const execution = useRef(new Compartment());
  const appearance = useRef(new Compartment());
  const host = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const sqlConfiguration = useRef(new Compartment());
  const callbacks = useRef(props); callbacks.current = props;
  const formatQuery = () => {
    const view = editorView.current;
    if (!view) return;
    try { formatEditorSql(view, callbacks.current.engine); }
    catch (error) { callbacks.current.onFormatError?.(`Could not format SQL: ${error instanceof Error ? error.message : String(error)}`); }
    view.focus();
  };
  useImperativeHandle(props.ref, () => ({ format: formatQuery }), []);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: callbacks.current.value, extensions: [
      basicSetup,
      execution.current.of(gutter({ class: 'cm-execution-gutter', initialSpacer: () => new SuccessMarker() })),
      sqlConfiguration.current.of(sqlEditorLanguage(props.engine, props.schema)),
      autocompletion({ activateOnTypingDelay: 100, interactionDelay: 0 }),
      hoverTooltip(async (view, pos) => {
        const p = callbacks.current;
        const target = sqlTargetAt(view.state.doc.toString(), pos, p.engine, p.tables ?? [], p.columns, true);
        if (!target || !p.onMetadata) return null;
        let detail: string;
        try { detail = await p.onMetadata(target); } catch { detail = 'Could not load metadata.'; }
        return { pos: target.from, end: target.to, above: true, create() {
          const dom = document.createElement('div'); dom.className = 'sql-metadata-tooltip';
          const title = document.createElement('strong'); title.textContent = [target.table.schema, target.table.name, target.column].filter(Boolean).join('.');
          const body = document.createElement('div'); body.textContent = detail;
          const hint = document.createElement('small'); hint.textContent = 'Ctrl / Cmd + click to reveal in Database Explorer';
          dom.append(title, body, hint); return { dom };
        } };
      }, { hoverTime: 350 }),
      EditorView.domEventHandlers({
        click(event, view) {
          if (!event.ctrlKey && !event.metaKey) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const p = callbacks.current;
          const target = pos == null ? null : sqlTargetAt(view.state.doc.toString(), pos, p.engine, p.tables ?? [], p.columns);
          if (!target || !p.onReveal) return false;
          event.preventDefault(); p.onReveal(target.table); return true;
        },
        contextmenu(event, view) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const p = callbacks.current;
          const target = pos == null ? null : sqlTargetAt(view.state.doc.toString(), pos, p.engine, p.tables ?? [], p.columns);
          if (!target || !p.onOpenData) return false;
          event.preventDefault(); setMenu({ target, position: { x: event.clientX, y: event.clientY, origin: view.contentDOM } }); return true;
        },
      }),
      Prec.highest(keymap.of([
        { key: 'Mod-Enter', run: view => { const selection = view.state.selection.main; const doc = view.state.doc.toString(); const text = selection.empty ? statementAt(doc, selection.head, callbacks.current.engine) : view.state.sliceDoc(selection.from, selection.to); const from = selection.empty ? Math.max(0, doc.lastIndexOf(text, selection.head)) : selection.from; callbacks.current.onRun(text, from); return true; } },
        { key: 'Mod-Alt-l', run: () => { formatQuery(); return true; } },
        { key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } },
        { key: 'Tab', run: view => {
          const cursor = view.state.selection.main;
          if (cursor.empty && completionStatus(view.state) === 'active' && acceptCompletion(view)) return true;
          if (cursor.empty && syntaxTree(view.state).resolveInner(cursor.head, -1).name === 'Identifier') { const word = view.state.sliceDoc(0, cursor.head).match(/\bsel$/i); if (word) { snippet('SELECT * FROM ${table};')(view, null, cursor.head - 3, cursor.head); return true; } }
          return acceptCompletion(view);
        } }, indentWithTab,
      ])),
      EditorView.updateListener.of(update => { if (update.docChanged) callbacks.current.onChange(update.state.doc.toString()); }),
      appearance.current.of(editorAppearance(dark)),
    ] }) });
    editorView.current = view;
    return () => { editorView.current = null; view.destroy(); };
  }, []);
  useEffect(() => {
    editorView.current?.dispatch({ effects: sqlConfiguration.current.reconfigure(sqlEditorLanguage(props.engine, props.schema)) });
  }, [props.engine, props.schema]);
  useEffect(() => { editorView.current?.dispatch({ effects: appearance.current.reconfigure(editorAppearance(dark)) }); }, [dark]);
  const activeExecution = props.execution?.document === props.value ? props.execution : undefined;
  useEffect(() => {
    const view = editorView.current;
    if (!view) return;
    const mark = activeExecution;
    const line = mark && mark.document === view.state.doc.toString() ? view.state.doc.lineAt(Math.min(mark.from, view.state.doc.length)) : undefined;
    view.dispatch({ effects: execution.current.reconfigure([
      gutter({ class: 'cm-execution-gutter', initialSpacer: () => new SuccessMarker(), lineMarker: (_view, block) => block.from === line?.from ? new SuccessMarker() : null }),
      ...(line && mark ? [EditorView.decorations.of(Decoration.set([Decoration.widget({ widget: new RuntimeWidget(mark.duration), side: 1 }).range(line.to)]))] : []),
    ]) });
  }, [activeExecution]);
  return <><div className="editor" ref={host} />{menu && <ContextMenu position={menu.position} label="SQL object actions" onClose={() => setMenu(null)} actions={[
    { label: 'Reveal in Database Explorer', action: () => callbacks.current.onReveal?.(menu.target.table) },
    { label: 'Open data', action: () => callbacks.current.onOpenData?.(menu.target.table) },
  ]}/>}</>;
}
