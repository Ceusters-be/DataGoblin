// @vitest-environment jsdom
import { defineComponent, shallowRef } from 'vue';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from './testUtils';
import PagedResults from './PagedResults.vue';
const {
  invoke
} = vi.hoisted(() => ({
  invoke: vi.fn()
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke
}));
const allRows = Array.from({
  length: 1251
}, (_, index) => [String(index + 1)]);
const data = {
  columns: ['ID'],
  rows: allRows.slice(0, 500),
  totalRows: 1251,
  affected: null
};
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (_, {
    offset,
    pageSize
  }) => ({
    rows: allRows.slice(offset, pageSize === 0 ? undefined : offset + pageSize),
    totalRows: allRows.length
  }));
});
afterEach(cleanup);
async function chooseSize(value: string) {
  await fireEvent.click(screen.getByLabelText('Page size'));
  if (value === 'custom') {
    await fireEvent.click(screen.getByRole('menuitem', {
      name: 'Custom…'
    }));
    return;
  }
  const label = value === '0' ? 'All' : Number(value).toLocaleString();
  const option = screen.getAllByRole('menuitemradio').find(option => option.textContent?.replace('Default', '').trim() === label)!;
  await fireEvent.click(option);
}
it('requests only a scalar count, keeps the current page, and fetches rows only on Next', async () => {
  const progress = vi.fn();
  await render(<PagedResults data={{
    ...data,
    totalRows: 501,
    hasMore: true
  }} cacheId='cache' setIndex={0} truncated={false} onUpdate={progress} onExport={vi.fn()} />);
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockResolvedValueOnce(16954);
  await fireEvent.click(screen.getByRole('button', {
    name: 'Count all rows'
  }));
  await screen.findByLabelText('1–500 of ' + 16954 .toLocaleString());
  expect(invoke).toHaveBeenCalledWith('result_count', {
    cacheId: 'cache',
    setIndex: 0
  });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(progress).not.toHaveBeenCalled();
  await fireEvent.scroll(document.querySelector('.grid-scroll')!, {
    target: {
      scrollTop: 499 * 27
    }
  });
  expect(screen.getByRole('button', {
    name: 'Select row 500'
  })).toBeTruthy();
  expect((screen.getByRole('button', {
    name: 'Count all rows'
  }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTitle('Last page') as HTMLButtonElement).disabled).toBe(false);
  invoke.mockResolvedValueOnce({
    rows: allRows.slice(500, 1000),
    totalRows: 1001,
    hasMore: true
  });
  await fireEvent.click(screen.getByTitle('Next page'));
  await screen.findByLabelText('501–1000 of ' + 16954 .toLocaleString());
  expect(invoke).toHaveBeenLastCalledWith('result_page', {
    cacheId: 'cache',
    setIndex: 0,
    offset: 500,
    pageSize: 500
  });
});
it('loads All beyond 10,000 rows through the range menu', async () => {
  const full = Array.from({
    length: 16954
  }, (_, index) => [String(index)]);
  invoke.mockImplementation(async (_, {offset,pageSize}) => ({
    rows: full.slice(offset,offset+pageSize), totalRows:full.length, hasMore:false,
  }));
  const exportRows = vi.fn();
  await render(<PagedResults data={{
    ...data,
    totalRows: 501,
    hasMore: true
  }} cacheId='cache' setIndex={0} truncated={false} onExport={exportRows} />);
  await chooseSize('0');
  await screen.findByLabelText('1–16954 of ' + 16954 .toLocaleString());
  expect(invoke).toHaveBeenCalledWith('result_page', {
    cacheId: 'cache',
    setIndex: 0,
    offset: 0,
    pageSize: 500
  });
  expect(invoke.mock.calls.filter(([name])=>name==='result_page').map(([,args])=>args.offset)).toEqual(Array.from({length:Math.ceil(full.length/500)},(_,i)=>i*500));
  expect(screen.getAllByRole('row').length).toBeLessThan(100);
  await fireEvent.scroll(screen.getByRole('table').parentElement!, {
    target: {
      scrollTop: (16954 - 15) * 36
    }
  });
  expect(screen.getByRole('button', {
    name: 'Select row 16954'
  })).toBeTruthy();
  expect(screen.getAllByRole('row').length).toBeLessThan(100);
  await fireEvent.click(screen.getByRole('button', {
    name: /Export CSV/
  }));
  expect(exportRows).toHaveBeenCalledWith(full);
});
it('shows loaded-row progress between batches and retains rows if the next batch fails',async()=>{
  const log=vi.fn();
  const first=Array.from({length:500},(_,i)=>[String(i)]);
  let finishSecond!: (value: unknown) => void;
  invoke.mockImplementationOnce(async()=>({rows:first,totalRows:501,hasMore:true}));
  invoke.mockImplementationOnce(()=>new Promise(resolve=>{finishSecond=resolve;}));
  invoke.mockRejectedValueOnce(new Error('Connection lost'));
  const {container}=await render(<PagedResults data={{...data,totalRows:501,hasMore:true}} cacheId='progress-cache' setIndex={0} truncated={false} onExport={vi.fn()} onLog={log} />);
  await chooseSize('0');
  await screen.findByText('Loading all data… 500 rows loaded · 500 per batch');
  expect(invoke).toHaveBeenLastCalledWith('result_page',{cacheId:'progress-cache',setIndex:0,offset:500,pageSize:500});
  finishSecond({rows:first.map((_,i)=>[String(i+500)]),totalRows:1001,hasMore:true});
  await waitFor(()=>expect(log).toHaveBeenCalledWith(expect.objectContaining({kind:'error',text:'Connection lost'})));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('1–1000 of '+(1001).toLocaleString()+'+')).toBeTruthy();
  expect(container.textContent).not.toContain('Loading all data…');
});
it('dismisses the upward page-size menu with Escape or an outside click', async () => {
  await render(<PagedResults data={data} setIndex={0} truncated={false} onExport={vi.fn()} />);
  await fireEvent.click(screen.getByLabelText('Page size'));
  expect(screen.getByRole('menu', {
    name: 'Page size options'
  })).toBeTruthy();
  await fireEvent.keyDown(document, {
    key: 'Escape'
  });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByLabelText('Page size'));
  await fireEvent.click(screen.getByLabelText('Page size'));
  await fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});
