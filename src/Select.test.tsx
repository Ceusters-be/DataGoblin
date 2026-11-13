// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Select } from './Select';
afterEach(cleanup);
const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Charlie' }];
it('searches, selects using the keyboard, and restores focus', () => {
  const change = vi.fn();
  render(<Select label="Database" value="a" options={options} searchable onChange={change}/>);
  const trigger = screen.getByRole('combobox', { name: 'Database' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const search = screen.getByLabelText('Search database');
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: 'beta' } });
  expect(screen.queryByRole('option', { name: 'Alpha' })).toBeNull();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(change).toHaveBeenCalledWith('b');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it('supports list navigation, Escape, outside dismissal, and disabled controls', () => {
  const change = vi.fn();
  const view = render(<Select label="Condition" value="a" options={options} onChange={change}/>);
  const trigger = screen.getByRole('combobox');
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'End' });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
  expect(change).toHaveBeenCalledWith('c');
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('listbox')).toBeNull();
  view.rerender(<Select label="Condition" value="a" options={options} onChange={change} disabled/>);
  fireEvent.click(trigger);
  expect(screen.queryByRole('listbox')).toBeNull();
});
