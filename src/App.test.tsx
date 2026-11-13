// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

const { invoke, openDialog, saveDialog } = vi.hoisted(() => ({ invoke: vi.fn(), openDialog: vi.fn(), saveDialog: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openDialog, save: saveDialog }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));
vi.mock('./Editor', () => ({ Editor: ({ value, onChange, onSave }: { value: string; onChange: (value: string) => void; onSave: () => void }) => <textarea onKeyDown={event => { if (event.ctrlKey && event.key === "s") onSave(); }} aria-label="SQL editor" value={value} onChange={event => onChange(event.target.value)}/> }));

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  openDialog.mockReset(); saveDialog.mockReset();
  invoke.mockImplementation(async (command: string, args?: { sql?: string }) => {
    if (command === 'load_connections') return [];
    if (command === 'query_library') return { folder: 'C:/AppData/DataGoblin/queries', defaultFolder: 'C:/AppData/DataGoblin/queries', queries: [] };
    if (args?.sql?.includes('information_schema.tables')) return { sets: [{ columns: ['table_schema', 'table_name', 'table_type'], rows: [['public', 'users', 'BASE TABLE']], affected: 1 }], elapsedMs: 2, truncated: false };
    if (args?.sql?.includes('pg_database')) return { sets: [{ columns: ['datname'], rows: [['postgres']], affected: 1 }], elapsedMs: 2, truncated: false };
    if (command === 'query') return { sets: [{ columns: ['value'], rows: [['1']], affected: 1 }], elapsedMs: 2, truncated: false };
    return undefined;
  });
});
afterEach(cleanup);

