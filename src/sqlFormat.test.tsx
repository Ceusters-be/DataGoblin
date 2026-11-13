// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { EditorView } from '@codemirror/view';
import { Editor, type EditorHandle } from './Editor';
import { formatSql } from './sqlFormat';
afterEach(cleanup);
function setup(value: string) {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  const ref = createRef<EditorHandle>();
  const onFormatError = vi.fn();
  const onRun = vi.fn();
  const onChange = vi.fn();
  const rendered = render(<Editor ref={ref} value={value} engine="sqlserver" schema={{}} onFormatError={onFormatError} onChange={onChange} onRun={onRun} onSave={() => {}}/>);
  const view = EditorView.findFromDOM(rendered.container.querySelector('.cm-editor')!)!;
  return { ref, view, onFormatError, onRun, onChange };
}
it('formats T-SQL while preserving identifiers, parameters, literals and comments', () => {
  const result = formatSql("select [User], @id from dbo.Agreement where name=N'keep lower' -- keep comment\n;", 'sqlserver');
  expect(result).toContain('SELECT\n');
  for (const value of ['[User]', '@id', 'dbo.Agreement', "N'keep lower'", '-- keep comment']) expect(result).toContain(value);
  expect(formatSql(result, 'sqlserver')).toBe(result);
});
it('supports PostgreSQL casts, positional parameters and quoted identifiers', () => {
  const result = formatSql('select "UserName", $1::uuid from public.users where active=true;', 'postgres');
  expect(result).toContain('"UserName"');
  expect(result).toContain('$1::uuid');
  expect(result).toContain('SELECT\n');
});
it('formats the document by shortcut and can undo in one step without running it', () => {
  const original = 'select * from dbo.Agreement where id=1;';
  const { view, onRun, onChange } = setup(original);
  fireEvent.keyDown(view.contentDOM, { key: 'l', code: 'KeyL', ctrlKey: true, altKey: true });
  expect(view.state.doc.toString()).toBe(formatSql(original, 'sqlserver'));
  expect(onChange).toHaveBeenCalled();
  expect(onRun).not.toHaveBeenCalled();
  fireEvent.keyDown(view.contentDOM, { key: 'z', code: 'KeyZ', ctrlKey: true });
  expect(view.state.doc.toString()).toBe(original);
});
it('toolbar handle formats only the selection and retains it', () => {
  const prefix = 'select 1;\n';
  const sql = 'select * from dbo.Agreement;';
  const suffix = '\nselect 2;';
  const { ref, view } = setup(prefix + sql + suffix);
  act(() => view.dispatch({ selection: { anchor: prefix.length, head: prefix.length + sql.length } }));
  act(() => ref.current!.format());
  const formatted = formatSql(sql, 'sqlserver');
  expect(view.state.doc.toString()).toBe(prefix + formatted + suffix);
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(formatted);
});
it('leaves invalid SQL untouched and reports the error', () => {
  const original = "select 'unterminated";
  const { ref, view, onFormatError, onChange } = setup(original);
  act(() => ref.current!.format());
  expect(view.state.doc.toString()).toBe(original);
  expect(onChange).not.toHaveBeenCalled();
  expect(onFormatError).toHaveBeenCalledWith(expect.stringContaining('Could not format SQL:'));
});
