// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from './testUtils';
import DatabaseExplorer from './DatabaseExplorer.vue';
import type { Connection } from './types';
import { shallowRef } from 'vue';
import { within } from './testUtils';
import type { ExplorerScope } from './explorerScope';

it('selects databases and schemas independently and keeps routines separate from tables', async () => {
  const c: Connection = { id: 'scoped', name: 'SQL server', database: 'Sales', engine: 'sqlserver', host: 'localhost', port: 1433, username: 'test', tls: false, trustCertificate: false };
  const scope = shallowRef<ExplorerScope>({ databases: {}, schemas: {} });
  const browse = vi.fn().mockResolvedValue(true);
  const change = vi.fn(async (connection: Connection, level: 'databases' | 'schemas', choice: string[] | null) => {
    const key = level === 'databases' ? connection.id : JSON.stringify([connection.id, connection.database]);
    scope.value = { ...scope.value, [level]: { ...scope.value[level], [key]: choice } };
  });
  await render(() => <DatabaseExplorer connections={[c]} scope={scope.value} schemas={{ '["scoped","master"]': ['dbo', 'audit'], '["scoped","Sales"]': ['dbo', 'wings'] }}
    databases={{ scoped: ['master', 'Sales', 'Archive'] }} tables={{ '["scoped","master"]': [], '["scoped","Sales"]': [{ schema: 'wings', name: 'Orders', kind: 'BASE TABLE' }, { schema: 'wings', name: 'OrderView', kind: 'VIEW' }] }}
    routines={{ '["scoped","Sales"]': [{ schema: 'wings', name: 'Recalculate', kind: 'PROCEDURE' }] }}
    objects={{}} columns={{}} onScopeChange={change} onBrowse={browse} onColumns={vi.fn()} onSelect={vi.fn()} onOpen={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', { name: 'SQL server' }));
  await screen.findByRole('button', { name: 'Database master on SQL server' });
  expect(screen.queryByRole('button', { name: 'Database Sales on SQL server' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Choose databases on SQL server' }).textContent).toBe('1 of 3');
  expect(browse.mock.calls.every(([connection]) => connection.database === 'master')).toBe(true);
  await fireEvent.click(screen.getByRole('button', { name: 'Choose databases on SQL server' }));
  const dbPicker = await screen.findByRole('dialog');
  await fireEvent.click(within(dbPicker).getByLabelText('Sales'));
  await fireEvent.keyDown(dbPicker, { key: 'Enter' });
  expect(scope.value.databases.scoped).toEqual(['master', 'Sales']);
  expect(screen.getByRole('button', { name: 'Choose databases on SQL server' }).textContent).toBe('2 of 3');
  await fireEvent.click(screen.getByRole('button', { name: 'Database Sales on SQL server' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Choose schemas in Sales' }));
  const schemaPicker = await screen.findByRole('dialog');
  await fireEvent.click(within(schemaPicker).getByLabelText('wings'));
  await fireEvent.click(within(schemaPicker).getByLabelText('dbo'));
  await fireEvent.pointerDown(document.body);
  expect(scope.value.schemas['["scoped","Sales"]']).toEqual(['wings']);
  expect(screen.getByText('Recalculate').closest('.explorer-routine')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Expand columns for wings.Recalculate' })).toBeNull();
  expect(screen.getAllByText('Routines').length).toBeGreaterThan(0);
  await fireEvent.click(screen.getByRole('button', { name: 'Choose schemas in Sales' }));
  const cancelled = await screen.findByRole('dialog');
  await fireEvent.click(within(cancelled).getByLabelText('All schemas'));
  await fireEvent.keyDown(cancelled, { key: 'Escape' });
  expect(scope.value.schemas['["scoped","Sales"]']).toEqual(['wings']);
});
afterEach(cleanup);
it('opens, copies and refreshes the table from its own database context', async () => {
  const c: Connection = {
    id: 'sql',
    name: 'Server',
    database: 'Sales',
    engine: 'sqlserver',
    host: 'localhost',
    port: 1433,
    username: 'test',
    tls: false,
    trustCertificate: false
  };
  const table = {
    schema: 'dbo',
    name: 'Orders',
    kind: 'BASE TABLE'
  };
  const browse = vi.fn().mockResolvedValue(true),
    columns = vi.fn().mockResolvedValue(undefined),
    open = vi.fn(),
    writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText
    }
  });
  await render(<DatabaseExplorer connections={[c]} databases={{
    sql: ['Sales']
  }} tables={{
    '["sql","Sales"]': [table]
  }} columns={{}} objects={{}} onBrowse={browse} onColumns={columns} onSelect={vi.fn()} onOpen={open} onEdit={vi.fn()} onNew={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Server'
  }));
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  await fireEvent.change(screen.getByLabelText('Filter tables'), {
    target: {
      value: 'Orders'
    }
  });
  const target = screen.getByRole('button', {
    name: 'Expand columns for dbo.Orders'
  });
  await fireEvent.contextMenu(target);
  await fireEvent.click(screen.getByRole('menuitem', {
    name: 'Copy qualified name'
  }));
  expect(writeText).toHaveBeenCalledWith('[dbo].[Orders]');
  await fireEvent.contextMenu(target);
  await fireEvent.click(screen.getByRole('menuitem', {
    name: 'Refresh metadata'
  }));
  expect(columns).toHaveBeenCalledWith(c, table, true);
  await fireEvent.keyDown(target, {
    key: 'F10',
    shiftKey: true
  });
  await fireEvent.click(screen.getByRole('menuitem', {
    name: 'Open query'
  }));
  expect(open).toHaveBeenCalledWith(c, table);
});
it('reveals the requested database and table with collapsed branches', async () => {
  const c: Connection = {
    id: 'sql',
    name: 'Server',
    database: 'Sales',
    engine: 'sqlserver',
    host: 'localhost',
    port: 1433,
    username: 'test',
    tls: false,
    trustCertificate: false
  };
  const table = {
    schema: 'dbo',
    name: 'Orders',
    kind: 'BASE TABLE'
  };
  const columns = vi.fn().mockResolvedValue(undefined);
  await render(<DatabaseExplorer reveal={{
    connection: c,
    table,
    id: 'reveal-1'
  }} connections={[{
    ...c,
    database: 'master'
  }]} databases={{}} tables={{
    '["sql","Sales"]': [table]
  }} columns={{}} objects={{}} onBrowse={vi.fn()} onColumns={columns} onSelect={vi.fn()} onOpen={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} />);
  const button = await screen.findByRole('button', {
    name: 'Expand columns for dbo.Orders'
  });
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(columns).toHaveBeenCalledWith(c, table);
  await waitFor(() => expect(document.activeElement).toBe(button));
});

it('offers server actions without changing the query context and refreshes only selected databases', async () => {
  const c: Connection = { id: 'menu', name: 'Menu server', database: 'Configured', engine: 'sqlserver', host: 'localhost', port: 1433, username: 'test', tls: false, trustCertificate: false };
  const browse = vi.fn().mockResolvedValue(true), open = vi.fn(), edit = vi.fn(), select = vi.fn();
  await render(<DatabaseExplorer connections={[c]} scope={{ databases: { menu: ['master', 'Sales'] }, schemas: {} }}
    databases={{ menu: ['master', 'Sales', 'Archive'] }} tables={{}} columns={{}} objects={{}}
    onBrowse={browse} onColumns={vi.fn()} onOpen={open} onEdit={edit} onSelect={select} onNew={vi.fn()} />);
  const server = screen.getByRole('button', { name: 'Menu server' });
  await fireEvent.contextMenu(server);
  expect(screen.getByRole('menu', { name: 'Server actions for Menu server' })).toBeTruthy();
  await fireEvent.click(screen.getByRole('menuitem', { name: 'New query' }));
  expect(open).toHaveBeenCalledWith({ ...c, database: 'master' });
  expect(select).not.toHaveBeenCalled();
  expect(server.getAttribute('aria-expanded')).toBe('false');
  await fireEvent.contextMenu(server);
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));
  await waitFor(() => expect(browse).toHaveBeenCalledTimes(2));
  expect(browse).toHaveBeenCalledWith({ ...c, database: 'master' }, true);
  expect(browse).toHaveBeenCalledWith({ ...c, database: 'Sales' }, true);
  await fireEvent.keyDown(server, { key: 'F10', shiftKey: true });
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit connection' }));
  expect(edit).toHaveBeenCalledWith(c);
  await fireEvent.contextMenu(server);
  await fireEvent.click(screen.getByRole('menuitem', { name: /Choose databases/ }));
  const picker = await screen.findByRole('dialog', { name: 'Databases on Menu server' });
  expect(within(picker).getByLabelText('Archive')).toBeTruthy();
  expect(screen.queryByRole('menu')).toBeNull();
  await fireEvent.keyDown(picker, { key: 'Escape' });
  expect(document.activeElement).toBe(server);
});

it('binds database context actions to the clicked database and supports keyboard dismissal', async () => {
  const c: Connection = { id: 'dbmenu', name: 'Database server', database: 'master', engine: 'sqlserver', host: 'localhost', port: 1433, username: 'test', tls: false, trustCertificate: false };
  const sales = { ...c, database: 'Sales' };
  const browse = vi.fn().mockResolvedValue(true), open = vi.fn(), select = vi.fn();
  await render(<DatabaseExplorer connections={[c]} scope={{ databases: { dbmenu: ['master', 'Sales'] }, schemas: {} }}
    schemas={{ '["dbmenu","Sales"]': ['dbo', 'wings'] }} databases={{ dbmenu: ['master', 'Sales'] }} tables={{}} columns={{}} objects={{}}
    onBrowse={browse} onColumns={vi.fn()} onOpen={open} onEdit={vi.fn()} onSelect={select} onNew={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', { name: 'Database server' }));
  await waitFor(() => expect(browse).toHaveBeenCalledWith(sales, false));
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  select.mockClear();
  browse.mockClear();
  const database = screen.getByRole('button', { name: 'Database Sales on Database server' });
  await fireEvent.contextMenu(database);
  expect(screen.getByRole('menu', { name: 'Database actions for Sales' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Edit connection' })).toBeNull();
  await fireEvent.click(screen.getByRole('menuitem', { name: 'New query' }));
  expect(open).toHaveBeenCalledWith(sales);
  expect(select).not.toHaveBeenCalled();
  await fireEvent.contextMenu(database);
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));
  await waitFor(() => expect(browse).toHaveBeenCalledWith(sales, true));
  expect(browse).toHaveBeenCalledTimes(1);
  await fireEvent.keyDown(database, { key: 'ContextMenu' });
  const menu = screen.getByRole('menu');
  await fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(database);
  await fireEvent.contextMenu(database);
  await fireEvent.click(screen.getByRole('menuitem', { name: /Choose schemas/ }));
  const picker = await screen.findByRole('dialog', { name: 'Schemas in Sales' });
  expect(within(picker).getByLabelText('wings')).toBeTruthy();
});

it('opens schema actions with the schema database and refreshes only that schema', async () => {
  const c: Connection = { id: 'schema-menu', name: 'Schema server', database: 'Sales', engine: 'sqlserver', host: 'localhost', port: 1433, username: 'test', tls: false, trustCertificate: false };
  const browse = vi.fn().mockResolvedValue(true), refresh = vi.fn().mockResolvedValue(true), open = vi.fn();
  await render(<DatabaseExplorer connections={[c]} databases={{ [c.id]: ['Sales'] }} tables={{ '["schema-menu","Sales"]': [{ schema: 'wings', name: 'Orders', kind: 'BASE TABLE' }] }}
    columns={{}} objects={{}} onBrowse={browse} onRefreshSchema={refresh} onColumns={vi.fn()} onOpen={open} onSelect={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', { name: 'Schema server' }));
  const schema = (await screen.findByText('wings')).closest('summary')!;
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  browse.mockClear();
  await fireEvent.contextMenu(schema);
  expect(screen.getByRole('menu', { name: 'Schema actions for wings' })).toBeTruthy();
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));
  expect(refresh).toHaveBeenCalledWith(c, 'wings');
  expect(browse).not.toHaveBeenCalled();
  await fireEvent.keyDown(schema, { key: 'F10', shiftKey: true });
  await fireEvent.click(screen.getByRole('menuitem', { name: 'New query' }));
  expect(open).toHaveBeenCalledWith(c);
  expect(document.activeElement).toBe(schema);
});
