import { describe, expect, it } from 'vitest';
import { sqlTargetAt } from './editorNavigation';
const tables = [{ schema: 'dbo', name: 'Users', kind: 'BASE TABLE' }, { schema: 'audit', name: 'Users', kind: 'BASE TABLE' }];
const columns = { '["dbo","Users"]': [{ name: 'Id', type: 'int', nullable: false }] };
describe('SQL editor navigation', () => {
  it('resolves qualified SQL Server tables and alias columns', () => {
    const sql = 'SELECT u.Id FROM [dbo].[Users] AS u;';
    expect(sqlTargetAt(sql, sql.indexOf('[Users]') + 2, 'sqlserver', tables)?.table).toEqual(tables[0]);
    expect(sqlTargetAt(sql, sql.indexOf('Id'), 'sqlserver', tables, columns)?.column).toBe('Id');
  });
  it('does not guess ambiguous or cross-database names', () => {
    expect(sqlTargetAt('SELECT * FROM Users;', 16, 'sqlserver', tables)).toBeNull();
    expect(sqlTargetAt('SELECT * FROM other.dbo.Users;', 25, 'sqlserver', tables)).toBeNull();
  });
  it('ignores strings, comments and unrelated statements', () => {
    const sql = "SELECT 'dbo.Users'; -- dbo.Users\nSELECT * FROM dbo.Users;";
    expect(sqlTargetAt(sql, 10, 'sqlserver', tables)).toBeNull();
    expect(sqlTargetAt(sql, 25, 'sqlserver', tables)).toBeNull();
    expect(sqlTargetAt(sql, sql.lastIndexOf('Users'), 'sqlserver', tables)?.table).toEqual(tables[0]);
  });
  it('respects PostgreSQL quoted case and avoids nested scopes', () => {
    const pg = [{ schema: 'public', name: 'Users', kind: 'BASE TABLE' }];
    expect(sqlTargetAt('SELECT * FROM public."Users";', 23, 'postgres', pg)?.table).toEqual(pg[0]);
    expect(sqlTargetAt('SELECT * FROM public.users;', 23, 'postgres', pg)).toBeNull();
    const sql = 'SELECT * FROM (SELECT * FROM dbo.Users) x';
    expect(sqlTargetAt(sql, sql.indexOf('Users'), 'sqlserver', tables)).toBeNull();
  });
});