it('keeps the fetched page visible after progress updates and cancels an idle result stream', async () => {
  localStorage.setItem('datagoblin.pageSize', '10');
  const connection = { id: 'server', name: 'Local server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  const original = invoke.getMockImplementation()!;
  const firstRows = Array.from({ length: 10 }, (_, i) => [String(i + 1)]);
  const result = { cacheId: 'stream', pageSize: 10, complete: false, sets: [{ columns: ['id'], rows: firstRows, totalRows: 11, hasMore: true, pageSize: 10, affected: null }], elapsedMs: 25, truncated: false };
  invoke.mockImplementation(async (command, args) => {
    if (command === 'load_connections') return [connection];
    if (command === 'query' && args.sql === 'SELECT 42;') {
      expect(args.pageSize).toBe(10);
      return result;
    }
    if (command === 'result_column_keys') return [{ name: 'id', primaryKey: true, foreignKey: true }];
    if (command === 'result_page') return { rows: Array.from({ length: 10 }, (_, i) => [String(i + 11)]), totalRows: 21, hasMore: true, result: { ...result, sets: [{ ...result.sets[0], totalRows: 21 }] } };
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: /^Local server/ }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 42;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await screen.findByLabelText('1–10 of 11+');
  await screen.findByRole('img', { name: 'Primary key' });
  expect(invoke.mock.calls.some(([command]) => command === 'result_page')).toBe(false);
  fireEvent.click(screen.getByTitle('Next page'));
  await screen.findByLabelText('11–20 of 21+');
  expect(screen.getByRole('img', { name: 'Primary key' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Foreign key' })).toBeTruthy();
  expect(screen.getByText('postgres · 25 ms')).toBeTruthy();
  fireEvent.click(screen.getByTitle('Cancel query'));
  await screen.findByText('Result session closed. Run the query again to fetch more rows.');
  expect(invoke).toHaveBeenCalledWith('cancel_query', { requestId: 'stream' });
  expect((screen.getByTitle('Next page') as HTMLButtonElement).disabled).toBe(true);
});

it('requests cached execution and releases results when rerun or closed', async () => {
  const connection = { id: 'server', name: 'Local server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  const original = invoke.getMockImplementation()!;
  let executions = 0;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'load_connections') return [connection];
    if (command === 'query' && args.sql === 'SELECT 42;') {
      expect(args.paged).toBe(true);
      return { cacheId: 'cache-' + ++executions, sets: [{ columns: ['value'], rows: [['42']], totalRows: 1, affected: null }], elapsedMs: 1, truncated: false };
    }
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: /^Local server/ }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 42;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await screen.findByLabelText('1–1 of 1');
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('release_results', { cacheId: 'cache-1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close query' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('release_results', { cacheId: 'cache-2' }));
});

it('changes only the active query database on its existing server and executes there', async () => {
  const connection = { id: 'server', name: 'Local server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'load_connections') return [connection];
    if (args?.sql?.includes('pg_database')) return { sets: [{ columns: ['datname'], rows: [['postgres'], ['reporting']], affected: null }], elapsedMs: 1, truncated: false };
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: /^Local server/ }));
  const picker = await screen.findByRole('combobox', { name: 'Query database' });
  fireEvent.click(picker);
  await screen.findByRole('option', { name: 'reporting' });
  fireEvent.keyDown(screen.getByLabelText('Search query database'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'New query' }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 42;' } });
  fireEvent.click(screen.getByRole('combobox', { name: 'Query database' }));
  fireEvent.click(screen.getByRole('option', { name: 'reporting' }));
  const run = screen.getByRole('button', { name: 'Run all' });
  expect(run.textContent).toBe('');
  fireEvent.click(run);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('query', expect.objectContaining({ connection: expect.objectContaining({ id: 'server', database: 'reporting' }), sql: 'SELECT 42;' })));
  fireEvent.keyDown(screen.getByLabelText('SQL editor'), { key: 's', ctrlKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_library_query', { query: expect.objectContaining({ connectionId: 'server', database: 'reporting' }) }));
  fireEvent.click(screen.getByRole('button', { name: 'Query1' }));
  expect((screen.getByRole('combobox', { name: 'Query database' }) as HTMLSelectElement).value).toBe('postgres');
});

async function renameActiveQuery(name: string) {
  const current = document.querySelector('.tab.active > button')!.textContent!;
  const pane = within(screen.getByRole('region', { name: 'Saved queries' }));
  fireEvent.contextMenu(await pane.findByRole('button', { name: current }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  fireEvent.change(screen.getByLabelText('New query name'), { target: { value: name } });
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Rename query' })).getByRole('button', { name: 'Rename' }));
  await waitFor(() => expect(document.querySelector('.tab.active > button')?.textContent).toBe(name));
}


it('imports a connection string into reviewable fields and stores its password separately', async () => {
  render(<App/>);
  fireEvent.click(screen.getByRole('button', { name: 'New connection' }));
  fireEvent.click(screen.getByText('Paste a SQL Server connection string'));
  fireEvent.change(screen.getByLabelText('Connection string'), { target: { value: 'Server=tcp:db.example,1444;Database=Sales;User Id=reader;Password="test;secret";Encrypt=True' } });
  fireEvent.click(screen.getByRole('button', { name: 'Fill connection details' }));
  expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('db.example');
  expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('1444');
  expect((screen.getByLabelText('Initial database') as HTMLInputElement).value).toBe('Sales');
  expect((screen.getByLabelText('Connection string') as HTMLInputElement).value).toBe('');
  expect(invoke.mock.calls.some(call => call[0] === 'save_connections')).toBe(false);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add connection' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_password', expect.objectContaining({ password: 'test;secret' })));
  const saved = invoke.mock.calls.find(call => call[0] === 'save_connections')!;
  expect(saved[1].connections[0]).toMatchObject({ engine: 'sqlserver', host: 'db.example', port: 1444, database: 'Sales', username: 'reader' });
  expect(JSON.stringify(saved[1])).not.toContain('test;secret');
});

it('keeps existing form fields when connection-string import fails', () => {
  render(<App/>);
  fireEvent.click(screen.getByRole('button', { name: 'New connection' }));
  fireEvent.click(screen.getByText('Paste a SQL Server connection string'));
  fireEvent.change(screen.getByLabelText('Connection string'), { target: { value: 'Server=db;Integrated Security=True' } });
  fireEvent.click(screen.getByRole('button', { name: 'Fill connection details' }));
  expect(screen.getByRole('status').textContent).toContain('Windows integrated authentication is not supported');
  expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('localhost');
});

it('middle-click closes the targeted tab, saves its text, and preserves the active tab', async () => {
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 17;' } });
  fireEvent.click(screen.getByRole('button', { name: 'New query' }));
  const firstTab = screen.getByRole('button', { name: 'Query1' });
  fireEvent(firstTab, new MouseEvent('auxclick', { bubbles: true, button: 2 }));
  expect(screen.getAllByRole('button', { name: 'Close query' })).toHaveLength(2);
  fireEvent(firstTab, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Close query' })).toHaveLength(1));
  expect(document.querySelector('.tab.active > button')?.textContent?.replace(/\s+$/, '')).toBe('Query2');
  expect(invoke).toHaveBeenCalledWith('save_library_query', { query: expect.objectContaining({ name: 'Query1', sql: 'SELECT 17;' }) });
  fireEvent(screen.getByRole('button', { name: 'Query2' }), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
  await screen.findByRole('heading', { name: 'No queries open' });
});

it('pins, renames, unpins and deletes an open query through its context menu', async () => {
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 123;' } });
  fireEvent.keyDown(screen.getByLabelText('SQL editor'), { key: 's', ctrlKey: true });
  await screen.findByText('All queries saved');
  const pane = screen.getByRole('region', { name: 'Saved queries' });
  fireEvent.contextMenu(within(pane).getByRole('button', { name: 'Query1' }), { clientX: 300, clientY: 100 });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
  await within(pane).findByText('Pinned');
  expect(invoke).toHaveBeenCalledWith('save_library_query', { query: expect.objectContaining({ name: 'Query1', pinned: true, sql: 'SELECT 123;' }) });
  fireEvent.click(within(pane).getByRole('button', { name: 'Actions for Query1' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  fireEvent.change(screen.getByLabelText('New query name'), { target: { value: 'Customer report' } });
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Rename query' })).getByRole('button', { name: 'Rename' }));
  await waitFor(() => expect(document.querySelector('.tab.active > button')?.textContent?.replace(/\s+$/, '')).toBe('Customer report'));
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('SELECT 123;');
  fireEvent.keyDown(within(pane).getByRole('button', { name: 'Customer report' }), { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }));
  await waitFor(() => expect(within(pane).queryByText('Pinned')).toBeNull());
  fireEvent.contextMenu(within(pane).getByRole('button', { name: 'Customer report' }));
  invoke.mockClear();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  await screen.findByRole('heading', { name: 'No queries open' });
  const deletedId = invoke.mock.calls.find(call => call[0] === 'delete_library_query')![1].id;
  expect(within(pane).queryByRole('button', { name: 'Customer report' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create query' }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 456;' } });
  fireEvent.keyDown(screen.getByLabelText('SQL editor'), { key: 's', ctrlKey: true });
  await screen.findByText('All queries saved');
  expect(invoke.mock.calls.some(call => call[0] === 'save_library_query' && call[1].query.id === deletedId)).toBe(false);
});

it('leaves the query and tab intact if deletion fails', async () => {
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'delete_library_query') throw new Error('File is locked');
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 1;' } });
  fireEvent.keyDown(screen.getByLabelText('SQL editor'), { key: 's', ctrlKey: true });
  await screen.findByText('All queries saved');
  const pane = screen.getByRole('region', { name: 'Saved queries' });
  fireEvent.contextMenu(within(pane).getByRole('button', { name: 'Query1' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  await screen.findByText('Error: File is locked');
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('SELECT 1;');
  expect(within(pane).getByRole('button', { name: 'Query1' })).toBeTruthy();
});

it('keeps zero queries open after restart and only creates a tab on request', async () => {
  const first = render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(screen.getByRole('button', { name: 'Close query' }));
  await screen.findByRole('heading', { name: 'No queries open' });
  expect(screen.queryByLabelText('SQL editor')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Run all' })).toBeNull();
  await waitFor(() => expect(JSON.parse(localStorage.getItem('datagoblin.tabs')!)).toEqual([]));
  expect(invoke.mock.calls.some(call => call[0] === 'save_library_query')).toBe(false);
  first.unmount();
  render(<App/>);
  await screen.findByText('Autosave ready');
  expect(screen.getByRole('heading', { name: 'No queries open' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create query' }));
  expect(document.querySelector('.tab.active > button')?.textContent?.replace(/\s+$/, '')).toBe('Query1');
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('');
});

it('allows selecting a database without an open tab and uses it for the next query', async () => {
  localStorage.setItem('datagoblin.tabs', '[]');
  const original = invoke.getMockImplementation()!;
  const connection = { id: 'server', name: 'Local server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  invoke.mockImplementation(async (command, args) => command === 'load_connections' ? [connection] : original(command, args));
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(screen.getByRole('button', { name: /^Local server/ }));
  await screen.findByText('users');
  expect(screen.getByRole('heading', { name: 'No queries open' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create query' }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 1;' } });
  fireEvent.keyDown(screen.getByLabelText('SQL editor'), { key: 's', ctrlKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_library_query', { query: expect.objectContaining({ connectionId: 'server', database: 'postgres', sql: 'SELECT 1;' }) }));
});

it('does not save empty or whitespace-only queries on save or close', async () => {
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.keyDown(screen.getByLabelText('SQL editor'), { key: 's', ctrlKey: true });
  await screen.findByText('All queries saved');
  expect(invoke.mock.calls.some(call => call[0] === 'save_library_query')).toBe(false);
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: ' \n\t ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close query' }));
  await screen.findByRole('heading', { name: 'No queries open' });
  expect(invoke.mock.calls.some(call => call[0] === 'save_library_query')).toBe(false);
  expect(within(screen.getByRole('region', { name: 'Saved queries' })).queryByRole('button', { name: 'Query1' })).toBeNull();
});

it('does not overwrite previously saved content when an editor is cleared', async () => {
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 42;' } });
  fireEvent.keyDown(screen.getByLabelText('SQL editor'), { key: 's', ctrlKey: true });
  await screen.findByText('All queries saved');
  invoke.mockClear();
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close query' }));
  await screen.findByRole('heading', { name: 'No queries open' });
  expect(invoke.mock.calls.some(call => call[0] === 'save_library_query')).toBe(false);
  fireEvent.click(within(screen.getByRole('region', { name: 'Saved queries' })).getByRole('button', { name: 'Query1' }));
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('SELECT 42;');
});

it('does not reuse numbers belonging to open tabs or saved queries', async () => {
  render(<App/>);
  await screen.findByText('Autosave ready');
  expect(document.querySelector('.tab.active > button')?.textContent?.replace(/\s+$/, '')).toBe('Query1');
  fireEvent.click(screen.getByRole('button', { name: 'New query' }));
  expect(document.querySelector('.tab.active > button')?.textContent?.replace(/\s+$/, '')).toBe('Query2');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 2;' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Close query' })[1]);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Close query' })).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'New query' }));
  expect(document.querySelector('.tab.active > button')?.textContent?.replace(/\s+$/, '')).toBe('Query3');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 3;' } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_library_query', { query: expect.objectContaining({ name: 'Query3', draft: true }) }), { timeout: 2500 });
  const pane = screen.getByRole('region', { name: 'Saved queries' });
  expect(pane.closest('.query-pane')).toBeTruthy();
  expect(within(pane).getByText('Unsaved')).toBeTruthy();
  expect(within(pane).getByRole('button', { name: 'Query2' })).toBeTruthy();
});

it('uses the lowest available number after restart and reuses renamed query numbers', async () => {
  localStorage.setItem('datagoblin.querySequence', '999');
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => command === 'query_library'
    ? { folder: 'D:/SQL', defaultFolder: 'C:/AppData/DataGoblin/queries', queries: [{ id: 'stored', name: 'Query7', sql: 'SELECT 7', connectionId: '', serverName: 'Unassigned', database: '', draft: true }] }
    : original(command, args));
  render(<App/>);
  await screen.findByText('Autosave ready');
  expect(document.querySelector('.tab.active > button')?.textContent?.replace(/\s+$/, '')).toBe('Query1');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 8;' } });
  await renameActiveQuery('Revenue');
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_library_query', { query: expect.objectContaining({ name: 'Revenue', draft: false }) }), { timeout: 2500 });
  fireEvent.click(screen.getByRole('button', { name: 'New query' }));
  expect(document.querySelector('.tab.active > button')?.textContent?.replace(/\s+$/, '')).toBe('Query1');
});

it('autosaves query text and name without opening a save dialog', async () => {
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 123;' } });
  await renameActiveQuery('Monthly revenue');
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_library_query', { query: expect.objectContaining({ name: 'Monthly revenue', sql: 'SELECT 123;', serverName: 'Unassigned' }) }), { timeout: 2500 });
  expect(saveDialog).not.toHaveBeenCalled();
  expect(within(screen.getByRole('region', { name: 'Saved queries' })).getByRole('button', { name: 'Monthly revenue' })).toBeTruthy();
});

it('saves on close and reopens a query from the library', async () => {
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 456;' } });
  await renameActiveQuery('Saved report');
  fireEvent.click(screen.getByRole('button', { name: 'Close query' }));
  const library = screen.getByRole('region', { name: 'Saved queries' });
  const savedQuery = await within(library).findByRole('button', { name: 'Saved report' });
  await screen.findByRole('heading', { name: 'No queries open' });
  fireEvent.click(savedQuery);
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('SELECT 456;');
});

it('persists a folder selected in Settings after flushing open queries', async () => {
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => command === 'set_query_folder'
    ? { folder: args.folder, defaultFolder: 'C:/AppData/DataGoblin/queries', queries: [] }
    : original(command, args));
  openDialog.mockResolvedValue('D:/SQL');
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 1;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.queryByRole('button', { name: 'Choose folder' })).toBeNull();
  const appearance = screen.getByRole('tab', { name: 'Appearance' });
  appearance.focus(); fireEvent.keyDown(appearance, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Query storage' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_query_folder', { folder: 'D:/SQL' }));
  await waitFor(() => expect((screen.getByLabelText('Current query folder') as HTMLInputElement).value).toBe('D:/SQL'));
  expect(invoke.mock.calls.findIndex(call => call[0] === 'save_library_query')).toBeLessThan(invoke.mock.calls.findIndex(call => call[0] === 'set_query_folder'));
});

it('keeps a tab open and reports failed writes instead of claiming it was saved', async () => {
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'save_library_query') throw new Error('Disk full');
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT important_work;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close query' }));
  await screen.findByText('Autosave failed');
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('SELECT important_work;');
});

it('starts without fabricated connections or query results', async () => {
  render(<App/>);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('load_connections'));
  expect(screen.getByText('Your databases live here.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Run all' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Ready to run')).toBeTruthy();
});

it('stores the password separately from connection configuration', async () => {
  render(<App/>);
  fireEvent.click(screen.getByRole('button', { name: 'New connection' }));
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'My local database' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-secret' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add connection' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_password', expect.objectContaining({ password: 'test-secret' })));
  const saved = invoke.mock.calls.find(call => call[0] === 'save_connections');
  expect(saved).toBeTruthy();
  expect(JSON.stringify(saved![1])).not.toContain('test-secret');
  expect(saved![1].connections[0].name).toBe('My local database');
  fireEvent.click(await screen.findByRole('button', { name: 'My local database' }));
  await screen.findByText('users');
});

it('removes persisted credentials when session-only storage is selected', async () => {
  render(<App/>);
  fireEvent.click(screen.getByRole('button', { name: 'New connection' }));
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Temporary' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary-secret' } });
  fireEvent.click(screen.getByLabelText('Remember password in system credential store'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add connection' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('forget_password', expect.anything()));
  expect(invoke.mock.calls.some(call => call[0] === 'save_password')).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Temporary' }));
  await screen.findByText('users');
});

it('keeps the dialog open and shows an actionable error when the keychain fails', async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'load_connections') return [];
    if (command === 'save_password') throw new Error('Credential store is locked');
  });
  render(<App/>);
  fireEvent.click(screen.getByRole('button', { name: 'New connection' }));
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Local' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add connection' }));
  expect(await screen.findByText('Credential store is locked')).toBeTruthy();
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(invoke.mock.calls.some(call => call[0] === 'save_connections')).toBe(false);
});




