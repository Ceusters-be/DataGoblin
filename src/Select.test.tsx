// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from './testUtils';
import Select from './Select.vue';
afterEach(cleanup);
const options = [{
  value: 'a',
  label: 'Alpha'
}, {
  value: 'b',
  label: 'Beta'
}, {
  value: 'c',
  label: 'Charlie'
}];
it('searches, selects using the keyboard, and restores focus', async () => {
  const change = vi.fn();
  await render(<Select label='Database' value='a' options={options} searchable onChange={change} />);
  const trigger = screen.getByRole('combobox', {
    name: 'Database'
  });
  await fireEvent.keyDown(trigger, {
    key: 'ArrowDown'
  });
  const search = screen.getByLabelText('Search database');
  expect(document.activeElement).toBe(search);
  await fireEvent.change(search, {
    target: {
      value: 'beta'
    }
  });
  expect(screen.queryByRole('option', {
    name: 'Alpha'
  })).toBeNull();
  await fireEvent.keyDown(search, {
    key: 'Enter'
  });
  expect(change).toHaveBeenCalledWith('b');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it('supports list navigation, Escape, outside dismissal, and disabled controls', async () => {
  const change = vi.fn();
  const view = await render(<Select label='Condition' value='a' options={options} onChange={change} />);
  const trigger = screen.getByRole('combobox');
  await fireEvent.click(trigger);
  await fireEvent.keyDown(screen.getByRole('listbox'), {
    key: 'End'
  });
  await fireEvent.keyDown(screen.getByRole('listbox'), {
    key: 'Enter'
  });
  expect(change).toHaveBeenCalledWith('c');
  await fireEvent.click(trigger);
  await fireEvent.keyDown(screen.getByRole('listbox'), {
    key: 'Escape'
  });
  expect(document.activeElement).toBe(trigger);
  await fireEvent.click(trigger);
  await fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('listbox')).toBeNull();
  await view.rerender(<Select label='Condition' value='a' options={options} onChange={change} disabled />);
  await fireEvent.click(trigger);
  expect(screen.queryByRole('listbox')).toBeNull();
});
