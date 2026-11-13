// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResultsGrid } from './ResultsGrid';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
it('stages the original row index, previews before applying and refreshes once', async () => {
  const reload = vi.fn().mockResolvedValue(undefined);
  invoke.mockImplementation(async (command) => command === 'edit_capabilities' ? { columns: ['name'] } : [{ sql: 'UPDATE items SET name=$3 WHERE id=$1 AND name=$2', parameters: ['2','before','after'] }]);
  render(<ResultsGrid cacheId="edit-ui" data={{ columns: ['id','name'], rows: [['1','first'],['2','before']], affected: null }} rowOffset={500} browser={{ table:'items', filters:[], sort:null, sql:'SELECT * FROM items', parameters:[] }} engine="postgres" onExport={vi.fn()} onReload={reload}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.doubleClick(screen.getByText('before'));
  fireEvent.change(screen.getByLabelText('Cell value'), { target: { value: 'after' } });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(screen.getByLabelText('Cell value'), { key: 'Enter' });
  expect(screen.getByText('after').closest('td')?.className).toContain('edited-cell');
  expect(invoke).not.toHaveBeenCalledWith('edit_rows', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Preview pending changes' }));
  await screen.findByRole('dialog', { name: 'Review changes' });
  expect(invoke).toHaveBeenCalledWith('edit_rows', { cacheId:'edit-ui', changes:[{rowIndex:501,column:'name',value:'after'}], apply:false });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(invoke).toHaveBeenCalledWith('edit_rows', { cacheId:'edit-ui', changes:[{rowIndex:501,column:'name',value:'after'}], apply:true });
});
it('reverts SQL NULL without sending an update', async () => {
  invoke.mockResolvedValue({ columns: ['name'] });
  render(<ResultsGrid cacheId="edit-null" data={{columns:['name'],rows:[['value']],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.doubleClick(screen.getByText('value')); fireEvent.keyDown(screen.getByLabelText('Cell value'), { key:'Delete', ctrlKey:true });
  expect(screen.getByText('NULL')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Revert changes'})); expect(screen.getByText('value')).toBeTruthy();
  expect(invoke.mock.calls.every(([command]) => command !== 'edit_rows')).toBe(true);
});
it('preserves drafts when switching tabs and keeps failed submissions from being repeated', async () => {
  const props = { cacheId:'edit-draft', data:{columns:['id','name'],rows:[['1','original']],affected:null}, rowOffset:500, browser:{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}, onExport:vi.fn(), onReload:vi.fn() };
  invoke.mockImplementation(async (command, args) => {
    if (command === 'edit_capabilities') return { columns:['name'] };
    if (args.apply) throw new Error('Row changed');
    return [{sql:'UPDATE items SET name=$1',parameters:['staged']}];
  });
  const first = render(<ResultsGrid {...props}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.doubleClick(screen.getByText('original')); fireEvent.change(screen.getByLabelText('Cell value'), {target:{value:'staged'}});
  fireEvent.keyDown(screen.getByLabelText('Cell value'), {key:'Enter'}); first.unmount();
  render(<ResultsGrid {...props}/>); await screen.findByText('staged');
  fireEvent.click(screen.getByRole('button',{name:'Preview pending changes'})); await screen.findByRole('dialog',{name:'Review changes'});
  fireEvent.click(screen.getByRole('button',{name:'Apply changes'})); await screen.findByText(/Row changed.*Reload results/);
  expect((screen.getByRole('button',{name:'Preview pending changes'}) as HTMLButtonElement).disabled).toBe(true);
  expect(invoke.mock.calls.filter(([command,args]) => command === 'edit_rows' && args.apply)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Revert changes'}));
});
it('cancels inline edits with Escape and stages on blur', async () => {
  invoke.mockResolvedValue({columns:['name']});
  render(<ResultsGrid cacheId="inline-keys" data={{columns:['name'],rows:[['original']],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.doubleClick(screen.getByText('original'));
  fireEvent.change(screen.getByLabelText('Cell value'),{target:{value:'discard'}});
  fireEvent.keyDown(screen.getByLabelText('Cell value'),{key:'Escape'});
  expect(screen.getByText('original')).toBeTruthy(); expect(screen.queryByText('1 changed cells')).toBeNull();
  fireEvent.doubleClick(screen.getByText('original'));
  fireEvent.change(screen.getByLabelText('Cell value'),{target:{value:'kept'}});
  fireEvent.blur(screen.getByLabelText('Cell value'),{relatedTarget:document.body});
  expect(screen.getByText('kept')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Revert changes'}));
});
it('edits JSON in a dialog and validates without changing number precision', async () => {
  invoke.mockResolvedValue({columns:['payload'],jsonColumns:['payload']});
  const original = '{"id":9007199254740993}';
  render(<ResultsGrid cacheId="inline-json" data={{columns:['payload'],rows:[[original]],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.doubleClick(screen.getByText(original));
  expect(screen.getByRole('dialog',{name:'Edit JSON'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Format JSON'}));
  expect((screen.getByLabelText('Cell value') as HTMLTextAreaElement).value).toContain('9007199254740993');
  fireEvent.change(screen.getByLabelText('Cell value'),{target:{value:'{bad'}});
  fireEvent.click(screen.getByRole('button',{name:'Stage change'})); expect(screen.getByRole('alert').textContent).toContain('valid JSON');
  fireEvent.change(screen.getByLabelText('Cell value'),{target:{value:'{"ok":true}'}});
  fireEvent.click(screen.getByRole('button',{name:'Stage change'})); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Revert changes'}));
});
it('copies one cell and pastes into a Shift-click range without submitting', async () => {
  invoke.mockResolvedValue({columns:['name']});
  let clipboard = '';
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn(async text => {clipboard=text;}),readText:vi.fn(async()=>clipboard)}});
  render(<ResultsGrid cacheId="paste-range" data={{columns:['id','name'],rows:[['1','source'],['2','second'],['3','third'],['4','fourth']],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.click(screen.getByText('source')); fireEvent.keyDown(screen.getByText('source'),{key:'c',ctrlKey:true});
  await waitFor(()=>expect(clipboard).toBe('source'));
  fireEvent.click(screen.getByText('second')); fireEvent.click(screen.getByText('fourth'),{shiftKey:true});
  expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(3);
  fireEvent.paste(screen.getByText('fourth'),{clipboardData:{getData:()=>clipboard}});
  expect(screen.getAllByText('source')).toHaveLength(4);
  expect(document.querySelectorAll('td.edited-cell')).toHaveLength(3);
  expect(invoke.mock.calls.every(([command])=>command !== 'edit_rows')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Revert changes'}));
});
it('refuses an entire range containing a primary key and keeps native text paste in the editor', async () => {
  invoke.mockResolvedValue({columns:['name']});
  render(<ResultsGrid cacheId="paste-readonly" data={{columns:['id','name'],rows:[['1','one'],['2','two']],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.click(screen.getByTitle('1')); fireEvent.click(screen.getByText('two'),{shiftKey:true});
  fireEvent.paste(screen.getByText('two'),{clipboardData:{getData:()=> 'replacement'}});
  expect(screen.getByText(/selection contains read-only/)).toBeTruthy();
  expect(document.querySelectorAll('td.edited-cell')).toHaveLength(0);
  fireEvent.doubleClick(screen.getByText('one'));
  const input = screen.getByLabelText('Cell value');
  expect(fireEvent.paste(input,{clipboardData:{getData:()=> 'text'}})).toBe(true);
  fireEvent.keyDown(input,{key:'Escape'});
});
it.each([false,true])('submits directly with the current inline value using Ctrl/Cmd+Enter (Mac: %s)', async mac => {
  invoke.mockImplementation(async command => command === 'edit_capabilities' ? {columns:['name']} : [{sql:'UPDATE items SET name=$1',parameters:['new']}]);
  render(<ResultsGrid cacheId={'apply-shortcut-'+mac} data={{columns:['name'],rows:[['old']],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.doubleClick(screen.getByText('old'));
  fireEvent.change(screen.getByLabelText('Cell value'),{target:{value:'new'}});
  fireEvent.keyDown(screen.getByLabelText('Cell value'),{key:'Enter',ctrlKey:!mac,metaKey:mac});
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('edit_rows',{cacheId:'apply-shortcut-'+mac,changes:[{rowIndex:0,column:'name',value:'new'}],apply:true}));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(invoke.mock.calls.some(([command,args]) => command === 'edit_rows' && !args.apply)).toBe(false);
});

it('stages new rows at the end of a page, preserves defaults, deletes a selected range and submits together', async () => {
  const onLog=vi.fn();
  const reload = vi.fn().mockResolvedValue(undefined);
  invoke.mockImplementation(async command => command === 'edit_capabilities' ? { columns:['name'], insertColumns:[
    {name:'id',generated:true,nullable:false,editable:false},
    {name:'name',generated:false,nullable:true,defaultExpression:"'untitled'",editable:true},
  ] } : [{sql:'DELETE FROM items WHERE id=$1',parameters:['1']},{sql:'DELETE FROM items WHERE id=$1',parameters:['2']},{sql:'INSERT INTO items (name) VALUES ($1)',parameters:['inserted']}]);
  render(<ResultsGrid onLog={onLog} logDatabase="testdb" cacheId="row-operations" rowOffset={500} data={{columns:['id','name'],rows:[['1','first'],['2','second'],['3','third']],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={reload}/>);
  await waitFor(() => expect((screen.getByRole('button',{name:'Add row'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Add row'}));
  expect(screen.getByText('<generated>').closest('tr')?.className).toContain('inserted-row');
  expect(screen.getByText('<default>').closest('tr')).toBe(document.querySelector('tbody tr:last-child'));
  fireEvent.doubleClick(screen.getByText('<default>'));
  fireEvent.change(screen.getByLabelText('Cell value'),{target:{value:'inserted'}});
  fireEvent.keyDown(screen.getByLabelText('Cell value'),{key:'Enter'});
  fireEvent.click(screen.getByText('first')); fireEvent.click(screen.getByText('second'),{shiftKey:true});
  fireEvent.click(screen.getByRole('button',{name:'Delete selected rows'}));
  expect(document.querySelectorAll('tr.deleted-row')).toHaveLength(2);
  expect(invoke.mock.calls.some(([cmd]) => cmd === 'edit_rows')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Submit changes'}));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(invoke).toHaveBeenCalledWith('edit_rows',{cacheId:'row-operations',changes:[],inserts:[{values:{name:'inserted'}}],deletes:[500,501],apply:true});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onLog).toHaveBeenCalledWith(expect.objectContaining({kind:'sql',text:expect.stringContaining('testdb> INSERT INTO items')}));
  expect(onLog.mock.calls.filter(([e])=>e.kind==='sql')).toHaveLength(3);
  expect(onLog).toHaveBeenCalledWith(expect.objectContaining({kind:'success',text:expect.stringMatching(/3 rows affected in \d+ ms/)}));
});
it('reverts inserts and deletions and submits untouched defaults as omitted fields', async () => {
  invoke.mockImplementation(async cmd => cmd === 'edit_capabilities' ? {columns:['name'],insertColumns:[{name:'name',generated:false,nullable:true,defaultExpression:"'default'",editable:true}]} : []);
  render(<ResultsGrid cacheId="row-defaults" data={{columns:['name'],rows:[['original']],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await waitFor(() => expect((screen.getByRole('button',{name:'Add row'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Add row'}));
  fireEvent.click(screen.getByText('original')); fireEvent.click(screen.getByRole('button',{name:'Delete selected rows'}));
  fireEvent.click(screen.getByRole('button',{name:'Revert changes'}));
  expect(document.querySelectorAll('.inserted-row,.deleted-row')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Add row'}));
  fireEvent.doubleClick(screen.getByText('<default>')); fireEvent.keyDown(screen.getByLabelText('Cell value'),{key:'Enter'});
  fireEvent.click(screen.getByRole('button',{name:'Submit changes'}));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('edit_rows',{cacheId:'row-defaults',changes:[],inserts:[{values:{}}],apply:true}));
});
it('keeps required new fields editable after validation fails', async () => {
  invoke.mockImplementation(async cmd => cmd === 'edit_capabilities' ? {columns:[],insertColumns:[{name:'id',generated:false,nullable:false,editable:true}]} : []);
  render(<ResultsGrid cacheId="row-required" data={{columns:['id'],rows:[],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await waitFor(() => expect((screen.getByRole('button',{name:'Add row'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Add row'})); fireEvent.click(screen.getByRole('button',{name:'Submit changes'}));
  expect(screen.getByText(/id requires a value/)).toBeTruthy();
  expect(invoke.mock.calls.some(([cmd]) => cmd === 'edit_rows')).toBe(false);
  fireEvent.doubleClick(screen.getByText('<required>')); fireEvent.change(screen.getByLabelText('Cell value'),{target:{value:'42'}});
  fireEvent.keyDown(screen.getByLabelText('Cell value'),{key:'Enter',ctrlKey:true});
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('edit_rows',{cacheId:'row-required',changes:[],inserts:[{values:{id:'42'}}],apply:true}));
});

it('generates a UUID for a nullable GUID cell as a reversible pending edit', async () => {
  invoke.mockResolvedValue({columns:['guid','name'],uuidColumns:['id','guid']});
  render(<ResultsGrid cacheId="generate-uuid" data={{columns:['id','guid','name'],rows:[['1',null,'plain text']],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.contextMenu(screen.getByText('plain text'));
  expect(screen.queryByRole('menuitem',{name:'Generate UUID'})).toBeNull();
  fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'});
  fireEvent.contextMenu(screen.getByText('NULL'));
  fireEvent.click(screen.getByRole('menuitem',{name:'Generate UUID'}));
  const value=document.querySelector('td[data-column="1"]')!.textContent!;
  expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(document.querySelector('td[data-column="1"]')?.className).toContain('edited-cell');
  expect(invoke.mock.calls.some(([cmd])=>cmd==='edit_rows')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Revert changes'}));
  expect(screen.getByText('NULL')).toBeTruthy();
  fireEvent.contextMenu(document.querySelector('td[data-column="0"]')!);
  expect((screen.getByRole('menuitem',{name:'Generate UUID'}) as HTMLButtonElement).disabled).toBe(true);
});
it('generates UUID keys for new rows and includes them only on Submit', async () => {
  invoke.mockImplementation(async cmd=>cmd==='edit_capabilities' ? {columns:[],uuidColumns:['id'],insertColumns:[{name:'id',generated:false,nullable:false,editable:true}]} : []);
  render(<ResultsGrid cacheId="insert-uuid" data={{columns:['id'],rows:[],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Add row'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Add row'}));
  fireEvent.contextMenu(screen.getByText('<required>')); fireEvent.click(screen.getByRole('menuitem',{name:'Generate UUID'}));
  const value=document.querySelector('td[data-column="0"]')!.textContent;
  fireEvent.click(screen.getByRole('button',{name:'Submit changes'}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('edit_rows',{cacheId:'insert-uuid',changes:[],inserts:[{values:{id:value}}],apply:true}));
});

it('sets a nullable date to now as a pending change and respects read-only cells', async () => {
  invoke.mockResolvedValue({columns:['created','name'],dateColumns:{created:'date',id:'datetime2'}});
  render(<ResultsGrid cacheId="set-now" data={{columns:['id','created','name'],rows:[['1',null,'text']],affected:null}} browser={{table:'items',filters:[],sort:null,sql:'SELECT * FROM items',parameters:[]}} onExport={vi.fn()} onReload={vi.fn()}/>);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  fireEvent.contextMenu(screen.getByText('text'));
  expect(screen.queryByRole('menuitem',{name:'Set now'})).toBeNull();
  fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'});
  fireEvent.contextMenu(screen.getByText('NULL')); fireEvent.click(screen.getByRole('menuitem',{name:'Set now'}));
  expect(document.querySelector('td[data-column="1"]')!.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(document.querySelector('td[data-column="1"]')!.className).toContain('edited-cell');
  expect(invoke.mock.calls.some(([cmd])=>cmd==='edit_rows')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Revert changes'})); expect(screen.getByText('NULL')).toBeTruthy();
  fireEvent.contextMenu(document.querySelector('td[data-column="0"]')!);
  expect((screen.getByRole('menuitem',{name:'Set now'}) as HTMLButtonElement).disabled).toBe(true);
});