it('restarts a table result for database sorting without changing editor SQL and preserves old rows on failure', async () => {
  const connection = { id: 'server', name: 'Local server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  const original = invoke.getMockImplementation()!;
  const browser = { table: '"jobs"', filters: [], sort: null, sql: 'SELECT * FROM jobs;', parameters: [] };
  const result = { browser, cacheId: 'table-original', complete: false, sets: [{ columns: ['id'], rows: [['original row']], totalRows: 501, hasMore: true, affected: null }], elapsedMs: 1, truncated: false };
  let fail = false;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'load_connections') return [connection];
    if (command === 'query' && args.sql === browser.sql) return result;
    if (command === 'browse_table') {
      if (fail) throw new Error('Database unavailable');
      expect(args).toMatchObject({ cacheId: 'table-original', filters: [], sort: { column: 'id', descending: false }, pageSize: 500 });
      return { ...result, cacheId: 'table-sorted', browser: { ...browser, sort: args.sort }, sets: [{ ...result.sets[0], rows: [['sorted row']] }] };
    }
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: /^Local server/ }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: browser.sql } });
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await screen.findByText('original row');
  fireEvent.click(screen.getByRole('button', { name: 'Sort id' }));
  await screen.findByText('sorted row');
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe(browser.sql);
  expect(screen.getByRole('columnheader', { name: /id/ }).getAttribute('aria-sort')).toBe('ascending');
  fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Sort id' }));
  await screen.findByText('Database unavailable');
  expect(screen.getByText('sorted row')).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: /id/ }).getAttribute('aria-sort')).toBe('ascending');
  expect((screen.getByTitle('Next page') as HTMLButtonElement).disabled).toBe(true);
});


