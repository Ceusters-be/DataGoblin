import { reservedWords } from './sqlReservedWords';
import { MSSQL, PostgreSQL, SQLDialect, schemaCompletionSource, sql, type SQLConfig } from '@codemirror/lang-sql';
import { syntaxTree } from '@codemirror/language';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Engine } from './types';
const sqlServer = SQLDialect.define({ ...MSSQL.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '["' });
export function identifierCompletion(name: string, engine: Engine, explicitQuote?: string) {
  const regular = /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(name);
  const needsQuote = !regular || reservedWords[engine].has(name.toLowerCase()) || engine === 'postgres' && name !== name.toLowerCase();
  if (!explicitQuote && !needsQuote) return name;
  const open = explicitQuote ?? (engine === 'sqlserver' ? '[' : '"');
  const close = open === '[' ? ']' : open;
  return open + name.split(close).join(close + close) + close;
}
export function schemaCompletions(engine: Engine, schema: SQLConfig['schema']) {
  const source = schemaCompletionSource({ dialect: engine === 'sqlserver' ? sqlServer : PostgreSQL, schema });
  return (context: CompletionContext): CompletionResult | null => {
    const token = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (/^(String|LineComment|BlockComment)$/.test(token.name)) return null;
    const result = source(context) as CompletionResult | null;
    if (!result) return null;
    const opening = context.state.sliceDoc(result.from, result.from + 1);
    const quoted = opening === '"' || engine === 'sqlserver' && opening === '[';
    // Replace the whole identifier when completing in the middle of a word.
    let to = result.to ?? context.pos;
    if (/^(Identifier|QuotedIdentifier)$/.test(token.name) && token.from === result.from) to = Math.max(to, token.to);
    return { ...result, to, options: result.options.map(option => {
      const name = quoted ? option.label.slice(1,-1) : option.label;
      return { ...option, apply: identifierCompletion(name, engine, quoted ? opening : undefined) };
    }) };
  };
}
export function sqlEditorLanguage(engine: Engine, schema: SQLConfig['schema']) {
  const dialect = engine === 'sqlserver' ? sqlServer : PostgreSQL;
  return [sql({dialect, upperCaseKeywords:true}), dialect.language.data.of({autocomplete:schemaCompletions(engine,schema)})];
}
