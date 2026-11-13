import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorAppearance } from './editorAppearance';
import { useTheme } from './theme';
import { PostgreSQL, MSSQL, sql } from '@codemirror/lang-sql';
import type { Engine } from './types';

export function SqlPreview({ value, engine }: { value: string; engine: Engine }) {
  const { dark } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ parent: host.current, state: EditorState.create({
      doc: value,
      extensions: [
        sql({ dialect: engine === 'sqlserver' ? MSSQL : PostgreSQL }),
        editorAppearance(dark),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ 'aria-label': 'Generated SQL', tabindex: '0' }),
        EditorView.lineWrapping,
        EditorView.theme({ '&': { height: 'auto' }, '.cm-content': { padding: '6px 0' }, '.cm-line': { padding: '0' } }),
      ],
    }) });
    return () => view.destroy();
  }, [value, engine, dark]);
  return <div ref={host} />;
}
