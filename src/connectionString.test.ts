import { expect, it } from 'vitest';
import { parseSqlServerConnectionString as parse } from './connectionString';

it('imports SQL Server aliases, TCP ports, credentials and TLS settings', () => {
  expect(parse('Data Source=tcp:db.example.com,1444;Initial Catalog=Sales;UID=reader;PWD=secret;Encrypt=True;TrustServerCertificate=False;')).toEqual({
    connection: { engine: 'sqlserver', host: 'db.example.com', port: 1444, database: 'Sales', username: 'reader', tls: true, trustCertificate: false },
    password: 'secret', ignoredOptions: false,
  });
});
it('preserves semicolons, equals signs, spaces and escaped quotes in quoted passwords', () => {
  expect(parse('Server=.;Password=" a;b=""c " ;').password).toBe(' a;b="c ');
  expect(parse("Server=localhost;Pwd='it''s;secret'").password).toBe("it's;secret");
});
it('supports IPv6, last-key precedence and optional encryption', () => {
  const { connection } = parse('Server=old;Data Source=tcp:[::1],1434;Encrypt=optional;TrustServerCertificate=yes');
  expect(connection).toMatchObject({ host: '::1', port: 1434, tls: false, trustCertificate: true });
});
it('reports ignored client options', () => {
  expect(parse('Server=db;Pooling=true;Connect Timeout=30;MultipleActiveResultSets=True').ignoredOptions).toBe(true);
});
it.each([
  '', 'Server=db,0', 'Server=db,65536', 'Server=db,abc', 'Server=db;Pwd="secret',
  'Server=db;Pwd="secret"oops', 'Server=db;Integrated Security=SSPI',
  'Server=db;Trusted_Connection=True', 'Server=db;Authentication=Active Directory Integrated',
  'Server=db;Encrypt=Strict', 'Server=db\\instance', 'Server=db;Failover Partner=other',
])('rejects invalid or unsupported strings without exposing their contents: %s', value => {
  expect(() => parse(value)).toThrow();
  try { parse(value); } catch (error) { expect(String(error)).not.toContain('secret'); }
});
