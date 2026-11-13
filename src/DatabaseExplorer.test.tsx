// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DatabaseExplorer } from './DatabaseExplorer';
import type { Connection } from './types';
afterEach(cleanup);
it('opens, copies and refreshes the table from its own database context', async () => {
  const c: Connection = { id: 'sql', name: 'Server', database: 'Sales', engine: 'sqlserver', host: 'localhost', port: 1433, username: 'test', tls: false, trustCertificate: false };
  const table = { schema: 'dbo', name: 'Orders', kind: 'BASE TABLE' };
  const browse = vi.fn().mockResolvedValue(true), columns = vi.fn().mockResolvedValue(undefined), open = vi.fn(), writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<DatabaseExplorer connections={[c]} databases={{ sql: ['Sales'] }} tables={{ '["sql","Sales"]': [table] }} columns={{}} objects={{}} onBrowse={browse} onColumns={columns} onSelect={vi.fn()} onOpen={open} onEdit={vi.fn()} onNew={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Server' }));
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  fireEvent.change(screen.getByLabelText('Filter tables'), { target: { value: 'Orders' } });
  const target = screen.getByRole('button', { name: 'Expand columns for dbo.Orders' });
  fireEvent.contextMenu(target);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy qualified name' }));
  expect(writeText).toHaveBeenCalledWith('[dbo].[Orders]');
  fireEvent.contextMenu(target);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh metadata' }));
  expect(columns).toHaveBeenCalledWith(c, table, true);
  fireEvent.keyDown(target, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Open query' }));
  expect(open).toHaveBeenCalledWith(c, table);
});
it('reveals the requested database and table with collapsed branches', async () => {
  const c: Connection = { id: 'sql', name: 'Server', database: 'Sales', engine: 'sqlserver', host: 'localhost', port: 1433, username: 'test', tls: false, trustCertificate: false };
  const table = { schema: 'dbo', name: 'Orders', kind: 'BASE TABLE' };
  const columns = vi.fn().mockResolvedValue(undefined);
  render(<DatabaseExplorer reveal={{ connection: c, table, id: 'reveal-1' }} connections={[{ ...c, database: 'master' }]} databases={{}} tables={{ '["sql","Sales"]': [table] }} columns={{}} objects={{}} onBrowse={vi.fn()} onColumns={columns} onSelect={vi.fn()} onOpen={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()}/>);
  const button = await screen.findByRole('button', { name: 'Expand columns for dbo.Orders' });
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(columns).toHaveBeenCalledWith(c, table);
  await waitFor(() => expect(document.activeElement).toBe(button));
});
