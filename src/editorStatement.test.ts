import { expect, it } from 'vitest';
import { statementOutlineBox } from './editorStatement';
import { statementRangeAt, statementAt } from './sql';

it('outlines the entire outer statement when the cursor is in a subquery',()=>{
  const doc='SELECT 1;\n\nSELECT *\nFROM Agreement\nWHERE AgreementId IN (\n  SELECT AgreementId FROM AgreementPartyRole\n);\n\nSELECT 3;';
  const range=statementRangeAt(doc,doc.indexOf('  SELECT')+4,'sqlserver');
  expect(doc.slice(range.from,range.to)).toBe('SELECT *\nFROM Agreement\nWHERE AgreementId IN (\n  SELECT AgreementId FROM AgreementPartyRole\n);');
});
it('sizes the box to text rectangles rather than the editor width',()=>{
  expect(statementOutlineBox([{left:10,top:20,width:60,height:20},{left:10,top:40,width:210,height:20},{left:10,top:60,width:16,height:20}])).toEqual({left:8,top:19,width:214,height:62});
  expect(statementOutlineBox([])).toBeNull();
});
it('separates the reported queries without splitting the nested SELECT',()=>{
  const first='SELECT *\nFROM Agreement\nWHERE AgreementId IN (\n SELECT AgreementPartyRole.AgreementId\n FROM AgreementPartyRole\n WHERE AgreementPartyRole.AgreementPartyRoleId = 43\n)';
  const second='select * from ProformaReport;';
  const doc=first+'\n\n'+second;
  expect(statementAt(doc,doc.indexOf('SELECT Agreement'),'sqlserver')).toBe(first);
  expect(statementAt(doc,doc.indexOf('ProformaReport'),'sqlserver')).toBe(second);
  expect(statementAt(doc,doc.indexOf('select * from'),'sqlserver')).toBe(second);
});
it.each([
  'SELECT id FROM a\nUNION ALL\nSELECT id FROM b;',
  'WITH a AS (\nSELECT 1 AS id\n)\nSELECT * FROM a;',
  'INSERT INTO a\nSELECT id FROM b;',
  'SELECT * FROM Agreement\nWITH (NOLOCK);',
  'SELECT * FROM a WHERE id IN (\nSELECT id FROM b\n);',
])('keeps compound queries together: %s',doc=>{
  expect(statementAt(doc,doc.lastIndexOf('SELECT'),'sqlserver')).toBe(doc);
});
it('uses the same boundaries as execution and ignores semicolons in literals and comments',()=>{
  const doc="  SELECT ';', $$;$$ /* ; */;\n SELECT 2;";
  const range=statementRangeAt(doc,10,'postgres');
  expect(doc.slice(range.from,range.to)).toBe("SELECT ';', $$;$$ /* ; */;");
  expect(statementAt(doc,10)).toBe(doc.slice(range.from,range.to));
});
