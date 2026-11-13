import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { identifierCompletion, schemaCompletions, sqlEditorLanguage } from './sqlCompletion';
import type { Engine } from './types';
const schema = {Agreement:['AgreementId','name','select'], 'dbo.Agreement':['AgreementId'], users:['name'], 'Order Items':[], 'a]b':[], 'a"b':[]};
function complete(input: string, name: string, engine: Engine = 'sqlserver') {
  const pos=input.indexOf('|'), doc=input.replace('|','');
  const state=EditorState.create({doc,extensions:sqlEditorLanguage(engine,schema)});
  const result=schemaCompletions(engine,schema)(new CompletionContext(state,pos,true));
  expect(result).not.toBeNull();
  const option=result!.options.find(o=>o.label===name || o.label==='['+name+']' || o.label==='"'+name+'"');
  expect(option).toBeTruthy();
  return doc.slice(0,result!.from)+(option!.apply ?? option!.label)+doc.slice(result!.to ?? pos);
}
it('inserts SQL Server names without quotes, including uppercase and qualified columns', () => {
  expect(complete('SELECT * FROM Ag|','Agreement')).toBe('SELECT * FROM Agreement');
  expect(complete('SELECT * FROM dbo.Ag|','Agreement')).toBe('SELECT * FROM dbo.Agreement');
  expect(complete('SELECT a.Ag| FROM dbo.Agreement a','AgreementId')).toBe('SELECT a.AgreementId FROM dbo.Agreement a');
});
it('quotes reserved words and unusual identifiers, escaping delimiters', () => {
  expect(identifierCompletion('User','sqlserver')).toBe('[User]');
  expect(complete('SELECT * FROM Or|','Order Items')).toBe('SELECT * FROM [Order Items]');
  expect(identifierCompletion('a]b','sqlserver')).toBe('[a]]b]');
  expect(identifierCompletion('a"b','postgres')).toBe('"a""b"');
  expect(identifierCompletion('name','postgres')).toBe('name');
  expect(identifierCompletion('value','sqlserver')).toBe('value');
});
it('preserves PostgreSQL case sensitivity without quoting ordinary lowercase names', () => {
  expect(complete('SELECT * FROM us|','users','postgres')).toBe('SELECT * FROM users');
  expect(complete('SELECT * FROM Ag|','Agreement','postgres')).toBe('SELECT * FROM "Agreement"');
});
it('preserves explicit quoting, replaces the rest of a word and does not double the closing quote', () => {
  expect(complete('SELECT * FROM [Ag|]','Agreement')).toBe('SELECT * FROM [Agreement]');
  expect(complete('SELECT * FROM "Ag|"','Agreement')).toBe('SELECT * FROM "Agreement"');
  expect(complete('SELECT * FROM Agr|eement','Agreement')).toBe('SELECT * FROM Agreement');
  expect(complete('SELECT * FROM [a|]','a]b')).toBe('SELECT * FROM [a]]b]');
});
it.each(["SELECT 'Ag|';",'SELECT 1 -- Ag|','/* Ag| */'])('does not suggest schema names inside strings or comments: %s', input => {
  const pos=input.indexOf('|'), state=EditorState.create({doc:input.replace('|',''),extensions:sqlEditorLanguage('sqlserver',schema)});
  expect(schemaCompletions('sqlserver',schema)(new CompletionContext(state,pos,true))).toBeNull();
});
