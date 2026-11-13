import { format } from 'sql-formatter';
import { isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Engine } from './types';

export function formatSql(sql: string, engine: Engine): string {
  return format(sql, {
    language: engine === 'sqlserver' ? 'transactsql' : 'postgresql',
    keywordCase: 'upper',
    tabWidth: 4,
    linesBetweenQueries: 1,
  });
}

export function formatEditorSql(view: EditorView, engine: Engine): void {
  const selection = view.state.selection.main;
  const from = selection.empty ? 0 : selection.from;
  const to = selection.empty ? view.state.doc.length : selection.to;
  const original = view.state.sliceDoc(from, to);
  if (!original.trim()) return;
  const formatted = formatSql(original, engine);
  if (formatted === original) return;
  view.dispatch({
    changes: { from, to, insert: formatted },
    selection: selection.empty
      ? { anchor: Math.min(selection.head, formatted.length) }
      : { anchor: from, head: from + formatted.length },
    annotations: [Transaction.userEvent.of('input.format'), isolateHistory.of('full')],
    scrollIntoView: true,
  });
}
