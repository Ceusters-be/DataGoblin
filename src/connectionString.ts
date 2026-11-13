import type { Connection } from './types';

// Parse ADO.NET key/value strings without splitting semicolons inside quoted values.
function entries(input: string): [string, string][] {
  const result: [string, string][] = [];
  let i = 0;
  const invalid = () => new Error('Invalid connection string. Use Server=...;Database=...;User Id=...;Password=...; and quote values containing semicolons.');
  while (i < input.length) {
    while (i < input.length && /[;\s]/.test(input[i])) i++;
    if (i === input.length) break;
    const start = i;
    while (i < input.length && input[i] !== '=' && input[i] !== ';') i++;
    if (input[i] !== '=') throw invalid();
    const key = input.slice(start, i++).trim().toLowerCase().replace(/\s+/g, '');
    if (!key) throw invalid();
    while (i < input.length && /\s/.test(input[i])) i++;
    let value = '';
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i++];
      let closed = false;
      while (i < input.length) {
        const char = input[i++];
        if (char === quote) {
          if (input[i] === quote) { value += quote; i++; }
          else { closed = true; break; }
        } else value += char;
      }
      if (!closed) throw invalid();
      while (i < input.length && /\s/.test(input[i])) i++;
      if (i < input.length && input[i] !== ';') throw invalid();
    } else {
      const startValue = i;
      while (i < input.length && input[i] !== ';') i++;
      value = input.slice(startValue, i).trim();
    }
    result.push([key, value]);
  }
  return result;
}

export function parseSqlServerConnectionString(input: string): {
  connection: Omit<Connection, 'id' | 'name'>; password: string; ignoredOptions: boolean;
} {
  const connection: Omit<Connection, 'id' | 'name'> = {
    engine: 'sqlserver', host: '', port: 1433, database: 'master', username: '', tls: true, trustCertificate: false,
  };
  let password = '', ignoredOptions = false;
  const boolean = (value: string) => {
    if (/^(true|yes)$/i.test(value)) return true;
    if (/^(false|no)$/i.test(value)) return false;
    throw new Error('Boolean connection options must be True or False.');
  };
  for (const [key, value] of entries(input)) {
    switch (key) {
      case 'server': case 'datasource': case 'address': case 'addr': case 'networkaddress': {
        const address = value.replace(/^tcp:/i, '');
        if (address.includes('\\')) throw new Error('Named instances need an explicit TCP port. Replace server\\instance with server,port.');
        if (/^(np|lpc):/i.test(address)) throw new Error('Only TCP connections are supported. Use Server=tcp:hostname,port.');
        const match = /^(\[[^\]]+\]|[^,]+)(?:,(\d+))?$/.exec(address);
        if (!match) throw new Error('Use Server=hostname,port with a valid TCP port.');
        connection.host = match[1].replace(/^\[|\]$/g, '').trim();
        connection.port = match[2] ? Number(match[2]) : 1433;
        if (connection.host === '.') connection.host = 'localhost';
        break;
      }
      case 'database': case 'initialcatalog': connection.database = value; break;
      case 'userid': case 'uid': case 'user': connection.username = value; break;
      case 'password': case 'pwd': password = value; break;
      case 'encrypt':
        if (/^strict$/i.test(value)) throw new Error('Encrypt=Strict is not supported. Configure encryption manually for this server.');
        connection.tls = /^mandatory$/i.test(value) ? true : /^optional$/i.test(value) ? false : boolean(value);
        break;
      case 'trustservercertificate': connection.trustCertificate = boolean(value); break;
      case 'integratedsecurity': case 'trusted_connection':
        if (/^sspi$/i.test(value) || boolean(value)) throw new Error('Windows integrated authentication is not supported yet. Use a SQL Server username and password.');
        break;
      case 'authentication':
        if (!/^sql\s*password$/i.test(value)) throw new Error('Only SQL Server username/password authentication is supported.');
        break;
      case 'applicationname': case 'app': case 'connecttimeout': case 'connectiontimeout':
      case 'pooling': case 'minpoolsize': case 'maxpoolsize': case 'multipleactiveresultsets':
      case 'persistsecurityinfo':
        ignoredOptions = true; break;
      default: throw new Error('This string contains unsupported connection options. Use Server, Database, User Id, Password, Encrypt and TrustServerCertificate, or configure the fields manually.');
    }
  }
  if (!connection.host || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) throw new Error('The connection string needs a server and a valid TCP port.');
  return { connection, password, ignoredOptions };
}
