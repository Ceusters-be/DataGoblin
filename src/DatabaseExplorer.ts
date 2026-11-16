import { Table } from './types';
import { Connection } from './types';
export const contextKey = (c: Connection) => JSON.stringify([c.id, c.database]);
export const tableKey = (t: Table) => JSON.stringify([t.schema, t.name]);
