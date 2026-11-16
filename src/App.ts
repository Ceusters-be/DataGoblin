import { QueryTab } from './types';
import type { QueryResult } from './types';
export const uid = () => crypto.randomUUID();
export const resultIds = new WeakMap<QueryResult, string>();
export function resultVersion(result: QueryResult) {
  if (!resultIds.has(result)) resultIds.set(result, uid());
  return resultIds.get(result)!;
}
export const initialTab = (): QueryTab => ({
  id: uid(),
  name: 'Query1',
  sql: '',
  savedSql: '',
  connectionId: '',
  database: '',
  draft: true,
  fresh: true
});
export const tableKey = (schema: string, name: string) => JSON.stringify([schema, name]);
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
export const fileFilter = [{
  name: 'SQL query',
  extensions: ['sql']
}];
export function restoredTabs(): QueryTab[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('datagoblin.tabs') ?? 'null');
    if (Array.isArray(parsed) && parsed.every(t => typeof t.id === 'string' && typeof t.sql === 'string' && typeof t.name === 'string' && typeof t.savedSql === 'string' && typeof t.connectionId === 'string' && typeof t.database === 'string')) return parsed;
  } catch {/* Recover an empty workspace if session state is invalid. */}
  return [initialTab()];
}
