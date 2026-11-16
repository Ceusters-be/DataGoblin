export interface SqlToken { text: string; kind: string; from: number; to: number }
export interface QueryScope { from: number; to: number; tokens: SqlToken[] }

// Build lexical SELECT scopes even while parentheses or the SQL are unfinished.
// Non-query parentheses (functions, IN lists) belong to their enclosing SELECT.
export function completionScopes(tokens: SqlToken[], position: number, from: number, to: number): QueryScope[] {
  interface Group extends QueryScope { parent?: Group; children: Group[]; query: boolean; correlated: boolean }
  const root: Group = {from,to,tokens:[],children:[],query:true,correlated:true};
  let current = root;
  for (const token of tokens) {
    if (token.text === '(' && !/String|Identifier/.test(token.kind)) {
      const previous = current.tokens.at(-1);
      const group: Group = {from:token.to,to,parent:current,tokens:[],children:[],query:false,
        correlated:!previous || !/^(from|join|lateral|apply|,)$/i.test(previous.text)};
      current.children.push(group);
      current = group;
    } else if (token.text === ')' && !/String|Identifier/.test(token.kind) && current.parent) {
      current.to = token.from;
      current = current.parent;
    } else {
      current.tokens.push(token);
      if (token.kind === 'Keyword' && /^select$/i.test(token.text)) current.query = true;
    }
  }
  const collect = (group: Group): SqlToken[] => [...group.tokens,...group.children.filter(child=>!child.query).flatMap(collect)].sort((a,b)=>a.from-b.from);
  const containing = (group: Group): Group => {
    const child=group.children.find(child=>position>=child.from && position<=child.to);
    return child ? containing(child) : group;
  };
  let active: Group | undefined = containing(root);
  while (active && !active.query) active=active.parent;
  const scopes: QueryScope[]=[];
  while (active) {
    if (active.query) scopes.push({from:active.from,to:active.to,tokens:collect(active)});
    if (!active.correlated) break;
    active=active.parent;
  }
  return scopes;
}
