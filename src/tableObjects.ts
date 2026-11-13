import type { Engine } from './types';
import { literal, quoteIdentifier } from './sql';
export type MetadataKind = 'primary' | 'unique' | 'foreign' | 'index';
export interface TableObject { kind: MetadataKind; name: string; columns: string[]; details: string[] }
export function tableObjectsSql(schema: string, table: string, engine: Engine) {
  const name = literal(`${quoteIdentifier(schema, engine)}.${quoteIdentifier(table, engine)}`);
  if (engine === 'postgres') return `SELECT CASE k.contype WHEN 'p' THEN 'primary' WHEN 'u' THEN 'unique' ELSE 'foreign' END AS kind,
    k.conname AS name, a.attname AS column_name, pg_catalog.pg_get_constraintdef(k.oid) AS detail, cols.ord AS position
    FROM pg_catalog.pg_constraint k
    CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY AS cols(num,ord)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=cols.num
    WHERE k.conrelid=to_regclass(${name}) AND k.contype IN ('p','u','f')
    UNION ALL
    SELECT 'index', c.relname, NULL, pg_catalog.pg_get_indexdef(i.indexrelid), 0
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
    WHERE i.indrelid=to_regclass(${name}) ORDER BY kind,name,position`;
  // SQL Server catalog descriptions and names may use different collations.
  // Normalize operands before concatenation, not only the final expression.
  return `SELECT CASE WHEN k.type='PK' THEN 'primary' ELSE 'unique' END AS kind,
    k.name AS name, c.name AS column_name, CAST(c.name AS nvarchar(max)) AS detail, ic.key_ordinal AS position
    FROM sys.key_constraints k JOIN sys.index_columns ic ON ic.object_id=k.parent_object_id AND ic.index_id=k.unique_index_id
    JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
    WHERE k.parent_object_id=OBJECT_ID(N${name}) AND ic.key_ordinal>0
    UNION ALL
    SELECT 'foreign', f.name, c.name, CAST((QUOTENAME(c.name) COLLATE DATABASE_DEFAULT)+N' → '+(QUOTENAME(s.name) COLLATE DATABASE_DEFAULT)+'.'+(QUOTENAME(t.name) COLLATE DATABASE_DEFAULT)+'.'+(QUOTENAME(rc.name) COLLATE DATABASE_DEFAULT) AS nvarchar(max)), fc.constraint_column_id
    FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
    JOIN sys.tables t ON t.object_id=f.referenced_object_id JOIN sys.schemas s ON s.schema_id=t.schema_id
    JOIN sys.columns c ON c.object_id=f.parent_object_id AND c.column_id=fc.parent_column_id
    JOIN sys.columns rc ON rc.object_id=f.referenced_object_id AND rc.column_id=fc.referenced_column_id
    WHERE f.parent_object_id=OBJECT_ID(N${name})
    UNION ALL
    SELECT 'index', i.name, c.name, CAST(i.type_desc COLLATE DATABASE_DEFAULT+CASE WHEN i.is_unique=1 THEN ' UNIQUE' ELSE '' END+' · '+(QUOTENAME(c.name) COLLATE DATABASE_DEFAULT)+CASE WHEN ic.is_included_column=1 THEN ' (included)' WHEN ic.is_descending_key=1 THEN ' DESC' ELSE ' ASC' END+COALESCE(' · WHERE '+i.filter_definition COLLATE DATABASE_DEFAULT,'') AS nvarchar(max)), ic.index_column_id
    FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
    JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
    WHERE i.object_id=OBJECT_ID(N${name}) AND i.index_id>0 AND i.is_hypothetical=0
    ORDER BY kind,name,position`;
}
export function parseTableObjects(rows: (string | null)[][]): TableObject[] {
  const objects = new Map<string, TableObject>();
  for (const [kind, name, column, detail] of rows) {
    if (!name || !['primary', 'unique', 'foreign', 'index'].includes(kind ?? '')) continue;
    const key = JSON.stringify([kind, name]);
    const item = objects.get(key) ?? { kind: kind as MetadataKind, name, columns: [], details: [] };
    if (column && !item.columns.includes(column)) item.columns.push(column);
    if (detail && !item.details.includes(detail)) item.details.push(detail);
    objects.set(key, item);
  }
  return [...objects.values()];
}
