import type { Connection, Engine, QueryResult } from './types';
import { literal } from './sql';

// null means all, including objects discovered on the next refresh.
export type ScopeChoice = string[] | null;
export interface ExplorerScope { databases: Record<string, ScopeChoice>; schemas: Record<string, ScopeChoice> }
export const scopeStorageKey = 'datagoblin.explorerScope.v1';
export function readExplorerScope(): ExplorerScope {
  try {
    const value = JSON.parse(localStorage.getItem(scopeStorageKey) ?? '{}');
    const valid = (entries: unknown): Record<string, ScopeChoice> => Object.fromEntries(
      Object.entries(entries && typeof entries === 'object' ? entries : {}).filter(([, v]) =>
        v === null || (Array.isArray(v) && v.every(n => typeof n === 'string'))),
    );
    return { databases: valid(value.databases), schemas: valid(value.schemas) };
  } catch { return { databases: {}, schemas: {} }; }
}
export function scopeNames(choice: ScopeChoice | undefined, available: string[], defaults: string[]): string[] {
  return choice === null ? available : (choice ?? defaults).filter(name => available.includes(name));
}
export const defaultDatabase = (c: Connection) => c.engine === 'sqlserver' ? 'master' : c.database;
export const defaultSchema = (engine: Engine) => engine === 'sqlserver' ? 'dbo' : 'public';
export const schemasSql = (engine: Engine) => engine === 'sqlserver'
  ? 'SELECT name FROM sys.schemas ORDER BY name'
  : "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema') AND schema_name NOT LIKE 'pg_toast%' AND schema_name NOT LIKE 'pg_temp_%' ORDER BY schema_name";
export function schemaObjectsSql(schemas: string[]): string {
  const selected = schemas.map(literal).join(', ');
  return `SELECT table_schema AS object_schema, table_name AS object_name, table_type AS object_kind FROM information_schema.tables WHERE table_schema IN (${selected})
UNION
SELECT routine_schema AS object_schema, routine_name AS object_name, routine_type AS object_kind FROM information_schema.routines WHERE routine_schema IN (${selected})
ORDER BY object_schema, object_name, object_kind`;
}
export const metadataPageSql = (sql: string, engine: Engine, offset: number) => sql + (
  engine === 'sqlserver' ? ` OFFSET ${offset} ROWS FETCH NEXT 500 ROWS ONLY` : ` LIMIT 500 OFFSET ${offset}`
);
export async function readMetadataPages(query: (sql: string) => Promise<QueryResult>, sql: string, engine: Engine) {
  const rows: (string | null)[][] = [];
  for (;;) {
    const result = await query(metadataPageSql(sql, engine, rows.length));
    if (result.truncated) throw new Error('Metadata batch was truncated. Refresh to retry.');
    const page = result.sets[0]?.rows ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
export const isRoutine = (kind: string) => ['FUNCTION', 'PROCEDURE'].includes(kind.toUpperCase());
