// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResultToolbar } from './ResultToolbar';
afterEach(() => { cleanup(); vi.useRealTimers(); });
function props() { return {dirty:false,count:0,busy:false,submitted:false,canAdd:true,canDelete:false,onRefresh:vi.fn().mockResolvedValue(undefined),onCancel:vi.fn(),cancellable:true,interval:0,onInterval:vi.fn(),onAdd:vi.fn(),onDelete:vi.fn(),onRevert:vi.fn(),onPreview:vi.fn(),onSubmit:vi.fn(),onExport:vi.fn()}; }
it('uses the requested order and enables actions only when applicable', () => {
  const p=props(); const view=render(<ResultToolbar {...p}/>);
  expect(Array.from(screen.getByRole('toolbar').querySelectorAll('button')).map(b=>b.getAttribute('aria-label'))).toEqual(['Refresh results','Auto-refresh','Cancel result query','Add row','Delete selected rows','Revert changes','Preview pending changes','Submit changes','Export CSV']);
  expect((screen.getByRole('button',{name:'Submit changes'}) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ResultToolbar {...p} dirty count={2} canDelete/>);
  fireEvent.click(screen.getByRole('button',{name:'Submit changes'})); expect(p.onSubmit).toHaveBeenCalledOnce(); expect(p.onPreview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Cancel result query'})); expect(p.onCancel).toHaveBeenCalledOnce();
});
it('requires confirmation before discarding pending changes for refresh', async () => {
  const p={...props(),dirty:true,count:1}; render(<ResultToolbar {...p}/>);
  fireEvent.click(screen.getByRole('button',{name:'Refresh results'}));
  expect(screen.getByRole('dialog',{name:'Ignore Unsubmitted Changes'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'No'})); expect(p.onRefresh).not.toHaveBeenCalled(); expect(p.onRevert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Refresh results'}));
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Yes'})));
  expect(p.onRevert).toHaveBeenCalledOnce(); expect(p.onRefresh).toHaveBeenCalledOnce();
});
it('pauses automatic refresh while editing or busy and prevents overlapping requests', async () => {
  vi.useFakeTimers(); let finish:()=>void=()=>{};
  const p={...props(),interval:5,onRefresh:vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}))};
  const view=render(<ResultToolbar {...p} dirty/>);
  await act(async()=>vi.advanceTimersByTime(10000)); expect(p.onRefresh).not.toHaveBeenCalled();
  view.rerender(<ResultToolbar {...p} busy/>);
  await act(async()=>vi.advanceTimersByTime(5000)); expect(p.onRefresh).not.toHaveBeenCalled();
  view.rerender(<ResultToolbar {...p}/>);
  await act(async()=>vi.advanceTimersByTime(5000)); expect(p.onRefresh).toHaveBeenCalledTimes(1);
  await act(async()=>vi.advanceTimersByTime(15000)); expect(p.onRefresh).toHaveBeenCalledTimes(1);
  await act(async()=>finish()); await act(async()=>vi.advanceTimersByTime(5000)); expect(p.onRefresh).toHaveBeenCalledTimes(2);
  view.unmount(); await act(async()=>vi.advanceTimersByTime(10000)); expect(p.onRefresh).toHaveBeenCalledTimes(2);
});
it('offers interval presets and validates a custom interval', () => {
  const p=props(); render(<ResultToolbar {...p}/>);
  fireEvent.click(screen.getByRole('button',{name:'Auto-refresh'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'5 s'})); expect(p.onInterval).toHaveBeenCalledWith(5);
  fireEvent.click(screen.getByRole('button',{name:'Auto-refresh'})); fireEvent.click(screen.getByRole('menuitem',{name:'Custom…'}));
  const input=screen.getByLabelText('Update interval in seconds');
  fireEvent.change(input,{target:{value:'0'}}); fireEvent.submit(input.closest('form')!); expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.change(input,{target:{value:'17'}}); fireEvent.submit(input.closest('form')!); expect(p.onInterval).toHaveBeenCalledWith(17); expect(screen.queryByRole('dialog')).toBeNull();
});
