import { expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { sqlEditorLanguage } from './sqlCompletion';
import { contextCompletions } from './contextCompletions';
import { parseRelationships, relationshipsSql, type CompletionCatalog } from './completionMetadata';
import type { Engine } from './types';

const agreement={schema:'dbo',name:'Agreement',kind:'BASE TABLE'};
const party={schema:'dbo',name:'AgreementPartyRole',kind:'BASE TABLE'};
const relationship={id:'1',name:'FK_Agreement',source:party,target:agreement,columns:['AgreementId','TenantId'],targetColumns:['AgreementId','TenantId']};
const load=vi.fn(async()=>({columns:[{name:'AgreementId',type:'int',nullable:false,primaryKey:true,foreignKey:true}],relationships:[relationship]}));
const catalog:CompletionCatalog={tables:[agreement,party],load};
async function complete(input:string, engine:Engine='sqlserver', source=catalog) {
  const pos=input.indexOf('|'),doc=input.replace('|','');
  const state=EditorState.create({doc,extensions:sqlEditorLanguage(engine,{})});
  const result=await contextCompletions(new CompletionContext(state,pos,true),engine,source);
  return {result, apply:(index=0)=>doc.slice(0,result!.from)+result!.options[index].apply+doc.slice(result!.to??pos)};
}
it('inserts an incoming FK join and preserves LEFT JOIN',async()=>{
  const {result,apply}=await complete('SELECT * FROM Agreement a LEFT JOIN |');
  expect(result!.options[0].detail).toBe('FK_Agreement');
  expect(apply()).toBe('SELECT * FROM Agreement a LEFT JOIN dbo.AgreementPartyRole apr ON a.AgreementId = apr.AgreementId AND a.TenantId = apr.TenantId');
});
it('inserts outgoing FK join and replaces schema-qualified prefix',async()=>{
  const {apply}=await complete('SELECT * FROM AgreementPartyRole apr INNER JOIN dbo.Ag|');
  expect(apply()).toBe('SELECT * FROM AgreementPartyRole apr INNER JOIN dbo.Agreement a ON apr.AgreementId = a.AgreementId AND apr.TenantId = a.TenantId');
});
it('completes ON using the aliases already written',async()=>{
  const {apply}=await complete('SELECT * FROM Agreement a JOIN AgreementPartyRole p ON |');
  expect(apply()).toContain('ON a.AgreementId = p.AgreementId AND a.TenantId = p.TenantId');
});
it('loads alias columns even when cursor precedes FROM and shows key/type details',async()=>{
  const {result,apply}=await complete('SELECT a.Ag| FROM Agreement a');
  expect(apply()).toBe('SELECT a.AgreementId FROM Agreement a');
  expect(result!.options[0].detail).toBe('int · PK · FK');
  expect(load).toHaveBeenCalledWith(agreement);
});
it('keeps multiple foreign keys as separate choices',async()=>{
  const source={...catalog,load:async()=>({columns:[],relationships:[relationship,{...relationship,id:'2',name:'FK_Secondary',columns:['SecondaryId'],targetColumns:['AgreementId']}]})};
  const {result}=await complete('SELECT * FROM Agreement a JOIN |','sqlserver',source);
  expect(result!.options.filter(o=>o.boost===20).map(o=>o.detail)).toEqual(['FK_Agreement','FK_Secondary']);
});
it('avoids alias collisions',async()=>{
  const {apply}=await complete('SELECT * FROM Agreement apr JOIN |');
  expect(apply()).toContain('AgreementPartyRole apr2 ON apr.AgreementId = apr2.AgreementId');
});
it('quotes PostgreSQL identifiers',async()=>{
  const {apply}=await complete('SELECT * FROM "dbo"."Agreement" a JOIN |','postgres');
  expect(apply()).toContain('dbo."AgreementPartyRole" apr ON a."AgreementId" = apr."AgreementId"');
});
it.each(["SELECT 'a.|' FROM Agreement a",'SELECT * FROM Agreement a -- JOIN |','WITH a AS (SELECT * FROM Agreement) SELECT * FROM a JOIN |'])('does not guess across strings/comments or unsupported CTE scopes: %s',async(input)=>{
  expect((await complete(input)).result).toBeNull();
});
const scopedCatalog: CompletionCatalog={tables:[agreement,party],load:async table=>({
  columns:(table.name===agreement.name?['AgreementId','AgreementName']:['AgreementId','AgreementPartyRoleId','RoleName']).map(name=>({name,type:'int',nullable:false})),
  relationships:[relationship],
})};
it.each([
  'SELECT * FROM Agreement where Agreement.AgreementId in (select AgreementPartyRole.Ag| from AgreementPartyRole where AgreementPartyRole.AgreementPartyRoleId = 43)',
  'SELECT * FROM Agreement where Agreement.AgreementId in (select AgreementPartyRole.AgreementId from AgreementPartyRole where AgreementPartyRole.Ag| = 43)',
  'SELECT * FROM Agreement where Agreement.AgreementId in (select AgreementPartyRole.AgreementId from AgreementPartyRole where AgreementPartyRole.Ag|',
])('loads subquery table columns in SELECT and WHERE, including unfinished SQL: %s',async input=>{
  const {result}=await complete(input,'sqlserver',scopedCatalog);
  expect(result!.options.map(o=>o.label)).toEqual(['AgreementId','AgreementPartyRoleId','RoleName']);
});
it('offers local columns and table qualifiers inside an unqualified subquery expression',async()=>{
  const {result}=await complete('SELECT * FROM Agreement a WHERE EXISTS (SELECT | FROM AgreementPartyRole p)','sqlserver',scopedCatalog);
  const names=result!.options.map(o=>o.label);
  expect(names).toContain('RoleName');expect(names).not.toContain('AgreementName');expect(names).toContain('p');expect(names).toContain('a');
});
it('resolves correlated outer aliases without exposing inner aliases outside their scope',async()=>{
  const inner=await complete('SELECT * FROM Agreement a WHERE EXISTS (SELECT 1 FROM AgreementPartyRole p WHERE a.| = p.AgreementId)','sqlserver',scopedCatalog);
  expect(inner.result!.options.map(o=>o.label)).toEqual(['AgreementId','AgreementName']);
  const outer=await complete('SELECT a.| FROM Agreement a WHERE EXISTS (SELECT 1 FROM AgreementPartyRole p)','sqlserver',scopedCatalog);
  expect(outer.result!.options.map(o=>o.label)).toEqual(['AgreementId','AgreementName']);
  const invalid=await complete('SELECT p.| FROM Agreement a WHERE EXISTS (SELECT 1 FROM AgreementPartyRole p)','sqlserver',scopedCatalog);
  expect(invalid.result!.options).toEqual([]);
});
it('uses the nearest alias when a subquery shadows an outer alias',async()=>{
  const {result}=await complete('SELECT * FROM Agreement x WHERE EXISTS (SELECT 1 FROM AgreementPartyRole x WHERE x.|)','sqlserver',scopedCatalog);
  expect(result!.options.map(o=>o.label)).toContain('RoleName');expect(result!.options.map(o=>o.label)).not.toContain('AgreementName');
});
it('does not borrow aliases from sibling subqueries',async()=>{
  const {result}=await complete('SELECT * FROM Agreement a WHERE EXISTS (SELECT 1 FROM AgreementPartyRole p) AND EXISTS (SELECT 1 FROM Agreement x WHERE p.|)','sqlserver',scopedCatalog);
  expect(result!.options).toEqual([]);
});
it('keeps nested FK JOIN suggestions local to the subquery',async()=>{
  const {apply}=await complete('SELECT * FROM Agreement outer_a WHERE EXISTS (SELECT * FROM AgreementPartyRole p JOIN |)','sqlserver',scopedCatalog);
  expect(apply()).toContain('JOIN dbo.Agreement a ON p.AgreementId = a.AgreementId');
  expect(apply()).not.toContain('ON outer_a.');
});
it('supports nested PostgreSQL scopes with quoted identifiers',async()=>{
  const {result}=await complete('SELECT * FROM "Agreement" a WHERE EXISTS (SELECT p.| FROM "AgreementPartyRole" p)','postgres',scopedCatalog);
  expect(result!.options.find(o=>o.label==='RoleName')?.apply).toBe('"RoleName"');
});
it('does not correlate a derived table against its containing FROM scope',async()=>{
  const {result}=await complete('SELECT * FROM Agreement a JOIN (SELECT a.| FROM AgreementPartyRole p) d ON 1=1','sqlserver',scopedCatalog);
  expect(result!.options).toEqual([]);
});
it('fails gracefully when catalog permissions are unavailable',async()=>{
  const source={...catalog,load:async()=>{throw new Error('permission denied');}};
  const {result}=await complete('SELECT a.| FROM Agreement a','sqlserver',source);
  expect(result).toBeNull();
});
it('groups composite FK rows without mixing distinct constraints',()=>{
  const rows=[['1','FK','dbo','Child','dbo','Parent','A','X'],['1','FK','dbo','Child','dbo','Parent','B','Y'],['2','FK2','dbo','Child','dbo','Parent','C','Z']];
  const parsed=parseRelationships(rows);
  expect(parsed[0].columns).toEqual(['A','B']); expect(parsed[0].targetColumns).toEqual(['X','Y']); expect(parsed).toHaveLength(2);
});
it('queries both ends of relationships and escapes catalog names',()=>{
  expect(relationshipsSql({...agreement,name:"O'Brien"},'sqlserver')).toContain("OBJECT_ID(N'[dbo].[O''Brien]')");
  expect(relationshipsSql(agreement,'postgres')).toContain('unnest(k.conkey,k.confkey) WITH ORDINALITY');
});
