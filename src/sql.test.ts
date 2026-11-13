import { describe, expect, it } from 'vitest';
import { columnsSql, literal, previewSql, quoteIdentifier, statementAt, toCsv } from './sql';

describe('SQL generation with untrusted catalog names', () => {
  it('escapes both identifier dialects', () => {
    expect(quoteIdentifier('a"b', 'postgres')).toBe('"a""b"');
    expect(quoteIdentifier('a]b', 'sqlserver')).toBe('[a]]b]');
    expect(literal("O'Reilly")).toBe("'O''Reilly'");
  });
  it('quotes table names for demand-driven browsing', () => {
    expect(previewSql('odd schema', 'order', 'postgres')).toBe('SELECT *\nFROM "odd schema"."order";');
    expect(previewSql('dbo', 'a]b', 'sqlserver')).toBe('SELECT *\nFROM [dbo].[a]]b];');
    expect(columnsSql("O'Reilly", 'test')).toContain("table_schema = 'O''Reilly'");
  });
});
describe('current-statement execution', () => {
  it('does not execute the following statement', () => {
    expect(statementAt('SELECT 1; DELETE FROM orders;', 4)).toBe('SELECT 1;');
    expect(statementAt('SELECT 1; DELETE FROM orders;', 16)).toBe('DELETE FROM orders;');
  });
  it('does not split quoted strings, quoted identifiers, or comments', () => {
    const sql = "SELECT 'it''s; safe', \"semi;colon\" /* ; /* nested; */ */; SELECT 2;";
    expect(statementAt(sql, 12)).toBe(sql.slice(0, sql.indexOf('; SELECT') + 1));
    expect(statementAt('-- semicolon;\nSELECT 1; SELECT 2;', 17)).toBe('-- semicolon;\nSELECT 1;');
  });
  it('keeps dollar-quoted PostgreSQL bodies intact', () => {
    const sql = 'DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$; SELECT 3;';
    expect(statementAt(sql, 29)).toBe('DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$;');
  });
  it('handles PostgreSQL escaped strings', () => {
    const sql = "SELECT E'it\\'s; safe'; SELECT 2;";
    expect(statementAt(sql, 12)).toBe("SELECT E'it\\'s; safe';");
  });
  it('handles SQL Server escaped brackets', () => {
    expect(statementAt('SELECT [a]];b]; SELECT 2;', 8, 'sqlserver')).toBe('SELECT [a]];b];');
  });
  it('handles an unterminated final statement and empty SQL', () => {
    expect(statementAt('SELECT 1; SELECT 2', 18)).toBe('SELECT 2');
    expect(statementAt('', 0)).toBe('');
  });
});
it('exports quotes, newlines, nulls, and comma values as valid CSV', () => {
  expect(toCsv(['a', 'b'], [['one,two', 'a"b\nc'], [null, '']]))
    .toBe('"a","b"\r\n"one,two","a""b\nc"\r\n"",""');
});
