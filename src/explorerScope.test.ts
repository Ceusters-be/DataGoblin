// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { metadataPageSql, readExplorerScope, readMetadataPages, schemaObjectsSql, scopeNames, scopeStorageKey } from './explorerScope';
afterEach(() => localStorage.clear());
it('distinguishes default, empty, explicit and all scopes and restores choices', () => {
  expect(scopeNames(undefined, ['dbo', 'wings'], ['dbo'])).toEqual(['dbo']);
  expect(scopeNames([], ['dbo', 'wings'], ['dbo'])).toEqual([]);
  expect(scopeNames(['wings', 'deleted'], ['dbo', 'wings'], ['dbo'])).toEqual(['wings']);
  expect(scopeNames(null, ['dbo', 'new'], ['dbo'])).toEqual(['dbo', 'new']);
  const scope = { databases: { a: ['master', 'Sales'], b: [] }, schemas: { '["a","Sales"]': null } };
  localStorage.setItem(scopeStorageKey, JSON.stringify(scope));
  expect(readExplorerScope()).toEqual(scope);
  localStorage.setItem(scopeStorageKey, 'null');
  expect(readExplorerScope()).toEqual({ databases: {}, schemas: {} });
});
it('loads all metadata beyond the previous 1,000 object cap in bounded pages', async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => ['dbo', `table${i}`, 'BASE TABLE']);
  const query = vi.fn(async (sql: string) => {
    const offset = Number(sql.match(/OFFSET (\d+)/)?.[1]);
    return { sets: [{ columns: [], rows: rows.slice(offset, offset + 500), affected: null }], truncated: false, elapsedMs: 0 };
  });
  expect(await readMetadataPages(query, schemaObjectsSql(['dbo']), 'sqlserver')).toEqual(rows);
  expect(query).toHaveBeenCalledTimes(3);
  expect(query.mock.calls[2][0]).toContain('OFFSET 1000 ROWS FETCH NEXT 500 ROWS ONLY');
});
it('filters tables and routines by safely quoted schemas in both dialects', () => {
  const sql = schemaObjectsSql(["team's"]);
  expect(sql.match(/IN \('team''s'\)/g)).toHaveLength(2);
  expect(sql).toContain('information_schema.routines');
  expect(metadataPageSql(sql, 'postgres', 500)).toMatch(/LIMIT 500 OFFSET 500$/);
});
it('reports incomplete batches instead of presenting them as a complete catalog', async () => {
  await expect(readMetadataPages(async () => ({ sets: [], truncated: true, elapsedMs: 0 }), 'SELECT name ORDER BY name', 'sqlserver')).rejects.toThrow('truncated');
});
