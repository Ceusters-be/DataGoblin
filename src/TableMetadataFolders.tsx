import { useState } from 'react';
import { ChevronRight, Columns3, Folder, KeyRound, Link2, ListOrdered } from 'lucide-react';
import type { Column } from './types';
import type { TableObject } from './tableObjects';
export interface TableMetadata { objects?: TableObject[]; loading?: boolean; error?: string }
export function TableMetadataFolders({ columns, metadata, onRetry }: { columns: Column[]; metadata?: TableMetadata; onRetry: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = [{ key: 'columns', label: 'Columns', items: columns }, ...([{ key: 'primary', label: 'Primary keys' }, { key: 'unique', label: 'Unique keys' }, { key: 'foreign', label: 'Foreign keys' }, { key: 'index', label: 'Indexes' }] as const).map(group => ({ ...group, items: (metadata?.objects ?? []).filter(item => item.kind === group.key) }))];
  return <div className="table-metadata-folders">
    {metadata?.loading && <p className="explorer-inline-state" role="status">Loading table metadata…</p>}
    {metadata?.error && <p className="explorer-inline-state" role="alert">{metadata.error} <button onClick={onRetry}>Retry</button></p>}
    {groups.map(group => <details key={group.key} open={!!open[group.key]}><summary onClick={event => { event.preventDefault(); setOpen(prev => ({ ...prev, [group.key]: !prev[group.key] })); }}><ChevronRight size={12}/><Folder size={14} className="object-folder"/><strong>{group.label}</strong><span>{metadata?.loading && !group.items.length ? '…' : metadata?.error && !group.items.length ? '?' : group.items.length}</span></summary>
      {group.items.map(item => {
        const object = 'kind' in item ? item : undefined;
        const primary = !object && metadata?.objects?.some(key => key.kind === 'primary' && key.columns.includes(item.name));
        const foreign = !object && metadata?.objects?.some(key => key.kind === 'foreign' && key.columns.includes(item.name));
        const Icon = object?.kind === 'foreign' || foreign ? Link2 : object?.kind === 'primary' || object?.kind === 'unique' || primary ? KeyRound : object ? ListOrdered : Columns3;
        const color = object?.kind === 'foreign' || foreign ? 'object-foreign' : object?.kind === 'primary' || object?.kind === 'unique' || primary ? 'object-key' : 'object-column';
        const detail = object ? object.details.join('\n') : `${(item as Column).type} · ${(item as Column).nullable ? 'nullable' : 'not null'}`;
        return <div className="metadata-object" key={item.name} title={item.name + '\n' + detail}><Icon size={13} className={color}/>{primary && foreign && <KeyRound size={11} className="object-key"/>}<span>{item.name}</span>{!object && <small>{(item as Column).type}</small>}</div>;
      })}
      {!group.items.length && !metadata?.loading && !metadata?.error && <p className="explorer-inline-state">None</p>}
    </details>)}
  </div>;
}
