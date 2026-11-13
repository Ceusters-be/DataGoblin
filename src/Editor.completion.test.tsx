// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { completionStatus, startCompletion } from '@codemirror/autocomplete';
import { Editor } from './Editor';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function setup(value: string) {
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[]});
  Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,value:()=>new DOMRect()});
  const props={value,engine:'sqlserver' as const,schema:{Agreement:['AgreementId']},onChange:vi.fn(),onRun:vi.fn(),onSave:vi.fn()};
  const rendered=render(<Editor {...props}/>);
  const view=EditorView.findFromDOM(rendered.container.querySelector('.cm-editor')!)!;
  act(()=>{view.dispatch({selection:{anchor:value.length}});view.focus();});
  return {view,props,...rendered};
}
it('Tab accepts the visible SELECT completion instead of expanding the sel snippet', async()=>{
  const {view}=setup('sel');
  act(()=>{startCompletion(view);});
  await waitFor(()=>expect(completionStatus(view.state)).toBe('active'));
  fireEvent.keyDown(view.contentDOM,{key:'Tab',code:'Tab'});
  expect(view.state.doc.toString()).toBe('SELECT');
});
it('Tab accepts a table completion without quotes and undo restores the prefix', async()=>{
  const {view}=setup('SELECT * FROM Ag');
  act(()=>{startCompletion(view);});
  await waitFor(()=>expect(completionStatus(view.state)).toBe('active'));
  fireEvent.keyDown(view.contentDOM,{key:'Tab',code:'Tab'});
  expect(view.state.doc.toString()).toBe('SELECT * FROM Agreement');
  fireEvent.keyDown(view.contentDOM,{key:'z',code:'KeyZ',ctrlKey:true});
  expect(view.state.doc.toString()).toBe('SELECT * FROM Ag');
});
it('does not reconfigure the editor after every ordinary text change',()=>{
  const {view,props,rerender}=setup('SELECT 1');
  act(()=>view.dispatch({changes:{from:8,insert:';'}}));
  const dispatch=vi.spyOn(view,'dispatch');
  rerender(<Editor {...props} value="SELECT 1;"/>);
  expect(dispatch).not.toHaveBeenCalled();
});

it('Enter accepts a completion without running the query', async()=>{
  const {view,props}=setup('SELECT * FROM Ag');
  act(()=>{startCompletion(view);});
  await waitFor(()=>expect(completionStatus(view.state)).toBe('active'));
  fireEvent.keyDown(view.contentDOM,{key:'Enter',code:'Enter'});
  expect(view.state.doc.toString()).toBe('SELECT * FROM Agreement');
  expect(props.onRun).not.toHaveBeenCalled();
});
it('Escape dismisses completion without changing the SQL', async()=>{
  const {view}=setup('SELECT * FROM Ag');
  act(()=>{startCompletion(view);});
  await waitFor(()=>expect(completionStatus(view.state)).toBe('active'));
  fireEvent.keyDown(view.contentDOM,{key:'Escape',code:'Escape'});
  expect(completionStatus(view.state)).toBeNull();
  expect(view.state.doc.toString()).toBe('SELECT * FROM Ag');
});
it('does not expand the sel shortcut inside a SQL comment',()=>{
  const {view}=setup('-- sel');
  fireEvent.keyDown(view.contentDOM,{key:'Tab',code:'Tab'});
  expect(view.state.doc.toString()).not.toContain('SELECT * FROM');
});
