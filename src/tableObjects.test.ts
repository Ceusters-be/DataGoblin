import { expect, it } from 'vitest';
import { parseTableObjects, tableObjectsSql } from './tableObjects';
it('groups composite constraints without merging equal names from different object kinds', () => {
  const result = parseTableObjects([
    ['primary','PK_invoice','tenant_id','tenant_id'], ['primary','PK_invoice','id','id'],
    ['foreign','FK_parent','tenant_id','FOREIGN KEY (tenant_id,id) REFERENCES parent(tenant_id,id)'],
    ['foreign','FK_parent','id','FOREIGN KEY (tenant_id,id) REFERENCES parent(tenant_id,id)'],
    ['index','PK_invoice',null,'CREATE UNIQUE INDEX'], ['unexpected','x','a','b']
  ]);
  expect(result).toHaveLength(3);
  expect(result[0].columns).toEqual(['tenant_id','id']);
  expect(result[1].details).toHaveLength(1);
  expect(result[2].kind).toBe('index');
});
it('escapes catalog lookup names and preserves metadata ordering for each database engine', () => {
  const pg = tableObjectsSql('odd"schema', "job's", 'postgres');
  expect(pg).toContain(`to_regclass('"odd""schema"."job''s"')`);
  expect(pg).toContain('cols.ord AS position');
  const sql = tableObjectsSql('odd]schema', "job's", 'sqlserver');
  expect(sql).toContain("OBJECT_ID(N'[odd]]schema].[job''s]')");
  expect(sql).toContain('fc.constraint_column_id');
  expect(sql).toContain('ORDER BY kind,name,position');
});

it('normalizes SQL Server catalog collations before concatenating index descriptions', () => {
  const sql = tableObjectsSql('dbo', 'MetadataCheck', 'sqlserver');
  expect(sql).toContain('i.type_desc COLLATE DATABASE_DEFAULT');
  expect(sql).toContain('QUOTENAME(c.name) COLLATE DATABASE_DEFAULT');
  expect(sql).toContain('i.filter_definition COLLATE DATABASE_DEFAULT');
});
