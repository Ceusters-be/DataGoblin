import { expect, it } from 'vitest';
import { routineDefinitions, routineDefinitionSql } from './routines';
import type { QueryResult } from './types';

const result = (rows: (string | null)[][], truncated = false): QueryResult => ({ sets: [{ columns: ['signature', 'definition'], rows, affected: null }], truncated, elapsedMs: 1 });
it('fetches full SQL Server module text using safely quoted schema and name', () => {
  const sql = routineDefinitionSql({ schema: "team's", name: "daily'report", kind: 'PROCEDURE' }, 'sqlserver');
  expect(sql).toContain('LEFT JOIN sys.sql_modules');
  expect(sql).toContain("s.name = N'team''s'");
  expect(sql).toContain("o.name = N'daily''report'");
  expect(sql).not.toContain('routine_definition');
  const body = 'CREATE PROCEDURE dbo.Report AS\n' + '-- long definition\n'.repeat(1000) + 'SELECT 1;';
  expect(routineDefinitions(result([['Report', body]]))[0].sql).toBe(body);
});
it('returns PostgreSQL overloads with distinct signatures and filters out aggregates', () => {
  const sql = routineDefinitionSql({ schema: 'public', name: 'report', kind: 'FUNCTION' }, 'postgres');
  expect(sql).toContain('pg_catalog.pg_get_function_identity_arguments(p.oid)');
  expect(sql).toContain("p.prokind = 'f'");
  expect(routineDefinitions(result([['report(integer)', 'CREATE FUNCTION one'], ['report(text)', 'CREATE FUNCTION two']]))).toHaveLength(2);
  expect(routineDefinitionSql({ schema: 'public', name: 'report', kind: 'PROCEDURE' }, 'postgres')).toContain("p.prokind = 'p'");
});
it('refuses absent, inaccessible and truncated definitions', () => {
  expect(() => routineDefinitions(result([]))).toThrow('not found');
  expect(() => routineDefinitions(result([['Encrypted', null]]))).toThrow('VIEW DEFINITION');
  expect(() => routineDefinitions(result([['Partial', 'CREATE PROCEDURE']], true))).toThrow('incomplete');
});