it('records failed executions and recovers their SQL and database without executing again', async () => {
  const connection = { id: 'history-server', name: 'History server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'reporting', tls: false, trustCertificate: false };
  const original = invoke.getMockImplementation()!;
  const entries: unknown[] = [];
  let executions = 0;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'load_connections') return [connection];
    if (command === 'query' && args.sql === 'SELECT * FROM missing_table;') { executions++; throw new Error('Relation missing_table does not exist'); }
    if (command === 'record_query_history') { entries.unshift(args.entry); return; }
    if (command === 'query_history') return entries;
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: /^History server/ }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT * FROM missing_table;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await waitFor(() => expect(entries).toHaveLength(1));
  expect(entries[0]).toMatchObject({ sql: 'SELECT * FROM missing_table;', connectionId: 'history-server', database: 'reporting', status: 'error', error: 'Relation missing_table does not exist', durationMs: expect.any(Number) });
  fireEvent.click(screen.getByTitle('Query history'));
  const history = screen.getByRole('complementary', { name: 'Query history' });
  fireEvent.click(await within(history).findByRole('button', { name: /History server \/ reporting/ }));
  expect(within(history).getByText('Relation missing_table does not exist')).toBeTruthy();
  fireEvent.click(within(history).getByRole('button', { name: 'Open in new query' }));
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('SELECT * FROM missing_table;');
  expect((screen.getByLabelText('Query database') as HTMLSelectElement).value).toBe('reporting');
  expect(executions).toBe(1);
});


