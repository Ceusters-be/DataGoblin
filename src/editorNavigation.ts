import { MSSQL, PostgreSQL } from '@codemirror/lang-sql';
import type { Column, Engine, Table } from './types';
export interface SqlTarget { table: Table; column?: string; from: number; to: number }
const decode = (value: string) => value.startsWith('[') ? value.slice(1, -1).replace(/]]/g, ']') : value.startsWith('"') ? value.slice(1, -1).replace(/""/g, '"') : value;
export function sqlTargetAt(doc: string, position: number, engine: Engine, tables: Table[], columns: Record<string, Column[]> = {}, allowUnloaded = false): SqlTarget | null {
  const tokens: { text: string; kind: string; from: number; to: number }[] = [];
  (engine === 'sqlserver' ? MSSQL : PostgreSQL).language.parser.parse(doc).iterate({ enter(node) {
    if (!node.node.firstChild) tokens.push({ text: doc.slice(node.from, node.to), kind: node.name, from: node.from, to: node.to });
  } });
  const all = tokens.filter(t => !/Comment/.test(t.kind));
  const begin = all.filter(t => t.text === ';' && t.to <= position).at(-1)?.to ?? 0;
  const end = all.find(t => t.text === ';' && t.from >= position)?.to ?? doc.length;
  const ts = all.filter(t => t.from >= begin && t.to <= end);
  const name = (i: number) => /^(Identifier|QuotedIdentifier)$/.test(ts[i]?.kind ?? '');
  const equal = (actual: string, token: string) => engine === 'postgres' && token.startsWith('"') ? actual === decode(token) : engine === 'postgres' ? actual === token.toLowerCase() : actual.toLowerCase() === decode(token).toLowerCase();
  // Scope-aware resolution is intentionally conservative for CTEs and subqueries.
  if (ts.some(t => t.kind === 'Keyword' && /^with$/i.test(t.text)) || ts.filter(t => t.kind === 'Keyword' && /^select$/i.test(t.text)).length > 1) return null;
  const fromIndex = ts.findIndex(t => t.kind === 'Keyword' && /^from$/i.test(t.text));
  if (fromIndex >= 0) {
    const tail = ts.slice(fromIndex + 1);
    const stop = tail.findIndex(t => t.kind === 'Keyword' && /^(where|group|order|having|union|limit|offset)$/i.test(t.text));
    if (tail.slice(0, stop < 0 ? undefined : stop).some(t => t.text === ',')) return null;
  }
  const refs: { table: Table; alias?: string; from: number; to: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].kind !== 'Keyword' || !/^(from|join|update|into)$/i.test(ts[i].text) || !name(i + 1)) continue;
    const first = ++i; let last = i;
    while (ts[last + 1]?.text === '.' && name(last + 2)) last += 2;
    if (last - first > 2) { i = last; continue; } // Never resolve another database against the current one.
    const matches = tables.filter(t => equal(t.name, ts[last].text) && (last === first || equal(t.schema, ts[first].text)));
    if (matches.length === 1) {
      let after = last + 1; if (/^as$/i.test(ts[after]?.text ?? '')) after++;
      refs.push({ table: matches[0], alias: name(after) ? ts[after].text : undefined, from: ts[first].from, to: ts[last].to });
    }
    i = last;
  }
  const direct = refs.find(r => position >= r.from && position < r.to);
  if (direct) return { table: direct.table, from: direct.from, to: direct.to };
  const index = ts.findIndex(t => position >= t.from && position < t.to);
  if (index < 0 || !name(index)) return null;
  const token = ts[index];
  let candidates = refs;
  if (ts[index - 1]?.text === '.' && name(index - 2)) candidates = refs.filter(r => equal(decode(r.alias ?? r.table.name), ts[index - 2].text));
  else if (ts[index + 1]?.text === '.') return null;
  if (candidates.length > 1 && candidates.some(r => !columns[JSON.stringify([r.table.schema, r.table.name])])) return null;
  const matched = candidates.filter(r => columns[JSON.stringify([r.table.schema, r.table.name])]?.some(c => equal(c.name, token.text)));
  if (!matched.length && allowUnloaded && candidates.length === 1 && !columns[JSON.stringify([candidates[0].table.schema, candidates[0].table.name])]) matched.push(candidates[0]);
  if (matched.length !== 1) return null;
  return { table: matched[0].table, column: engine === 'postgres' && !token.text.startsWith('"') ? token.text.toLowerCase() : decode(token.text), from: token.from, to: token.to };
}
