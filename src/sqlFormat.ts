import { formatDialect, postgresql, transactsql, type DialectOptions } from 'sql-formatter';
import { sql as sqlLanguage, MSSQL, PostgreSQL } from '@codemirror/lang-sql';
import { isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Engine } from './types';

function compactFrom(dialect: DialectOptions): DialectOptions {
  return {
    ...dialect,
    formatOptions: {
      ...dialect.formatOptions,
      onelineClauses: [...dialect.formatOptions.onelineClauses, 'FROM'],
    },
  };
}

const dialects = { sqlserver: compactFrom(transactsql), postgres: compactFrom(postgresql) };
const parsers = {
  sqlserver: sqlLanguage({ dialect: MSSQL }).language.parser,
  postgres: sqlLanguage({ dialect: PostgreSQL }).language.parser,
};

function compactWildcardSelections(formatted: string, engine: Engine): string {
  const gaps: { from: number; to: number }[] = [];
  // Match SQL tokens rather than text inside comments, identifiers or string literals.
  parsers[engine].parse(formatted).iterate({
    enter(node) {
      if (node.name !== 'Keyword' || formatted.slice(node.from, node.to) !== 'SELECT') return;
      const star = node.node.nextSibling;
      const from = star?.nextSibling;
      if (star?.name !== 'Operator' || formatted.slice(star.from, star.to) !== '*') return;
      if (from?.name !== 'Keyword' || formatted.slice(from.from, from.to) !== 'FROM') return;
      if (/^\s+$/.test(formatted.slice(node.to, star.from))) gaps.push({ from: node.to, to: star.from });
    },
  });
  for (const gap of gaps.reverse()) formatted = formatted.slice(0, gap.from) + ' ' + formatted.slice(gap.to);
  return formatted;
}

export function formatSql(sql: string, engine: Engine): string {
  const formatted = formatDialect(sql, {
    dialect: dialects[engine],
    keywordCase: 'upper',
    tabWidth: 4,
    linesBetweenQueries: 1,
  });
  return compactWildcardSelections(formatted, engine);
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
