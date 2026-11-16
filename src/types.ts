export type Engine = 'postgres' | 'sqlserver';
export interface Connection { id: string; name: string; engine: Engine; host: string; port: number; database: string; username: string; tls: boolean; trustCertificate: boolean }
export interface ColumnKey { name: string; primaryKey: boolean; foreignKey: boolean }
export interface ResultSet { joinEditable?: boolean; editReason?: string | null; columnKeys?: ColumnKey[]; keyMetadataError?: string; columns: string[]; rows: (string | null)[][]; affected: number | null; totalRows?: number | null; hasMore?: boolean; pageSize?: number | null }
export interface TableBrowser { table: string; filters: (import("./resultFilters").ColumnFilter & { column: string })[]; sort: { column: string; descending: boolean } | null; sql: string; parameters: string[] }
export interface ValueChoices { values: { value: string | null; count: number }[]; hasMore: boolean }
export interface QueryResult { browser?: TableBrowser | null; sets: ResultSet[]; truncated: boolean; elapsedMs: number; cacheId?: string | null; complete?: boolean; pageSize?: number | null; cancelled?: boolean }
export interface Table { schema: string; name: string; kind: string }
export interface Column { name: string; type: string; nullable: boolean }
export interface QueryTab { id: string; name: string; sql: string; path?: string; savedSql: string; connectionId: string; database: string; draft?: boolean; fresh?: boolean; pinned?: boolean }
export interface SavedQuery { id: string; name: string; sql: string; connectionId: string; serverName: string; database: string; draft?: boolean; pinned?: boolean }
export interface QueryLibrary { folder: string; defaultFolder: string; queries: SavedQuery[] }

export interface ResultPage { rows: ResultSet["rows"]; totalRows: number; hasMore?: boolean; result?: QueryResult }

export interface QueryHistoryEntry { id: string; queryId?: string | null; sql: string; connectionId: string; serverName: string; database: string; engine: Engine; startedAt: string; durationMs: number; status: "completed" | "results" | "error" | "cancelled"; error: string | null }

export interface ForeignReference { id: string; name: string; schema: string; table: string; columns: string[]; targetColumns: string[] }
