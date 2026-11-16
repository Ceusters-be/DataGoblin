import type { Engine } from './types';

export const quoteIdentifier = (value: string, engine: Engine): string => engine === 'postgres' ? `"${value.replaceAll('"', '""')}"` : `[${value.replaceAll(']', ']]')}]`;
export const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
export const databasesSql = (engine: Engine): string => engine === 'postgres'
  ? 'SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname'
  : 'SELECT name FROM sys.databases WHERE HAS_DBACCESS(name) = 1 ORDER BY name';
export const tablesSql = `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name`;
export const columnsSql = (schema: string, table: string): string => `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = ${literal(schema)} AND table_name = ${literal(table)} ORDER BY ordinal_position`;
export const previewSql = (schema: string, table: string, engine: Engine): string => {
  const name = `${quoteIdentifier(schema, engine)}.${quoteIdentifier(table, engine)}`;
  return `SELECT *\nFROM ${name};`;
};
export const toCsv = (columns: string[], rows: (string | null)[][]): string => [columns, ...rows].map(row => row.map(value => `"${(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');

// Find statement boundaries without splitting quoted strings, comments, or PG dollar bodies.
export function statementAt(sql: string, cursor: number, engine: Engine = 'postgres'): string {
  const range = statementRangeAt(sql, cursor, engine);
  return sql.slice(range.from, range.to);
}

export function statementRangeAt(sql: string, cursor: number, engine: Engine = 'postgres'): { from: number; to: number } {
  const ends: number[] = [];
  let quote = '', dollar = '', blockDepth = 0, line = false, escaped = false;
  let depth = 0, firstWord = '', hasSelect = false, setOperation = false;
  const inferred = new Set<number>();
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (blockDepth) { if (ch === '/' && next === '*') { blockDepth++; i++; } else if (ch === '*' && next === '/') { blockDepth--; i++; } continue; }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = ''; } continue; }
    if (quote) { if (escaped && ch === '\\') { i++; continue; } if (ch === quote) { if (next === quote) i++; else quote = ''; } continue; }
    if (ch === '-' && next === '-') { line = true; i++; }
    else if (ch === '/' && next === '*') { blockDepth = 1; i++; }
    else if (ch === "'" || ch === '"' || (ch === '[' && engine === 'sqlserver')) { quote = ch === '[' ? ']' : ch; escaped = engine === 'postgres' && ch === "'" && /(?:^|[^\w])e$/i.test(sql.slice(0, i)); }
    else if (ch === '$' && engine === 'postgres') { const match = sql.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/); if (match) { dollar = match[0]; i += dollar.length - 1; } }
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';') {
      ends.push(i + 1);
      if (depth === 0) { firstWord = ''; hasSelect = false; setOperation = false; }
    }
    else if (depth === 0 && /[a-z_]/i.test(ch)) {
      const word = sql.slice(i).match(/^[a-z_][a-z0-9_$]*/i)![0];
      const upper = word.toUpperCase();
      const lineStart = sql.lastIndexOf('\n', i - 1) + 1;
      if (upper === 'SELECT' && hasSelect && /^(SELECT|WITH)$/.test(firstWord) && !setOperation && /^[\t \r]*$/.test(sql.slice(lineStart, i))) {
        ends.push(i); inferred.add(i);
        firstWord = ''; hasSelect = false;
      }
      if (!firstWord) firstWord = upper;
      if (/^(UNION|INTERSECT|EXCEPT)$/.test(upper)) setOperation = true;
      if (upper === 'SELECT') { hasSelect = true; setOperation = false; }
      i += word.length - 1;
    }
  }
  const start = [...ends].reverse().find(end => end < cursor || inferred.has(end) && end === cursor) ?? 0;
  const end = ends.find(end => end >= cursor && end > start) ?? sql.length;
  const text = sql.slice(start, end);
  const from = start + text.length - text.trimStart().length;
  return { from, to: Math.max(from, end - (text.length - text.trimEnd().length)) };
}
