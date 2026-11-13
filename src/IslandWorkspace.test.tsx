// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IslandWorkspace, WorkspaceControls, useWorkspacePanels, defaultLayout, fitLayout, savedLayout } from './IslandWorkspace';
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const content = { explorer: <aside>Explorer</aside>, editor: <main>Editor</main>, queries: <aside>Queries</aside>, results: <section>Results</section>, footer: <footer>Status</footer> };
it('keeps sidebars and results usable when a saved large layout meets a smaller window', () => {
  const fitted = fitLayout(900, 500, { left: 500, right: 500, top: 0.85 });
  expect(fitted.left).toBeGreaterThanOrEqual(160); expect(fitted.right).toBeGreaterThanOrEqual(160);
  expect(fitted.left + fitted.right + 320 + 32).toBeLessThanOrEqual(900);
  expect(fitted.top).toBeGreaterThanOrEqual(220); expect(fitted.vertical - fitted.top).toBeGreaterThanOrEqual(140);
  localStorage.setItem('datagoblin.layout', '{bad'); expect(savedLayout()).toEqual(defaultLayout);
});
it('supports keyboard resizing, reset and restoring the saved panel sizes', async () => {
  const first = render(<IslandWorkspace {...content}/>);
  const left = screen.getByRole('separator', { name: 'Resize explorer' });
  fireEvent.keyDown(left, { key: 'ArrowRight' }); expect(left.getAttribute('aria-valuenow')).toBe('258');
  const right = screen.getByRole('separator', { name: 'Resize saved queries' });
  fireEvent.keyDown(right, { key: 'ArrowLeft' }); expect(right.getAttribute('aria-valuenow')).toBe('258');
  const split = screen.getByRole('separator', { name: 'Resize editor and results' });
  fireEvent.keyDown(split, { key: 'End' }); expect(Number(split.getAttribute('aria-valuenow'))).toBe(Number(split.getAttribute('aria-valuemax')));
  await waitFor(() => expect(JSON.parse(localStorage.getItem('datagoblin.layout')!).left).toBe(258));
  first.unmount(); render(<IslandWorkspace {...content}/>);
  expect(screen.getByRole('separator', { name: 'Resize explorer' }).getAttribute('aria-valuenow')).toBe('258');
  fireEvent.doubleClick(screen.getByRole('separator', { name: 'Resize explorer' }));
  expect(screen.getByRole('separator', { name: 'Resize explorer' }).getAttribute('aria-valuenow')).toBe('248');
});
it('drags and clamps a divider, then stops moving after pointer release', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  render(<IslandWorkspace {...content}/>);
  const left = screen.getByRole('separator', { name: 'Resize explorer' });
  Object.assign(left, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
  fireEvent.pointerDown(left, { button: 0, clientX: 250 }); fireEvent.pointerMove(left, { clientX: 320 });
  expect(left.getAttribute('aria-valuenow')).toBe('318');
  fireEvent.pointerMove(left, { clientX: 2000 }); expect(left.getAttribute('aria-valuenow')).toBe(left.getAttribute('aria-valuemax'));
  fireEvent.pointerUp(left); fireEvent.pointerMove(left, { clientX: 0 }); expect(left.getAttribute('aria-valuenow')).toBe(left.getAttribute('aria-valuemax'));
});
it('uses the full workspace height when there are no results or open queries', () => {
  render(<IslandWorkspace {...content} results={null}/>);
  expect(screen.queryByRole('separator', { name: 'Resize editor and results' })).toBeNull();
  expect(screen.getByText('Editor')).toBeTruthy();
});

function PanelHarness() {
  const { panels, togglePanel } = useWorkspacePanels();
  return <><WorkspaceControls panels={panels} onToggle={togglePanel}/><IslandWorkspace {...content} panels={panels} queries={<aside><input aria-label="Query search" defaultValue=""/></aside>}/></>;
}
it('hides panels without unmounting their state and persists visibility', async () => {
  const view = render(<PanelHarness/>);
  const search = screen.getByLabelText('Query search') as HTMLInputElement;
  fireEvent.change(search, { target: { value: 'invoices' } });
  fireEvent.click(screen.getByRole('button', { name: 'Saved Queries' }));
  expect(screen.queryByRole('textbox', { name: 'Query search' })).toBeNull();
  expect(search.isConnected).toBe(true);
  expect(screen.queryByRole('separator', { name: 'Resize saved queries' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Saved Queries' }));
  expect(screen.getByLabelText('Query search')).toBe(search);
  expect(search.value).toBe('invoices');
  fireEvent.click(screen.getByRole('button', { name: 'Results' }));
  expect(screen.queryByRole('separator', { name: 'Resize editor and results' })).toBeNull();
  expect(document.querySelector('.results-island')?.hasAttribute('hidden')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Database Explorer' }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem('datagoblin.panels')!)).toEqual({ explorer: false, queries: true, results: false }));
  view.unmount(); render(<PanelHarness/>);
  expect(screen.getByRole('button', { name: 'Database Explorer' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByRole('separator', { name: 'Resize explorer' })).toBeNull();
});
