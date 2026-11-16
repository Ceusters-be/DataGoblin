// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from './testUtils';
import TableMetadataFolders from './TableMetadataFolders.vue';
afterEach(cleanup);
it('shows collapsed metadata folders with accurate composite key counts and column badges', async () => {
  await render(<TableMetadataFolders columns={[{
    name: 'tenant_id',
    type: 'int',
    nullable: false
  }]} metadata={{
    objects: [{
      kind: 'primary',
      name: 'PK_invoice',
      columns: ['tenant_id', 'id'],
      details: ['tenant_id', 'id']
    }, {
      kind: 'foreign',
      name: 'FK_parent',
      columns: ['tenant_id'],
      details: ['tenant_id → parent.id']
    }]
  }} onRetry={() => {}} />);
  const primary = screen.getByText('Primary keys').closest('details')!;
  expect(primary.open).toBe(false);
  expect(primary.querySelector('summary')?.textContent).toBe('Primary keys1');
  await fireEvent.click(primary.querySelector('summary')!);
  expect(primary.open).toBe(true);
  expect(screen.getByText('FK_parent').closest('[title]')?.getAttribute('title')).toContain('parent.id');
  const column = screen.getByText('tenant_id');
  expect(column.parentElement?.querySelector('.object-key')).toBeTruthy();
  expect(column.parentElement?.querySelector('.object-foreign')).toBeTruthy();
});
it('distinguishes failed metadata from an empty collection and offers retry', async () => {
  const retry = vi.fn();
  await render(<TableMetadataFolders columns={[]} metadata={{
    error: 'Could not load keys and indexes.'
  }} onRetry={retry} />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText('None')).toBeNull();
  await fireEvent.click(screen.getByRole('button', {
    name: 'Retry'
  }));
  expect(retry).toHaveBeenCalledOnce();
});
