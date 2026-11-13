// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryHistory } from './QueryHistory';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('./SqlPreview', () => ({ SqlPreview: ({ value }: { value: string }) => <pre>{value}</pre> }));
afterEach(cleanup);
it('shows only this query without a scope selector', async () => {
  const base = { serverName: 'Server', database: 'db', engine: 'postgres', startedAt: '2026-11-12T12:00:00Z', durationMs: 1, status: 'completed', error: null };
  invoke.mockResolvedValue([{ ...base, id: '1', queryId: 'q1', sql: 'SELECT own' }, { ...base, id: '2', queryId: 'q2', sql: 'SELECT other' }, { ...base, id: '3', sql: 'SELECT legacy' }]);
  render(<QueryHistory queryId="q1" queryName="Query1" version={0} onOpen={vi.fn()} onClose={vi.fn()}/>);
  await screen.findByText('SELECT own');
  expect(invoke).toHaveBeenCalledWith('query_history', { queryId: 'q1' });
  expect(screen.queryByText('SELECT other')).toBeNull();
  expect(screen.queryByText('SELECT legacy')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});
