import type { Column, Engine, Table } from './types';
import { literal, quoteIdentifier } from './sql';

export interface Relationship {
  id: string; name: string;
  source: Pick<Table, 'schema' | 'name'>;
  target: Pick<Table, 'schema' | 'name'>;
  columns: string[]; targetColumns: string[];
}
export interface CompletionMetadata {
  columns: (Column & { primaryKey?: boolean; foreignKey?: boolean })[];
  relationships: Relationship[];
}
export interface CompletionCatalog {
  tables: Table[];
  load: (table: Table) => Promise<CompletionMetadata>;
}
export function relationshipsSql(table: Pick<Table, 'schema' | 'name'>, engine: Engine) {
  const name = literal(`${quoteIdentifier(table.schema, engine)}.${quoteIdentifier(table.name, engine)}`);
  if (engine === 'sqlserver') return `SELECT f.object_id, f.name, s.name, t.name, rs.name, rt.name, c.name, rc.name
    FROM sys.foreign_keys f
    JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
    JOIN sys.tables t ON t.object_id=f.parent_object_id JOIN sys.schemas s ON s.schema_id=t.schema_id
    JOIN sys.tables rt ON rt.object_id=f.referenced_object_id JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
    JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=fc.parent_column_id
    JOIN sys.columns rc ON rc.object_id=rt.object_id AND rc.column_id=fc.referenced_column_id
    WHERE f.parent_object_id=OBJECT_ID(N${name}) OR f.referenced_object_id=OBJECT_ID(N${name})
    ORDER BY f.object_id, fc.constraint_column_id`;
  return `SELECT k.oid, k.conname, s.nspname, t.relname, rs.nspname, rt.relname, c.attname, rc.attname
    FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class t ON t.oid=k.conrelid JOIN pg_catalog.pg_namespace s ON s.oid=t.relnamespace
    JOIN pg_catalog.pg_class rt ON rt.oid=k.confrelid JOIN pg_catalog.pg_namespace rs ON rs.oid=rt.relnamespace
    CROSS JOIN LATERAL unnest(k.conkey,k.confkey) WITH ORDINALITY AS pairs(src,dst,ord)
    JOIN pg_catalog.pg_attribute c ON c.attrelid=t.oid AND c.attnum=pairs.src
    JOIN pg_catalog.pg_attribute rc ON rc.attrelid=rt.oid AND rc.attnum=pairs.dst
    WHERE k.contype='f' AND (k.conrelid=to_regclass(${name}) OR k.confrelid=to_regclass(${name}))
    ORDER BY k.oid,pairs.ord`;
}
export function parseRelationships(rows: (string | null)[][]): Relationship[] {
  const groups = new Map<string, Relationship>();
  for (const [id, name, schema, table, targetSchema, targetTable, column, targetColumn] of rows) {
    if ([id,name,schema,table,targetSchema,targetTable,column,targetColumn].some(v => v == null)) continue;
    const item = groups.get(id!) ?? { id: id!, name: name!, source: {schema:schema!,name:table!}, target: {schema:targetSchema!,name:targetTable!}, columns: [], targetColumns: [] };
    item.columns.push(column!); item.targetColumns.push(targetColumn!); groups.set(id!, item);
  }
  return [...groups.values()];
}
