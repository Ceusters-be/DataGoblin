import { useLayoutEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import type { QueryResult } from './types';
export type OutputEvent = { text: string; kind?: 'sql' | 'info' | 'success' | 'error'; at?: number; duration?: number };
export type OutputEntry = OutputEvent & { at: number };
export type OutputLog = { entries: OutputEntry[]; failed: boolean; database: string; duration: number };
export function timestamp(at: number) {
  const d = new Date(at), pad = (n: number, length = 2) => String(n).padStart(length, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}:${pad(d.getMilliseconds(),3)}`;
}
export function appendLog(current: OutputLog | undefined, database: string, events: OutputEvent[]): OutputLog {
  const entries = events.map(e => ({ ...e, at: e.at ?? Date.now(), text: e.text.length > 100_000 ? e.text.slice(0,100_000) + '\n[Output truncated]' : e.text }));
  const retained = [...(current?.entries ?? []), ...entries].slice(-2000);
  let characters = retained.reduce((sum, entry) => sum + entry.text.length, 0);
  while (characters > 2_000_000 && retained.length > 1) characters -= retained.shift()!.text.length;
  return { database, entries: retained, failed: events.some(e => e.kind === 'error') || !!current?.failed && !events.some(e => e.kind === 'sql' || e.kind === 'success'), duration: [...events].reverse().find(e => e.duration !== undefined)?.duration ?? current?.duration ?? 0 };
}
export function sqlEvent(database: string, sql: string, parameters?: string[]): OutputEvent {
  return { kind:'sql', text: `${database}> ${sql.replace(/\r?\n/g, '\n' + ' '.repeat(database.length + 2))}` + (parameters?.length ? '\nParameters: ' + parameters.map((p,i)=>`${i+1} = ${JSON.stringify(p)}`).join(', ') : '') };
}
export function resultEvents(result: QueryResult): OutputEvent[] {
  const messages = result.sets.map((set, index) => set.columns.length
    ? `${set.rows.length} ${set.rows.length === 1 ? 'row' : 'rows'} retrieved starting from 1${set.hasMore ? ' (more rows available)' : ''}${result.sets.length > 1 ? ` · Result ${index+1}` : ''}`
    : set.affected != null ? `${set.affected} ${set.affected === 1 ? 'row' : 'rows'} affected` : 'Statement completed');
  // elapsedMs covers the whole initial request, not each result in a batch.
  const text = messages.length === 1 ? `${messages[0]} in ${result.elapsedMs} ms` : [...messages, `Completed in ${result.elapsedMs} ms`].join('\n');
  return [{kind:'success',text,duration:result.elapsedMs}];
}
export function QueryOutput({ log }: { log?: OutputLog }) {
  const host = useRef<HTMLDivElement>(null), follow = useRef(true);
  useLayoutEffect(() => { if (follow.current && host.current) host.current.scrollTop = host.current.scrollHeight; }, [log]);
  return <div ref={host} className="query-output execution-log" role="tabpanel" aria-label="Output" onScroll={e => { const node=e.currentTarget; follow.current=node.scrollHeight-node.scrollTop-node.clientHeight < 32; }}>
    {log?.entries.length ? <div role="log" aria-label="Execution log" aria-live="polite" aria-relevant="additions">{log.entries.map((entry,index) => <div className={'execution-log-entry '+(entry.kind ?? 'info')} key={entry.at+':'+index}><time dateTime={new Date(entry.at).toISOString()}>[{timestamp(entry.at)}]</time><pre>{entry.text}</pre></div>)}</div> : <div className="result-empty"><Terminal size={25}/><h3>No output yet</h3><p>Execution details and errors will appear here.</p></div>}
  </div>;
}
