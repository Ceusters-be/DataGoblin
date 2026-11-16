// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from './testUtils';
import { shallowRef as createRef } from 'vue';
import { EditorView } from '@codemirror/view';
import Editor from './Editor.vue';
import { type EditorHandle } from './Editor';
import { formatSql } from './sqlFormat';
afterEach(cleanup);
it.each(['sqlserver', 'postgres'] as const)('keeps a wildcard query compact in %s', engine => {
  const result = formatSql('SELECT\n *\nFROM\n    Agreement', engine);
  expect(result).toBe('SELECT *\nFROM Agreement');
  expect(formatSql(result, engine)).toBe(result);
});

it.each(['sqlserver', 'postgres'] as const)('keeps column lists readable and joins aligned in %s', engine => {
  const result = formatSql('select a.id, a.name from Agreement a left join Customer c on c.id=a.customer_id;', engine);
  expect(result).toBe('SELECT\n    a.id,\n    a.name\nFROM Agreement a\nLEFT JOIN Customer c ON c.id = a.customer_id;');
  expect(formatSql(result, engine)).toBe(result);
});

it.each(['sqlserver', 'postgres'] as const)('does not compact SQL-looking strings or comments in %s', engine => {
  const literal = "'SELECT\n    *\nFROM\n    Agreement'";
  const comment = '/* SELECT\n    *\nFROM\n    Agreement */';
  const result = formatSql(`select ${literal} as sample from Agreement;\nselect -- keep this comment\n* from Agreement;\n${comment}`, engine);
  expect(result).toContain(literal);
  // The formatter normalizes comment indentation, but must not join its lines.
  expect(result).toContain('/* SELECT\n*\nFROM\nAgreement */');
  expect(result).toMatch(/SELECT\s+-- keep this comment\n\s*\*/);
  expect(formatSql(result, engine)).toBe(result);
});

it('compacts nested wildcard queries without losing their indentation', () => {
  const result = formatSql('select * from (select * from Agreement) a;', 'sqlserver');
  expect(result).toBe('SELECT *\nFROM (\n    SELECT *\n    FROM Agreement\n) a;');
  expect(formatSql(result, 'sqlserver')).toBe(result);
});

async function setup(value: string) {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => []
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect()
  });
  const ref = createRef<EditorHandle>();
  const onFormatError = vi.fn();
  const onRun = vi.fn();
  const onChange = vi.fn();
  const rendered = await render(() => <Editor ref={value => {
    ref.value = value as unknown as EditorHandle;
  }} value={value} engine='sqlserver' schema={{}} onFormatError={onFormatError} onChange={onChange} onRun={onRun} onSave={() => {}} />);
  const view = EditorView.findFromDOM(rendered.container.querySelector('.cm-editor')!)!;
  return {
    ref,
    view,
    onFormatError,
    onRun,
    onChange
  };
}
it('formats T-SQL while preserving identifiers, parameters, literals and comments', () => {
  const result = formatSql('select [User], @id from dbo.Agreement where name=N\'keep lower\' -- keep comment\n;', 'sqlserver');
  expect(result).toContain('SELECT\n');
  for (const value of ['[User]', '@id', 'dbo.Agreement', 'N\'keep lower\'', '-- keep comment']) expect(result).toContain(value);
  expect(formatSql(result, 'sqlserver')).toBe(result);
});
it('supports PostgreSQL casts, positional parameters and quoted identifiers', () => {
  const result = formatSql('select "UserName", $1::uuid from public.users where active=true;', 'postgres');
  expect(result).toContain('"UserName"');
  expect(result).toContain('$1::uuid');
  expect(result).toContain('SELECT\n');
});
it('formats the document by shortcut and can undo in one step without running it', async () => {
  const original = 'select * from dbo.Agreement where id=1;';
  const {
    view,
    onRun,
    onChange
  } = await setup(original);
  await fireEvent.keyDown(view.contentDOM, {
    key: 'l',
    code: 'KeyL',
    ctrlKey: true,
    altKey: true
  });
  expect(view.state.doc.toString()).toBe(formatSql(original, 'sqlserver'));
  expect(onChange).toHaveBeenCalled();
  expect(onRun).not.toHaveBeenCalled();
  await fireEvent.keyDown(view.contentDOM, {
    key: 'z',
    code: 'KeyZ',
    ctrlKey: true
  });
  expect(view.state.doc.toString()).toBe(original);
});
it('toolbar handle formats only the selection and retains it', async () => {
  const prefix = 'select 1;\n';
  const sql = 'select * from dbo.Agreement;';
  const suffix = '\nselect 2;';
  const {
    ref,
    view
  } = await setup(prefix + sql + suffix);
  await act(() => view.dispatch({
    selection: {
      anchor: prefix.length,
      head: prefix.length + sql.length
    }
  }));
  await act(() => ref.value!.format());
  const formatted = formatSql(sql, 'sqlserver');
  expect(view.state.doc.toString()).toBe(prefix + formatted + suffix);
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(formatted);
});
it('leaves invalid SQL untouched and reports the error', async () => {
  const original = 'select \'unterminated';
  const {
    ref,
    view,
    onFormatError,
    onChange
  } = await setup(original);
  await act(() => ref.value!.format());
  expect(view.state.doc.toString()).toBe(original);
  expect(onChange).not.toHaveBeenCalled();
  expect(onFormatError).toHaveBeenCalledWith(expect.stringContaining('Could not format SQL:'));
});