it('opens a foreign-key target in a new tab on the same database', async () => {
  const connection = { id: 'server', name: 'Local server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  const original = invoke.getMockImplementation()!;
  const reference = { id: 'fk1', name: 'FK_parent', schema: 'public', table: 'parent', columns: ['parent_id'], targetColumns: ['id'] };
  const sql = 'SELECT * FROM parent WHERE id = 42;';
  invoke.mockImplementation(async (command, args) => {
    if (command === 'load_connections') return [connection];
    if (command === 'query' && args.sql === 'SELECT * FROM child;') return { cacheId: 'child-result', complete: true, sets: [{ columns: ['parent_id'], rows: [['42']], affected: null }], elapsedMs: 1, truncated: false };
    if (command === 'result_column_keys') return [{ name: 'parent_id', primaryKey: false, foreignKey: true }];
    if (command === 'result_references') return [reference];
    if (command === 'open_reference') {
      expect(args).toMatchObject({ cacheId: 'child-result', column: 'parent_id', referenceId: 'fk1', rowIndex: 0 });
      return { sql, name: 'public.parent', result: { cacheId: 'parent-result', complete: true, sets: [{ columns: ['name'], rows: [['Parent record']], affected: null }], elapsedMs: 2, truncated: false } };
    }
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: /^Local server/ }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT * FROM child;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open related record for parent_id row 1' }));
  fireEvent.click(await screen.findByRole('button', { name: /public.parent/ }));
  await screen.findByText('Parent record');
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe(sql);
  expect((screen.getByLabelText('Query database') as HTMLSelectElement).value).toBe('postgres');
  expect(screen.getAllByTitle('Close query')).toHaveLength(2);
});


it('opens appearance settings from the keyboard and applies a theme without replacing query text', async () => {
  render(<App/>); await screen.findByText('Autosave ready');
  const editor = screen.getByLabelText('SQL editor'); fireEvent.change(editor, { target: { value: 'SELECT keep_me;' } }); editor.focus();
  fireEvent.keyDown(document, { key: ',', ctrlKey: true });
  const settings = screen.getByRole('dialog', { name: 'Settings' });
  fireEvent.click(within(settings).getByRole('button', { name: /Daylight/ }));
  expect(document.documentElement.dataset.theme).toBe('daylight');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(editor);
  expect((editor as HTMLTextAreaElement).value).toBe('SELECT keep_me;');
});

it('searches schemas and tables, restores folders, and opens a table without executing it', async () => {
  const connection = { id: 'server', name: 'Local server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => command === 'load_connections' ? [connection] : original(command, args));
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: /^Local server/ }));
  const schema = (await screen.findByText('public')).closest('details')!;
  expect(schema.open).toBe(false);
  const search = screen.getByLabelText('Filter tables');
  fireEvent.change(search, { target: { value: 'PUBLIC' } });
  expect(schema.open).toBe(true);
  expect(screen.getByText('users')).toBeTruthy();
  fireEvent.click(screen.getByTitle('Clear table search'));
  expect(schema.open).toBe(false);
  fireEvent.click(schema.querySelector('summary')!);
  expect(schema.open).toBe(true);
  fireEvent.change(search, { target: { value: 'user' } });
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(schema.open).toBe(true);
  fireEvent.doubleClick(screen.getByText('users'));
  await waitFor(() => expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('SELECT *\nFROM "public"."users";'));
  expect(invoke.mock.calls.some(([command, args]) => command === 'query' && args.sql === 'SELECT *\nFROM "public"."users";')).toBe(false);
  fireEvent.click(screen.getByTitle('Collapse all schemas'));
  expect(schema.open).toBe(false);
});


