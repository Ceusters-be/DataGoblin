// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextMenu } from './ContextMenu';
afterEach(cleanup);
it('navigates enabled actions and returns focus on Escape', () => {
  const origin = document.createElement('button'); document.body.append(origin);
  const close = vi.fn(); const action = vi.fn();
  render(<ContextMenu label="Actions" position={{ x: 9999, y: 9999, origin }} onClose={close} actions={[{ label: 'First', action }, { label: 'Disabled', disabled: true, action }, { label: 'Last', action }]}/>);
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'First' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Last' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(origin); expect(action).not.toHaveBeenCalled(); origin.remove();
});
