// @vitest-environment jsdom
import { defineComponent, shallowRef } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from './testUtils';
import ResultsGrid from './ResultsGrid.vue';
const {
  referenceInvoke
} = vi.hoisted(() => ({
  referenceInvoke: vi.fn()
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: referenceInvoke
}));
afterEach(cleanup);
const data = {
  columns: ['ID', 'Name'],
  rows: [['10', 'ten'], [null, 'missing'], ['2', ''], ['1', 'one']],
  affected: null
};
const displayedIds = () => screen.getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[1].textContent);
it.each(['Control','Meta'])('%s+A selects loaded grid cells and prevents whole-page selection',async modifier=>{
  const {container}=await render(<ResultsGrid data={data} onExport={vi.fn()} />);
  const cell=screen.getByText('ten').closest('td')!;
  cell.focus();
  const event=new KeyboardEvent('keydown',{key:'a',code:'KeyA',ctrlKey:modifier==='Control',metaKey:modifier==='Meta',bubbles:true,cancelable:true});
  await fireEvent(cell,event);
  expect(event.defaultPrevented).toBe(true);
  expect(container.querySelectorAll('td[aria-selected="true"]')).toHaveLength(8);
});
it('shows distinct value counts and applies checkbox filters immediately without closing', async () => {
  await render(<ResultsGrid data={{
    columns: ['ID', 'Name'],
    rows: [['1', 'Alice'], ['2', 'Alice'], ['3', 'Bob']],
    affected: null
  }} onExport={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter Name'
  }));
  const dialog = screen.getByRole('dialog', {
    name: 'Filter Name'
  });
  const alice = within(dialog).getByRole('checkbox', {
    name: 'Select value Alice'
  });
  expect(alice.closest('label')?.textContent).toBe('Alice2');
  expect(within(dialog).getAllByRole('checkbox')).toHaveLength(3);
  await fireEvent.click(alice);
  expect(displayedIds()).toEqual(['1', '2']);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(within(dialog).getByRole('checkbox', {
    name: 'Select all matching values'
  }).getAttribute('type')).toBe('checkbox');
  expect((within(dialog).getByRole('checkbox', {
    name: 'Select all matching values'
  }) as HTMLInputElement).indeterminate).toBe(true);
  await fireEvent.click(within(dialog).getByRole('checkbox', {
    name: 'Select value Bob'
  }));
  expect(displayedIds()).toEqual(['1', '2', '3']);
  await fireEvent.click(within(dialog).getByRole('button', {
    name: 'Clear selected values'
  }));
  expect(displayedIds()).toEqual(['1', '2', '3']);
  expect(screen.getByRole('button', {
    name: 'Filter Name'
  }).getAttribute('aria-pressed')).toBe('false');
});
it('searches values without filtering rows and selects only matching values', async () => {
  await render(<ResultsGrid data={{
    columns: ['ID', 'Name'],
    rows: [['1', 'Alice'], ['2', 'Alina'], ['3', 'Bob']],
    affected: null
  }} onExport={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter Name'
  }));
  await fireEvent.change(screen.getByLabelText('Search filter values'), {
    target: {
      value: 'ALI'
    }
  });
  expect(screen.queryByRole('checkbox', {
    name: 'Select value Bob'
  })).toBeNull();
  expect(displayedIds()).toEqual(['1', '2', '3']);
  await fireEvent.keyDown(screen.getByLabelText('Search filter values'), {
    key: 'Enter'
  });
  expect(screen.getByRole('dialog')).toBeTruthy();
  await fireEvent.click(screen.getByRole('checkbox', {
    name: 'Select all matching values'
  }));
  expect(displayedIds()).toEqual(['1', '2']);
  await fireEvent.keyDown(document, {
    key: 'Escape'
  });
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter Name'
  }));
  expect((screen.getByRole('checkbox', {
    name: 'Select value Alice'
  }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', {
    name: 'Select value Bob'
  }) as HTMLInputElement).checked).toBe(false);
});
it('keeps NULL, empty strings, and the text NULL as separate checkbox values', async () => {
  await render(<ResultsGrid data={{
    columns: ['ID', 'Name'],
    rows: [['1', null], ['2', ''], ['3', 'NULL']],
    affected: null
  }} onExport={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter Name'
  }));
  await fireEvent.click(screen.getByRole('checkbox', {
    name: 'Select NULL (no value)'
  }));
  expect(displayedIds()).toEqual(['1']);
  await fireEvent.click(screen.getByRole('checkbox', {
    name: 'Select empty string'
  }));
  expect(displayedIds()).toEqual(['1', '2']);
  await fireEvent.click(screen.getByRole('checkbox', {
    name: 'Select value NULL'
  }));
  expect(displayedIds()).toEqual(['1', '2', '3']);
});
it('counts candidates after other column filters and keeps large value lists bounded', async () => {
  const many = Array.from({
    length: 2000
  }, (_, i) => [String(i), i % 2 ? 'odd' : 'even']);
  await render(<ResultsGrid data={{
    columns: ['ID', 'Kind'],
    rows: many,
    affected: null
  }} onExport={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter Kind'
  }));
  await fireEvent.click(screen.getByRole('checkbox', {
    name: 'Select value even'
  }));
  await fireEvent.keyDown(document, {
    key: 'Escape'
  });
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter ID'
  }));
  expect(screen.queryByRole('checkbox', {
    name: 'Select value 1'
  })).toBeNull();
  expect(screen.getAllByRole('checkbox').length).toBeLessThan(30);
  await fireEvent.change(screen.getByLabelText('Search filter values'), {
    target: {
      value: '1998'
    }
  });
  expect(screen.getByRole('checkbox', {
    name: 'Select value 1998'
  })).toBeTruthy();
});
async function filterColumn(name: string, operator: string, value = '') {
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter ' + name
  }));
  await fireEvent.click(screen.getByText('Advanced condition'));
  await fireEvent.click(screen.getByLabelText('Filter condition'));
  const labels: Record<string, string> = {
    contains: 'Contains',
    equals: 'Equals',
    notEquals: 'Does not equal',
    startsWith: 'Starts with',
    endsWith: 'Ends with',
    greater: 'Greater than',
    less: 'Less than',
    isNull: 'Is NULL',
    notNull: 'Is not NULL',
    isEmpty: 'Is empty string'
  };
  await fireEvent.click(screen.getByRole('option', {
    name: labels[operator]
  }));
  const input = screen.queryByLabelText('Filter value');
  if (input) await fireEvent.change(input, {
    target: {
      value
    }
  });
  await fireEvent.click(screen.getByRole('button', {
    name: 'Apply'
  }));
}
it('combines column filters, exports matching rows, and clears filters', async () => {
  const onExport = vi.fn();
  await render(<ResultsGrid data={{
    columns: ['ID', 'Name'],
    rows: [['1', 'Alice'], ['2', 'ALISON'], ['3', 'Bob'], [null, 'Alina']],
    affected: null
  }} onExport={onExport} />);
  await filterColumn('Name', 'contains', 'ali');
  expect(displayedIds()).toEqual(['1', '2', 'NULL']);
  await filterColumn('ID', 'greater', '1');
  expect(displayedIds()).toEqual(['2']);
  expect(screen.getByText('1 of 4 loaded rows match · 2 column filters')).toBeTruthy();
  await fireEvent.click(screen.getByRole('button', {
    name: /Export CSV/
  }));
  expect(onExport).toHaveBeenCalledWith([['2', 'ALISON']]);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Clear filters'
  }));
  expect(displayedIds()).toEqual(['1', '2', '3', 'NULL']);
});
it('distinguishes NULL and empty strings and keeps filters across page changes', async () => {
  const view = await render(<ResultsGrid data={data} onExport={vi.fn()} />);
  await filterColumn('ID', 'isNull');
  expect(displayedIds()).toEqual(['NULL']);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Clear filters'
  }));
  await filterColumn('Name', 'isEmpty');
  expect(displayedIds()).toEqual(['2']);
  await view.rerender(<ResultsGrid data={{
    ...data,
    rows: [['4', 'other']]
  }} onExport={vi.fn()} />);
  expect(screen.getByText('No rows match the filters on this page.')).toBeTruthy();
  expect(screen.getByRole('button', {
    name: 'Filter Name'
  }).getAttribute('aria-pressed')).toBe('true');
});
it('shows metadata-backed key markers and a sort control even when unsorted', async () => {
  await render(<ResultsGrid data={{
    ...data,
    columnKeys: [{
      name: 'ID',
      primaryKey: true,
      foreignKey: true
    }, {
      name: 'Name',
      primaryKey: false,
      foreignKey: false
    }]
  }} onExport={vi.fn()} />);
  expect(screen.getByRole('img', {
    name: 'Primary key'
  })).toBeTruthy();
  expect(screen.getByRole('img', {
    name: 'Foreign key'
  })).toBeTruthy();
  const sort = screen.getByRole('button', {
    name: 'Sort ID'
  });
  expect(sort.querySelector('svg')).toBeTruthy();
  expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('none');
  await fireEvent.click(sort);
  expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  await fireEvent.click(sort);
  await fireEvent.click(sort);
  expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('none');
  expect(sort.querySelector('svg')).toBeTruthy();
});
it('does not infer key markers from names and dismisses filter dialogs', async () => {
  await render(<ResultsGrid data={data} onExport={vi.fn()} />);
  expect(screen.queryByRole('img', {
    name: 'Primary key'
  })).toBeNull();
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter ID'
  }));
  await fireEvent.keyDown(document, {
    key: 'Escape'
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', {
    name: 'Filter ID'
  }));
});
it('sorts numerically in both directions, keeps NULL last and restores original order', async () => {
  await render(<ResultsGrid data={data} onExport={vi.fn()} />);
  const sort = screen.getByRole('button', {
    name: 'ID'
  });
  await fireEvent.click(sort);
  expect(displayedIds()).toEqual(['1', '2', '10', 'NULL']);
  await fireEvent.click(sort);
  expect(displayedIds()).toEqual(['10', '2', '1', 'NULL']);
  await fireEvent.click(sort);
  expect(displayedIds()).toEqual(['10', 'NULL', '2', '1']);
  expect(data.rows[0][0]).toBe('10');
  expect(screen.getByLabelText('Empty string')).toBeTruthy();
});
it('exports loaded rows in the visible sort order', async () => {
  const onExport = vi.fn();
  await render(<ResultsGrid data={data} onExport={onExport} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'ID'
  }));
  await fireEvent.click(screen.getByRole('button', {
    name: /Export CSV/
  }));
  expect(onExport).toHaveBeenCalledWith([data.rows[3], data.rows[2], data.rows[0], data.rows[1]]);
});
it('copies cells, NULL and full rows using the selected underlying row after sorting', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText
    }
  });
  await render(<ResultsGrid data={data} onExport={vi.fn()} />);
  await fireEvent.focus(screen.getByRole('cell', {
    name: 'ten'
  }));
  await fireEvent.keyDown(screen.getByRole('cell', {
    name: 'ten'
  }), {
    key: 'c',
    ctrlKey: true
  });
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('ten'));
  await fireEvent.click(screen.getByRole('button', {
    name: 'ID'
  }));
  await fireEvent.contextMenu(screen.getByRole('cell', {
    name: 'ten'
  }));
  await fireEvent.click(screen.getByRole('menuitem', {
    name: 'Copy row'
  }));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('10\tten'));
  await fireEvent.focus(screen.getByRole('cell', {
    name: 'NULL'
  }));
  await fireEvent.keyDown(screen.getByRole('cell', {
    name: 'NULL'
  }), {
    key: 'c',
    ctrlKey: true
  });
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('NULL'));
  await fireEvent.click(screen.getByRole('button', {
    name: 'Select row 1'
  }));
  await fireEvent.keyDown(document.querySelector('.grid-scroll')!, {
    key: 'c',
    ctrlKey: true
  });
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('1\tone'));
});
it('reports clipboard failures and allows keyboard column resizing within bounds', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn().mockRejectedValue(new Error('Denied'))
    }
  });
  await render(<ResultsGrid data={data} onExport={vi.fn()} />);
  await fireEvent.focus(screen.getByRole('cell', {
    name: 'ten'
  }));
  await fireEvent.keyDown(screen.getByRole('cell', {
    name: 'ten'
  }), {
    key: 'c',
    ctrlKey: true
  });
  await screen.findByText(/Could not access the clipboard/);
  const resize = screen.getByRole('separator', {
    name: 'Resize ID'
  });
  const initialWidth = Number(resize.getAttribute('aria-valuenow'));
  await fireEvent.keyDown(resize, {
    key: 'ArrowRight'
  });
  expect(Number(resize.getAttribute('aria-valuenow'))).toBe(initialWidth + 20);
  for (let i = 0; i < 10; i++) await fireEvent.keyDown(resize, {
    key: 'ArrowLeft'
  });
  expect(resize.getAttribute('aria-valuenow')).toBe('80');
});
it('preserves precision for large integer sorting and escapes multiline row copying', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText
    }
  });
  await render(<ResultsGrid data={{
    columns: ['ID', 'Name'],
    rows: [['9007199254740993', 'a\tb"c\nd'], ['9007199254740992', 'other']],
    affected: null
  }} onExport={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'ID'
  }));
  expect(displayedIds()).toEqual(['9007199254740992', '9007199254740993']);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Select row 2'
  }));
  await fireEvent.keyDown(document.querySelector('.grid-scroll')!, {
    key: 'c',
    ctrlKey: true
  });
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('9007199254740993\t"a\tb""c\nd"'));
});
it('delegates database sorting and preserves returned order instead of sorting the page', async () => {
  const onBrowse = vi.fn();
  await render(<ResultsGrid data={data} onExport={vi.fn()} browser={{
    table: '[jobs]',
    filters: [],
    sort: {
      column: 'ID',
      descending: false
    },
    sql: 'SELECT * FROM [jobs]',
    parameters: []
  }} onBrowse={onBrowse} />);
  expect(displayedIds()).toEqual(['10', 'NULL', '2', '1']);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Sort ID'
  }));
  expect(onBrowse).toHaveBeenCalledWith([], {
    column: 'ID',
    descending: true
  });
  expect(displayedIds()).toEqual(['10', 'NULL', '2', '1']);
  expect(screen.queryByRole('button', {
    name: 'View SQL'
  })).toBeNull();
});
it('loads database-wide values and applies multiple choices together', async () => {
  const onBrowse = vi.fn();
  const loadValues = vi.fn().mockResolvedValue({
    values: [{
      value: 'Elsewhere',
      count: 10000
    }, {
      value: 'Another',
      count: 5
    }],
    hasMore: true
  });
  await render(<ResultsGrid data={data} onExport={vi.fn()} browser={{
    table: '[jobs]',
    filters: [],
    sort: null,
    sql: '',
    parameters: []
  }} onBrowse={onBrowse} loadValues={loadValues} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter Name'
  }));
  expect(loadValues).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', {
    name: 'Database'
  }));
  await fireEvent.click(await screen.findByRole('checkbox', {
    name: 'Select value Elsewhere'
  }));
  await fireEvent.click(screen.getByRole('checkbox', {
    name: 'Select value Another'
  }));
  expect(onBrowse).not.toHaveBeenCalled();
  expect(loadValues).toHaveBeenCalledWith('Name', '');
  expect(displayedIds()).toEqual(['10', 'NULL', '2', '1']);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Apply selection'
  }));
  expect(onBrowse).toHaveBeenCalledWith([{
    column: 'Name',
    operator: 'in',
    value: '',
    values: ['Elsewhere', 'Another']
  }], null);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('defaults table filters to local and keeps them separate when switching scope', async () => {
  const onBrowse = vi.fn();
  const loadValues = vi.fn().mockResolvedValue({
    values: [{
      value: 'remote',
      count: 42
    }],
    hasMore: false
  });
  await render(<ResultsGrid data={data} onExport={vi.fn()} browser={{
    table: 'jobs',
    filters: [{
      column: 'Name',
      operator: 'notNull',
      value: ''
    }],
    sort: null,
    sql: '',
    parameters: []
  }} onBrowse={onBrowse} loadValues={loadValues} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Filter Name'
  }));
  expect(screen.getByRole('button', {
    name: 'Local'
  }).getAttribute('aria-pressed')).toBe('true');
  await fireEvent.click(screen.getByRole('checkbox', {
    name: 'Select value ten'
  }));
  expect(displayedIds()).toEqual(['10']);
  expect(onBrowse).not.toHaveBeenCalled();
  expect(loadValues).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', {
    name: 'Database'
  }));
  await screen.findByRole('checkbox', {
    name: 'Select value remote'
  });
  expect((screen.getByLabelText('Filter condition') as HTMLSelectElement).value).toBe('notNull');
  expect(displayedIds()).toEqual(['10']);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Local'
  }));
  expect((screen.getByRole('checkbox', {
    name: 'Select value ten'
  }) as HTMLInputElement).checked).toBe(true);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Clear selected values'
  }));
  expect(displayedIds()).toEqual(['10', 'NULL', '2', '1']);
  expect(onBrowse).not.toHaveBeenCalled();
  expect(screen.getByText('1 database filter active')).toBeTruthy();
  await fireEvent.click(screen.getByRole('button', {
    name: 'Database'
  }));
  await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {
    name: 'View SQL'
  }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', {
    name: 'Close SQL'
  })).toBeTruthy();
});
it('opens the full value on double click, copies original JSON, and restores focus on close', async () => {
  const value = '{"id":9007199254740993,"items":[1,2]}';
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText
    }
  });
  await render(<ResultsGrid data={{
    columns: ['Payload'],
    rows: [[value]],
    affected: null
  }} onExport={vi.fn()} />);
  const cell = screen.getByRole('cell', {
    name: value
  });
  await fireEvent.doubleClick(cell);
  const viewer = screen.getByRole('dialog', {
    name: 'Cell value viewer'
  });
  expect(within(viewer).getByText('Payload')).toBeTruthy();
  expect(within(viewer).getByRole('button', {
    name: 'Collapse all'
  })).toBeTruthy();
  await fireEvent.click(within(viewer).getByRole('button', {
    name: 'Copy value'
  }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(value));
  await fireEvent.click(within(viewer).getByRole('button', {
    name: 'Search'
  }));
  expect(within(viewer).getByPlaceholderText('Find')).toBeTruthy();
  await fireEvent.click(within(viewer).getByRole('button', {
    name: 'Close value viewer'
  }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(cell);
});
it('distinguishes SQL NULL and empty text and supports Enter and Escape', async () => {
  await render(<ResultsGrid data={data} onExport={vi.fn()} />);
  await fireEvent.keyDown(screen.getByRole('cell', {
    name: 'NULL'
  }), {
    key: 'Enter'
  });
  expect(screen.getByText('NULL — no value')).toBeTruthy();
  await fireEvent.keyDown(screen.getByRole('dialog'), {
    key: 'Escape'
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  await fireEvent.doubleClick(screen.getByRole('cell', {
    name: 'Empty string'
  }));
  expect(screen.getByText('Empty string — 0 characters')).toBeTruthy();
});
it('navigates using the cached row index after local sorting, and hides links for NULL', async () => {
  const reference = {
    id: 'fk1',
    name: 'FK_parent',
    schema: 'dbo',
    table: 'Parent',
    columns: ['ParentId'],
    targetColumns: ['Id']
  };
  referenceInvoke.mockResolvedValue([reference]);
  const onReference = vi.fn();
  await render(<ResultsGrid data={{
    columns: ['ID', 'ParentId'],
    columnKeys: [{
      name: 'ParentId',
      primaryKey: false,
      foreignKey: true
    }],
    rows: [['20', '10'], ['2', '11'], ['30', null]],
    affected: null
  }} cacheId='source' rowOffset={500} onReference={onReference} onExport={vi.fn()} />);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Sort ID'
  }));
  expect(screen.queryByRole('button', {
    name: 'Open related record for ParentId row 503'
  })).toBeNull();
  await fireEvent.click(screen.getByRole('button', {
    name: 'Open related record for ParentId row 501'
  }));
  await fireEvent.click(await screen.findByRole('button', {
    name: /dbo.Parent/
  }));
  expect(referenceInvoke).toHaveBeenCalledWith('result_references', {
    cacheId: 'source',
    column: 'ParentId'
  });
  expect(onReference).toHaveBeenCalledWith(reference, 'ParentId', 501);
});
it('copies and filters the right-clicked cell rather than an earlier selection', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText
    }
  });
  await render(<ResultsGrid data={data} onExport={vi.fn()} />);
  await fireEvent.click(screen.getByRole('cell', {
    name: 'ten'
  }));
  await fireEvent.contextMenu(screen.getByRole('cell', {
    name: 'one'
  }), {
    clientX: 100,
    clientY: 100
  });
  await fireEvent.click(screen.getByRole('menuitem', {
    name: 'Copy row'
  }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('1\tone'));
  await fireEvent.contextMenu(screen.getByRole('cell', {
    name: 'missing'
  }));
  await fireEvent.click(screen.getByRole('menuitem', {
    name: 'Filter locally by this value'
  }));
  expect(displayedIds()).toEqual(['NULL']);
});
it('virtualizes a default page while preserving keyboard navigation and full export', async () => {
  const onExport = vi.fn();
  const rows = Array.from({
    length: 500
  }, (_, i) => [String(i), `row ${i}`]);
  const {
    container
  } = await render(<ResultsGrid data={{
    columns: ['ID', 'Name'],
    rows,
    affected: null
  }} onExport={onExport} />);
  const mountedRows = () => container.querySelectorAll('tbody tr:not([aria-hidden])');
  expect(mountedRows().length).toBeLessThan(100);
  const viewport = container.querySelector('.grid-scroll')!;
  await fireEvent.scroll(viewport, {
    target: {
      scrollTop: 499 * 27
    }
  });
  const last = container.querySelector<HTMLElement>('td[data-row="499"][data-column="0"]')!;
  expect(last.textContent).toBe('499');
  await fireEvent.keyDown(last, {
    key: 'ArrowUp'
  });
  expect(document.activeElement?.getAttribute('data-row')).toBe('498');
  await fireEvent.scroll(viewport, {
    target: {
      scrollTop: 0
    }
  });
  const first = container.querySelector<HTMLElement>('td[data-row="0"][data-column="0"]')!;
  // Move beyond the initially mounted window without a mouse scroll.
  await fireEvent.focus(first);
  for (let i = 0; i < 60; i++) {
    const cell = container.querySelector<HTMLElement>(`td[data-row="${i}"][data-column="0"]`)!;
    expect(cell).toBeTruthy();
    await fireEvent.keyDown(cell, {
      key: 'ArrowDown'
    });
  }
  expect(document.activeElement?.getAttribute('data-row')).toBe('60');
  expect(mountedRows().length).toBeLessThan(100);
  await fireEvent.click(screen.getByRole('button', {
    name: /Export/i
  }));
  expect(onExport).toHaveBeenCalledWith(rows);
});
