// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { Editor } from './Editor';
import { ThemeProvider } from './theme';
afterEach(cleanup);
it('reveals a table with Ctrl-click and opens data through the context menu', () => {
  const table = { schema: 'dbo', name: 'Users', kind: 'BASE TABLE' };
  const value = 'SELECT * FROM dbo.Users;';
  const reveal = vi.fn(), open = vi.fn();
  const { container } = render(<ThemeProvider><Editor value={value} engine="sqlserver" schema={{}} tables={[table]} onReveal={reveal} onOpenData={open} onChange={vi.fn()} onRun={vi.fn()} onSave={vi.fn()}/></ThemeProvider>);
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
  vi.spyOn(view, 'posAtCoords').mockReturnValue(value.indexOf('Users'));
  fireEvent.click(view.contentDOM, { ctrlKey: true, clientX: 100, clientY: 20 });
  expect(reveal).toHaveBeenCalledWith(table);
  fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 20 });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Open data' }));
  expect(open).toHaveBeenCalledWith(table);
});
