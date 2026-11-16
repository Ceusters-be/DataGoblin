import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Engine, Table } from './types';
import type { CompletionCatalog, Relationship } from './completionMetadata';
import { identifierCompletion } from './sqlCompletion';
import { completionScopes } from './completionScope';

const decode = (s: string) => s.startsWith('[') ? s.slice(1,-1).replaceAll(']]',']') : s.startsWith('"') ? s.slice(1,-1).replaceAll('""','"') : s;
const same = (a: Pick<Table,'schema'|'name'>, b: Pick<Table,'schema'|'name'>) => a.schema === b.schema && a.name === b.name;

export async function contextCompletions(context: CompletionContext, engine: Engine, catalog: CompletionCatalog): Promise<CompletionResult | null> {
  const tree = syntaxTree(context.state), doc = context.state.doc.toString();
  if (/String|Comment/.test(tree.resolveInner(context.pos,-1).name)) return null;
  const tokens: {text:string; kind:string; from:number; to:number}[] = [];
  tree.iterate({enter(n) { if (!n.node.firstChild && !/Comment/.test(n.name)) tokens.push({text:doc.slice(n.from,n.to),kind:n.name,from:n.from,to:n.to}); }});
  const begin = tokens.filter(t => t.text === ';' && t.to <= context.pos).at(-1)?.to ?? 0;
  const end = tokens.find(t => t.text === ';' && t.from >= context.pos)?.from ?? doc.length;
  const statement = tokens.filter(t => t.from >= begin && t.to <= end);
  // CTE output shapes and set-operation branches need their own resolution.
  if (statement.some(t => t.kind === 'Keyword' && /^(with|union|intersect|except)$/i.test(t.text))) return null;
  const scopes = completionScopes(statement,context.pos,begin,end);
  const ts = scopes[0]?.tokens ?? [];
  const equal = (actual:string, token:string) => engine === 'sqlserver' ? actual.toLowerCase() === decode(token).toLowerCase() : actual === (token.startsWith('"') ? decode(token) : token.toLowerCase());
  const q = (s:string) => identifierCompletion(s,engine);
  const refs: {table:Table; alias:string; from:number; depth:number}[] = [];
  const aliases = new Set<string>();
  for (const [depth,scope] of scopes.entries()) {
    const ts=scope.tokens;
    const isName = (i: number) => /^(Identifier|QuotedIdentifier)$/.test(ts[i]?.kind ?? '');
    for (let i=0;i<ts.length;i++) {
    if (ts[i].kind !== 'Keyword' || !/^(from|join|update|into)$/i.test(ts[i].text) || !isName(i+1)) continue;
    const start=++i; let last=i;
    while (ts[last+1]?.text === '.' && isName(last+2)) last+=2;
    if (last-start>2) { i=last; continue; }
    const derived=doc.slice(ts[start-1].to,ts[start].from).includes('(');
    const matches=derived?[]:catalog.tables.filter(t => equal(t.name,ts[last].text) && (start===last || equal(t.schema,ts[start].text)));
    let after=last+1; if (/^as$/i.test(ts[after]?.text ?? '')) after++;
    const alias=isName(after)?ts[after].text:ts[last].text;
    const aliasKey=engine==='sqlserver'?decode(alias).toLowerCase():alias.startsWith('"')?decode(alias):alias.toLowerCase();
    if (!aliases.has(aliasKey)) {
      aliases.add(aliasKey);
      if (matches.length===1) refs.push({table:matches[0],alias:isName(after)?engine==='postgres'&&!alias.startsWith('"')?alias.toLowerCase():alias:q(matches[0].name),from:ts[start].from,depth});
    }
    i=last;
    }
  }
  const before = ts.filter(t => t.to <= context.pos);
  const clause = [...before].reverse().find(t => t.kind==='Keyword' && /^(select|from|join|on|where|having|order|group|set|values)$/i.test(t.text));
  const word = context.matchBefore(/[\p{L}\p{N}_$\[\]"]*/u)!;
  let from=word.from, to=context.pos;
  const token=tree.resolveInner(context.pos,-1);
  if (/^(Identifier|QuotedIdentifier)$/.test(token.name) && token.from===from) to=token.to;
  const fallbackTables = (): CompletionResult => ({from,to,options:catalog.tables.map(t=>({label:t.name,detail:t.schema,type:'type',apply:`${q(t.schema)}.${q(t.name)}`}))});
  if (clause && /^from$/i.test(clause.text)) return null; // Built-in handles schema-qualified table names.
  if (!refs.length) return null;
  const metadata = await Promise.all(refs.map(r => catalog.load(r.table).catch(() => null)));
  if (context.aborted) return null;
  const options: Completion[]=[];
  const relationOptions = (index:number, relationship:Relationship, reverse:boolean, joined?:typeof refs[number]) => {
    const ref=refs[index], target=reverse?relationship.source:relationship.target;
    const sourceColumns=reverse?relationship.targetColumns:relationship.columns;
    const targetColumns=reverse?relationship.columns:relationship.targetColumns;
    let alias=joined?.alias;
    if (!alias) {
      const base=(target.name.match(/[A-Z]/g)?.join('') || target.name.slice(0,1)).toLowerCase().replace(/[^a-z]/g,'') || 't';
      alias=base; let n=2; while(refs.some(r=>decode(r.alias).toLowerCase()===alias) || q(alias)!==alias) alias=base+n++;
    }
    const condition=sourceColumns.map((c,i)=>`${ref.alias}.${q(c)} = ${alias}.${q(targetColumns[i])}`).join(' AND ');
    options.push({label:joined?condition:target.name,displayLabel:joined?condition:`${target.name} (${alias})`,detail:relationship.name,type:'property',boost:20,
      info:`${relationship.source.schema}.${relationship.source.name} → ${relationship.target.schema}.${relationship.target.name}\n${condition}`,
      apply:joined?condition:`${q(target.schema)}.${q(target.name)} ${alias} ON ${condition}`});
  };
  if (clause && /^join$/i.test(clause.text)) {
    // Replace only an unfinished table path; never duplicate a user-written alias or ON.
    const tail=doc.slice(clause.to,context.pos);
    if (!/^\s*(?:[\p{L}\p{N}_$]+\.)?[\p{L}\p{N}_$]*$/u.test(tail) || /^\s+(?:AS\b|ON\b|[\p{L}_])/iu.test(doc.slice(to,end))) return null;
    from=clause.to+(tail.match(/^\s*/)?.[0].length ?? 0);
    refs.forEach((r,index)=> { if(r.depth!==0 || r.from>=clause.from)return; metadata[index]?.relationships.forEach(rel=>{
      if(same(r.table,rel.source))relationOptions(index,rel,false);
      if(same(r.table,rel.target))relationOptions(index,rel,true);
    }); });
    const prefix=tail.trim().toLowerCase();
    // The replacement includes a schema prefix, while menu labels contain only the table name.
    const matches=(option:Completion) => {
      const insert=typeof option.apply==='string'?option.apply.toLowerCase():'';
      return option.label.toLowerCase().startsWith(prefix) || insert.startsWith(prefix);
    };
    return {from,to,filter:false,options:[...options,...fallbackTables().options].filter(matches)};
  }
  if (clause && /^on$/i.test(clause.text) && !doc.slice(clause.to,context.pos).trim()) {
    const joined=refs.filter(r=>r.depth===0).at(-1);
    if (!joined) return null;
    refs.forEach((r,index)=>{ if(r.depth!==0 || r===joined)return; metadata[index]?.relationships.forEach(rel=>{
      if(same(r.table,rel.source)&&same(joined.table,rel.target))relationOptions(index,rel,false,joined);
      if(same(r.table,rel.target)&&same(joined.table,rel.source))relationOptions(index,rel,true,joined);
    }); });
    if(options.length)return {from,to,options};
  }
  const qualifier=doc.slice(begin,from).match(/("(?:[^"]|"")+"|\[(?:[^\]]|\]\])+\]|[\p{L}_][\p{L}\p{N}_$]*)\.$/u)?.[1];
  if (qualifier && !refs.some(r=>equal(decode(r.alias),qualifier))) return {from,to,options:[]};
  refs.forEach((r,index)=>{
    if(qualifier && !equal(decode(r.alias),qualifier))return;
    if (!qualifier && r.depth!==0) return;
    for(const c of metadata[index]?.columns ?? []) options.push({label:c.name,detail:[c.type,c.primaryKey?'PK':'',c.foreignKey?'FK':''].filter(Boolean).join(' · '), info:`${r.table.schema}.${r.table.name} · ${c.nullable?'nullable':'not null'}`,type:'property',
      apply:qualifier?q(c.name):refs.filter(r=>r.depth===0).length>1?`${r.alias}.${q(c.name)}`:q(c.name)});
  });
  if (!qualifier) options.push(...refs.map(r=>({label:decode(r.alias),apply:r.alias,type:'variable',detail:`${r.depth?'outer table':'table'} · ${r.table.schema}.${r.table.name}`})));
  return options.length?{from,to,options}:null;
}