it('retains the unknown count and current rows when counting fails', async () => {
  const log=vi.fn();
  await render(<PagedResults data={{
    ...data,
    totalRows: 501,
    hasMore: true
  }} cacheId='cache' setIndex={0} truncated={false} onExport={vi.fn()} onLog={log} />);
  invoke.mockRejectedValueOnce('Fetching timed out.');
  await fireEvent.click(screen.getByRole('button', {
    name: 'Count all rows'
  }));
  await waitFor(()=>expect(log).toHaveBeenCalledWith(expect.objectContaining({kind:'error',text:'Fetching timed out.'})));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('1–500 of 501+')).toBeTruthy();
  await fireEvent.scroll(document.querySelector('.grid-scroll')!, {
    target: {
      scrollTop: 499 * 27
    }
  });
  expect(screen.getByRole('button', {
    name: 'Select row 500'
  })).toBeTruthy();
});
it('fetches only on Next when the total is unknown and learns the final total', async () => {
  const progress = vi.fn();
  await render(<PagedResults data={{
    ...data,
    totalRows: 501,
    hasMore: true
  }} cacheId='cache' setIndex={0} truncated={false} onUpdate={progress} onExport={vi.fn()} />);
  expect(screen.getByLabelText('1–500 of ' + 501 .toLocaleString() + '+')).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
  expect((screen.getByTitle('Last page (total not known yet)') as HTMLButtonElement).disabled).toBe(true);
  const result = {
    cacheId: 'cache',
    sets: [{
      ...data,
      totalRows: 751,
      hasMore: false
    }],
    complete: true,
    elapsedMs: 0,
    truncated: false
  };
  invoke.mockResolvedValueOnce({
    rows: allRows.slice(500, 751),
    totalRows: 751,
    hasMore: false,
    result
  });
  await fireEvent.click(screen.getByTitle('Next page'));
  await screen.findByLabelText('501–751 of ' + 751 .toLocaleString());
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenCalledWith(result);
  expect((screen.getByTitle('Next page') as HTMLButtonElement).disabled).toBe(true);
});
it('uses the initial requested size without refetching and stops navigation when closed', async () => {
  localStorage.setItem('datagoblin.pageSize', '10');
  const props = {
    data: {
      ...data,
      rows: allRows.slice(0, 10),
      totalRows: 11,
      hasMore: true
    },
    cacheId: 'cache',
    setIndex: 0,
    truncated: false,
    initialSize: 10,
    onExport: vi.fn()
  };
  const view = await render(<PagedResults {...props} />);
  expect(screen.getByLabelText('1–10 of 11+')).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
  await view.rerender(<PagedResults {...props} closed />);
  expect((screen.getByTitle('Next page') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Page size') as HTMLButtonElement).disabled).toBe(true);
});
it('navigates past 1,000 rows using the cache, including last, previous and first', async () => {
  await render(<PagedResults data={data} cacheId='cache' setIndex={1} truncated={false} onExport={vi.fn()} />);
  expect(screen.getByLabelText('1–500 of ' + 1251 .toLocaleString() + '')).toBeTruthy();
  expect((screen.getByTitle('First page') as HTMLButtonElement).disabled).toBe(true);
  await fireEvent.click(screen.getByTitle('Next page'));
  await screen.findByLabelText('501–1000 of ' + 1251 .toLocaleString() + '');
  await fireEvent.click(screen.getByTitle('Last page'));
  await screen.findByLabelText('1001–1251 of ' + 1251 .toLocaleString() + '');
  expect(screen.getByRole('button', {
    name: 'Select row 1001'
  })).toBeTruthy();
  expect(invoke).toHaveBeenLastCalledWith('result_page', {
    cacheId: 'cache',
    setIndex: 1,
    offset: 1000,
    pageSize: 500
  });
  expect((screen.getByTitle('Next page') as HTMLButtonElement).disabled).toBe(true);
  await fireEvent.click(screen.getByTitle('Previous page'));
  await screen.findByLabelText('501–1000 of ' + 1251 .toLocaleString() + '');
  await fireEvent.click(screen.getByTitle('First page'));
  await screen.findByLabelText('1–500 of ' + 1251 .toLocaleString() + '');
  expect(invoke.mock.calls.every(([command]) => command === 'result_page')).toBe(true);
});
it('supports preset, custom and All sizes and persists the default', async () => {
  const exportRows = vi.fn();
  await render(<PagedResults data={data} cacheId='cache' setIndex={0} truncated={false} onExport={exportRows} />);
  await chooseSize('10');
  await screen.findByLabelText('1–10 of ' + 1251 .toLocaleString() + '');
  await fireEvent.click(screen.getByLabelText('Page size'));
  await fireEvent.click(screen.getByText('Set as default'));
  expect(localStorage.getItem('datagoblin.pageSize')).toBe('10');
  await chooseSize('custom');
  await fireEvent.change(screen.getByLabelText('Custom page size'), {
    target: {
      value: '37'
    }
  });
  await fireEvent.click(screen.getByText('Apply'));
  await screen.findByLabelText('1–37 of ' + 1251 .toLocaleString() + '');
  await fireEvent.click(screen.getByRole('button', {
    name: /Export CSV/
  }));
  expect(exportRows).toHaveBeenCalledWith(allRows.slice(0, 37));
  await chooseSize('0');
  await screen.findByLabelText('1–1251 of ' + 1251 .toLocaleString() + '');
  expect((screen.getByTitle('Next page') as HTMLButtonElement).disabled).toBe(true);
});
it('preserves the current page after a cache error and applies the saved default', async () => {
  const log=vi.fn();
  localStorage.setItem('datagoblin.pageSize', '10');
  await render(<PagedResults data={data} cacheId='cache' setIndex={0} truncated={true} onExport={vi.fn()} onLog={log} />);
  await screen.findByLabelText('1–10 of ' + 1251 .toLocaleString() + '+');
  invoke.mockRejectedValueOnce('Results have expired. Run the query again to load them.');
  await fireEvent.click(screen.getByTitle('Next page'));
  await waitFor(()=>expect(log).toHaveBeenCalledWith(expect.objectContaining({kind:'error',text:'Results have expired. Run the query again to load them.'})));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('1–10 of ' + 1251 .toLocaleString() + '+')).toBeTruthy();
  await waitFor(() => expect((screen.getByTitle('Next page') as HTMLButtonElement).disabled).toBe(false));
});
it('rejects invalid custom sizes without losing displayed rows', async () => {
  await render(<PagedResults data={{
    ...data,
    totalRows: 10001
  }} cacheId='cache' setIndex={0} truncated={false} onExport={vi.fn()} />);
  await chooseSize('custom');
  await fireEvent.change(screen.getByLabelText('Custom page size'), {
    target: {
      value: '0'
    }
  });
  await fireEvent.click(screen.getByText('Apply'));
  expect(screen.getByRole('alert').textContent).toContain('between 1 and 10,000');
  expect(invoke).not.toHaveBeenCalled();
  expect(screen.getByLabelText('1–500 of ' + 10001 .toLocaleString())).toBeTruthy();
});
it('renders empty results without enabling navigation', async () => {
  await render(<PagedResults data={{
    columns: ['ID'],
    rows: [],
    totalRows: 0,
    affected: null
  }} cacheId='cache' setIndex={0} truncated={false} onExport={vi.fn()} />);
  expect(screen.getByLabelText('0 of 0')).toBeTruthy();
  expect((screen.getByTitle('Next page') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Query returned no rows.')).toBeTruthy();
});
it('shows refresh progress inside the table without a session-closed banner', async () => {
  const props = {
    data,
    cacheId: 'refresh-loading',
    setIndex: 0,
    truncated: false,
    onExport: vi.fn(),
    closed: true
  };
  const view = await render(<PagedResults {...props} browserBusy />);
  const loading = screen.getByRole('status', {
    name: 'Loading results'
  });
  expect(loading.closest('.grid-viewport')?.querySelector('table')).toBeTruthy();
  expect(screen.getByRole('button', {
    name: 'Select row 1'
  })).toBeTruthy();
  expect(screen.queryByText(/Result session closed/)).toBeNull();
  expect((screen.getByTitle('Next page') as HTMLButtonElement).disabled).toBe(true);
  await view.rerender(<PagedResults {...props} browserBusy={false} />);
  expect(screen.queryByRole('status', {
    name: 'Loading results'
  })).toBeNull();
  expect(screen.queryByText(/Result session closed/)).toBeNull();
});
it('keeps existing rows under the loading indicator while fetching a page', async () => {
  let resolve!: (value: unknown) => void;
  invoke.mockImplementationOnce(() => new Promise(done => {
    resolve = done;
  }));
  await render(<PagedResults data={data} cacheId='page-loading' setIndex={0} truncated={false} onExport={vi.fn()} />);
  await fireEvent.click(screen.getByTitle('Next page'));
  expect(screen.getByRole('status', {
    name: 'Loading results'
  })).toBeTruthy();
  expect(screen.getByRole('button', {
    name: 'Select row 1'
  })).toBeTruthy();
  resolve({
    rows: allRows.slice(500, 1000),
    totalRows: 1251
  });
  await screen.findByRole('button', {
    name: 'Select row 501'
  });
  expect(screen.queryByRole('status', {
    name: 'Loading results'
  })).toBeNull();
});

it('reports database work as busy but allows pending edits to be discarded for a new query', async () => {
  const onBusy = vi.fn();
  let failSubmit!: (error: Error) => void;
  invoke.mockImplementation(async command => {
    if (command === 'edit_capabilities') return { columns: ['Name'] };
    if (command === 'edit_rows') return new Promise((_, reject) => { failSubmit = reject; });
  });
  await render(<PagedResults data={{columns: ['Name'], rows: [['Before']], totalRows: 1, affected: null}} cacheId='busy-submit-regression' setIndex={0} truncated={false} onExport={vi.fn()} onReload={vi.fn()} onBusy={onBusy} browser={{table:'Agreement',filters:[],sort:null,sql:'SELECT * FROM Agreement',parameters:[]}} />);
  await screen.findByText('Double-click to edit · Primary keys are read-only');
  await fireEvent.doubleClick(screen.getByText('Before'));
  await fireEvent.change(screen.getByLabelText('Cell value'), {target:{value:'After'}});
  await fireEvent.keyDown(screen.getByLabelText('Cell value'), {key:'Enter'});
  expect(onBusy).toHaveBeenLastCalledWith(false);
  await fireEvent.click(screen.getByRole('button', {name:'Submit changes'}));
  await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(true));
  failSubmit(new Error('Submission failed'));
  await screen.findByText(/Submission failed/);
  await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect(screen.getByText('After')).toBeTruthy();
});
