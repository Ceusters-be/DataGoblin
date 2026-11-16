// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from './testUtils';
import { EditorView } from '@codemirror/view';
import { completionStatus, startCompletion } from '@codemirror/autocomplete';
import Editor from './Editor.vue';
import type { CompletionCatalog } from './completionMetadata';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup(value: string, completionCatalog?: CompletionCatalog) {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => []
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect()
  });
  const props = {
    completionCatalog,
    value,
    engine: 'sqlserver' as const,
    schema: {
      Agreement: ['AgreementId']
    },
    onChange: vi.fn(),
    onRun: vi.fn(),
    onSave: vi.fn()
  };
  const rendered = await render(<Editor {...props} />);
  const view = EditorView.findFromDOM(rendered.container.querySelector('.cm-editor')!)!;
  await act(() => {
    view.dispatch({
      selection: {
        anchor: value.length
      }
    });
    view.focus();
  });
  return {
    view,
    props,
    ...rendered
  };
}
it.each(['Control', 'Meta'])('%s+A selects only the SQL and prevents page selection, including repeated presses', async modifier => {
  const {view,container}=await setup('select * from Agreement;');
  for (const target of [view.contentDOM, view.contentDOM, container.querySelector('.editor')!]) {
    const event=new KeyboardEvent('keydown',{key:'a',code:'KeyA',ctrlKey:modifier==='Control',metaKey:modifier==='Meta',bubbles:true,cancelable:true});
    await act(()=>{target.dispatchEvent(event);});
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
    expect(view.hasFocus).toBe(true);
  }
});
it('keeps typing after replacing an executed query with a shorter document', async () => {
  const sql='SELECT * FROM Agreement';
  const {view,props,rerender,container}=await setup(sql);
  await rerender(<Editor {...props} execution={{document:sql,from:0,duration:12}} />);
  await waitFor(()=>expect(container.querySelector('.cm-execution-time')).not.toBeNull());
  await act(()=>{
    view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'sel '},userEvent:'input'});
    view.dispatch({changes:{from:4,insert:'x'},userEvent:'input'});
  });
  expect(view.state.doc.toString()).toBe('sel x');
  expect(container.querySelector('.cm-execution-time')).toBeNull();
});
it('Tab accepts an async FK join with a schema prefix and undo removes the whole insertion', async () => {
  const table={schema:'dbo',name:'Agreement',kind:'BASE TABLE'};
  const related={schema:'dbo',name:'AgreementPartyRole',kind:'BASE TABLE'};
  const value='SELECT * FROM Agreement a INNER JOIN dbo.Agr';
  const {view}=await setup(value, {tables:[table,related],load:async()=>({columns:[],relationships:[{id:'1',name:'FK_Agreement',source:related,target:table,columns:['AgreementId'],targetColumns:['AgreementId']}]})});
  await act(()=>{startCompletion(view);});
  await waitFor(()=>expect(completionStatus(view.state)).toBe('active'));
  await fireEvent.keyDown(view.contentDOM,{key:'Tab',code:'Tab'});
  expect(view.state.doc.toString()).toBe('SELECT * FROM Agreement a INNER JOIN dbo.AgreementPartyRole apr ON a.AgreementId = apr.AgreementId');
  await fireEvent.keyDown(view.contentDOM,{key:'z',code:'KeyZ',ctrlKey:true});
  expect(view.state.doc.toString()).toBe(value);
});
it('accepts a column completion inside an IN subquery without changing the surrounding SQL',async()=>{
  const sql='SELECT * FROM Agreement where Agreement.AgreementId in (select AgreementPartyRole.AgreementId from AgreementPartyRole where AgreementPartyRole.AgreementPartyRoleI = 43)';
  const catalog:CompletionCatalog={tables:[{schema:'dbo',name:'Agreement',kind:'BASE TABLE'},{schema:'dbo',name:'AgreementPartyRole',kind:'BASE TABLE'}],load:async table=>({columns:(table.name==='Agreement'?['AgreementId']:['AgreementId','AgreementPartyRoleId']).map(name=>({name,type:'int',nullable:false})),relationships:[]})};
  const {view}=await setup(sql,catalog);
  await act(()=>{
    view.dispatch({selection:{anchor:sql.indexOf(' = 43')}});
    startCompletion(view);
  });
  await waitFor(()=>expect(completionStatus(view.state)).toBe('active'));
  await fireEvent.keyDown(view.contentDOM,{key:'Tab',code:'Tab'});
  expect(view.state.doc.toString()).toBe(sql.replace('AgreementPartyRoleI =','AgreementPartyRoleId ='));
});
it('Tab accepts the visible sel snippet and selects its table placeholder', async () => {
  const {
    view
  } = await setup('sel');
  await act(() => {
    startCompletion(view);
  });
  await waitFor(() => expect(completionStatus(view.state)).toBe('active'));
  await fireEvent.keyDown(view.contentDOM, {
    key: 'Tab',
    code: 'Tab'
  });
  expect(view.state.doc.toString()).toBe('select * from table;');
  const selection=view.state.selection.main;
  expect(view.state.sliceDoc(selection.from,selection.to)).toBe('table');
});
it('offers the sel snippet with the FK completion catalog enabled', async () => {
  const load=vi.fn(async()=>({columns:[],relationships:[]}));
  const {view}=await setup('sel',{tables:[],load});
  await act(()=>{startCompletion(view);});
  await waitFor(()=>expect(completionStatus(view.state)).toBe('active'));
  await fireEvent.keyDown(view.contentDOM,{key:'Tab',code:'Tab'});
  expect(view.state.doc.toString()).toBe('select * from table;');
  expect(load).not.toHaveBeenCalled();
});
it('Tab accepts a table completion without quotes and undo restores the prefix', async () => {
  const {
    view
  } = await setup('SELECT * FROM Ag');
  await act(() => {
    startCompletion(view);
  });
  await waitFor(() => expect(completionStatus(view.state)).toBe('active'));
  await fireEvent.keyDown(view.contentDOM, {
    key: 'Tab',
    code: 'Tab'
  });
  expect(view.state.doc.toString()).toBe('SELECT * FROM Agreement');
  await fireEvent.keyDown(view.contentDOM, {
    key: 'z',
    code: 'KeyZ',
    ctrlKey: true
  });
  expect(view.state.doc.toString()).toBe('SELECT * FROM Ag');
});
it('does not reconfigure the editor after every ordinary text change', async () => {
  const {
    view,
    props,
    rerender
  } = await setup('SELECT 1');
  await act(() => view.dispatch({
    changes: {
      from: 8,
      insert: ';'
    }
  }));
  const dispatch = vi.spyOn(view, 'dispatch');
  rerender(<Editor {...props} value='SELECT 1;' />);
  expect(dispatch).not.toHaveBeenCalled();
});
it('Enter accepts a completion without running the query', async () => {
  const {
    view,
    props
  } = await setup('SELECT * FROM Ag');
  await act(() => {
    startCompletion(view);
  });
  await waitFor(() => expect(completionStatus(view.state)).toBe('active'));
  await fireEvent.keyDown(view.contentDOM, {
    key: 'Enter',
    code: 'Enter'
  });
  expect(view.state.doc.toString()).toBe('SELECT * FROM Agreement');
  expect(props.onRun).not.toHaveBeenCalled();
});
it('Escape dismisses completion without changing the SQL', async () => {
  const {
    view
  } = await setup('SELECT * FROM Ag');
  await act(() => {
    startCompletion(view);
  });
  await waitFor(() => expect(completionStatus(view.state)).toBe('active'));
  await fireEvent.keyDown(view.contentDOM, {
    key: 'Escape',
    code: 'Escape'
  });
  expect(completionStatus(view.state)).toBeNull();
  expect(view.state.doc.toString()).toBe('SELECT * FROM Ag');
});
it('does not expand the sel shortcut inside a SQL comment', async () => {
  const {
    view
  } = await setup('-- sel');
  await fireEvent.keyDown(view.contentDOM, {
    key: 'Tab',
    code: 'Tab'
  });
  expect(view.state.doc.toString().toLowerCase()).not.toContain('select * from');
});
