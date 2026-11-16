import type { Engine, QueryResult, Table } from './types';
import { literal } from './sql';

export function routineDefinitionSql(routine: Table, engine: Engine): string {
  const schema = literal(routine.schema), name = literal(routine.name);
  if (engine === 'sqlserver') return `SELECT o.name AS signature, m.definition
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
WHERE s.name = N${schema} AND o.name = N${name}
AND o.type IN (${routine.kind === 'PROCEDURE' ? "'P', 'PC'" : "'FN', 'IF', 'TF', 'FS', 'FT'"})
ORDER BY o.object_id`;
  return `SELECT p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS signature,
pg_catalog.pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = ${schema} AND p.proname = ${name}
AND p.prokind = '${routine.kind === 'PROCEDURE' ? 'p' : 'f'}'
ORDER BY p.oid`;
}

export function routineDefinitions(result: QueryResult): { signature: string; sql: string }[] {
  if (result.truncated) throw new Error('The routine definition is incomplete and cannot be opened.');
  const rows = result.sets[0]?.rows ?? [];
  if (!rows.length) throw new Error('Routine not found or not visible to this database user. Refresh the schema and check permissions.');
  if (rows.some(row => !row[1]?.trim())) throw new Error('SQL definition unavailable. The routine may be encrypted, implemented externally, or require VIEW DEFINITION permission.');
  return rows.map(row => ({ signature: row[0]!, sql: row[1]! }));
}