it('keeps query context and results when browsing other databases and servers', async () => {
  const first = { id: 'first', name: 'First server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  const second = { ...first, id: 'second', name: 'Second server' };
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'load_connections') return [first, second];
    if (args?.sql?.includes('pg_database')) return { sets: [{ columns: ['datname'], rows: [['postgres'], ['reporting']], affected: null }], elapsedMs: 1, truncated: false };
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: 'First server' }));
  await screen.findByRole('button', { name: 'Database reporting on First server' });
  expect(invoke.mock.calls.some(([command, args]) => command === 'query' && args.connection.database === 'reporting')).toBe(false);
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 42;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await screen.findByRole('columnheader', { name: /value/ });
  fireEvent.click(screen.getByRole('button', { name: 'Database reporting on First server' }));
  await waitFor(() => expect(invoke.mock.calls.some(([command, args]) => command === 'query' && args.connection.database === 'reporting')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Second server' }));
  expect((screen.getByLabelText('Query database') as HTMLButtonElement).value).toBe('postgres');
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('SELECT 42;');
  expect(screen.getByRole('columnheader', { name: /value/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await waitFor(() => expect(invoke.mock.calls.filter(([command, args]) => command === 'query' && args.sql === 'SELECT 42;')).toHaveLength(2));
  const executions = invoke.mock.calls.filter(([command, args]) => command === 'query' && args.sql === 'SELECT 42;');
  expect(executions.every(([, args]) => args.connection.id === 'first' && args.connection.database === 'postgres')).toBe(true);
  fireEvent.click(screen.getAllByTitle('New query in reporting')[0]);
  expect((screen.getByLabelText('Query database') as HTMLButtonElement).value).toBe('reporting');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 99;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('query', expect.objectContaining({ sql: 'SELECT 99;', connection: expect.objectContaining({ id: 'first', database: 'reporting' }) })));
});

it('renames and pins empty tabs, duplicates SQL, and preserves pinned tabs during bulk close', async () => {
  render(<App/>); await screen.findByText('Autosave ready');
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Query1' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  fireEvent.change(screen.getByLabelText('Query tab name'), { target: { value: 'Pinned work' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename' }));
  await screen.findByRole('button', { name: 'Pinned work' });
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Pinned work' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
  await screen.findByLabelText('Pinned query');
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 73;' } });
  fireEvent.contextMenu(screen.getByText('Pinned work'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
  expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe('SELECT 73;');
  const duplicate = document.querySelector('.tab.active > button')!;
  fireEvent.contextMenu(duplicate);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Close all unpinned tabs' }));
  await waitFor(() => expect(document.querySelectorAll('.tab')).toHaveLength(1));
  expect(document.querySelector('.tab')?.textContent).toContain('Pinned work');
});
it('retains pinned executions across reruns, shows output errors, and releases a closed pin', async () => {
  const connection = { id: 'server', name: 'Local server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  const original = invoke.getMockImplementation()!;
  let executions = 0;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'load_connections') return [connection];
    if (command === 'query' && args.sql === 'SELECT 42;') {
      executions++;
      if (executions === 3) throw new Error('Test SQL execution error');
      return { cacheId: 'pinned-cache-' + executions, complete: true, sets: [{ columns: ['value'], rows: [[executions === 1 ? 'first execution' : 'second execution']], affected: null }], elapsedMs: 8, truncated: false };
    }
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: /^Local server/ }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 42;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await screen.findByText('first execution');
  fireEvent.click(screen.getByRole('button', { name: 'Pin result' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await screen.findByText('second execution');
  expect(invoke).not.toHaveBeenCalledWith('release_results', { cacheId: 'pinned-cache-1' });
  const resultTabs = within(screen.getByRole('tablist', { name: 'Query results' }));
  fireEvent.click(resultTabs.getAllByRole('tab', { name: 'Query1' })[1]);
  await screen.findByText('first execution');
  fireEvent.click(screen.getByRole('button', { name: 'Close pinned result Query1' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('release_results', { cacheId: 'pinned-cache-1' }));
  await screen.findByText('second execution');
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await screen.findByRole('tabpanel', { name: 'Output' });
  expect(within(screen.getByRole('tabpanel', { name: 'Output' })).getByText('Test SQL execution error')).toBeTruthy();
  expect(screen.getAllByText('postgres> SELECT 42;')).toHaveLength(3);
  expect(screen.getAllByText('1 row retrieved starting from 1 in 8 ms')).toHaveLength(2);
});
it('uses keyboard-accessible named tabs for multiple result sets and a separate output view', async () => {
  const connection = { id: 'server', name: 'Local server', engine: 'postgres', host: 'localhost', port: 5432, username: 'postgres', database: 'postgres', tls: false, trustCertificate: false };
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === 'load_connections') return [connection];
    if (command === 'query' && args.sql === 'SELECT 1; SELECT 2;') return { complete: true, sets: [
      { columns: ['value'], rows: [['first set']], affected: null },
      { columns: ['value'], rows: [['second set']], affected: null }
    ], elapsedMs: 7, truncated: false };
    return original(command, args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button', { name: /^Local server/ }));
  fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 1; SELECT 2;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
  await screen.findByText('first set');
  const first = screen.getByRole('tab', { name: 'Query1 · 1' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  await screen.findByText('second set');
  expect(screen.getByRole('tab', { name: 'Query1 · 2' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(screen.getByRole('tabpanel', { name: 'Output' }).textContent).toContain('1 row retrieved starting from 1 · Result 2');
});
it.each(['close button', 'middle click'])('closes individual result tabs with %s, releases the last cache, and restores tabs on rerun', async method => {
  function closeResult(index: number) {
    if (method === 'close button') fireEvent.click(screen.getByRole('button',{name:'Close result '+index}));
    else {
      const tab = screen.getByRole('tab',{name:'Query1 · '+index});
      fireEvent.mouseDown(tab,{button:1});
      fireEvent(tab,new MouseEvent('auxclick',{bubbles:true,button:1}));
    }
  }
  const connection = { id:'server',name:'Local server',engine:'postgres',host:'localhost',port:5432,username:'postgres',database:'postgres',tls:false,trustCertificate:false };
  const original = invoke.getMockImplementation()!;
  let executions = 0;
  invoke.mockImplementation(async (command,args) => {
    if (command === 'load_connections') return [connection];
    if (command === 'query' && args.sql === 'SELECT 1; SELECT 2;') return {cacheId:'close-results-'+(++executions),complete:true,sets:[{columns:['value'],rows:[['first result']],affected:null},{columns:['value'],rows:[['second result']],affected:null}],elapsedMs:1,truncated:false};
    return original(command,args);
  });
  render(<App/>);
  await screen.findByText('Autosave ready');
  fireEvent.click(await screen.findByRole('button',{name:/^Local server/}));
  fireEvent.change(screen.getByLabelText('SQL editor'),{target:{value:'SELECT 1; SELECT 2;'}});
  fireEvent.click(screen.getByRole('button',{name:'Run all'})); await screen.findByText('first result');
  closeResult(1); await screen.findByText('second result');
  expect(screen.queryByRole('tab',{name:'Query1 · 1'})).toBeNull();
  expect(invoke).not.toHaveBeenCalledWith('release_results',{cacheId:'close-results-1'});
  closeResult(2);
  await screen.findByRole('tabpanel',{name:'Output'});
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('release_results',{cacheId:'close-results-1'}));
  expect(screen.getByLabelText('SQL editor')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Run all'}));
  await screen.findByText('first result');
  expect(screen.getByRole('button',{name:'Close result 1'})).toBeTruthy();
});
