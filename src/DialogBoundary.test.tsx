// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogBoundary } from './DialogBoundary';
afterEach(cleanup);
function Example({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open</button>{open && <DialogBoundary disabled={busy} onClose={() => setOpen(false)}><div role="dialog" aria-modal="true"><button>First</button><details><summary>More</summary><input aria-label="Hidden"/></details><button>Last</button></div></DialogBoundary>}</>;
}
it('traps Tab, closes on Escape and restores the trigger focus', () => {
  render(<Example/>); const trigger = screen.getByText('Open'); trigger.focus(); fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByText('First'));
  screen.getByText('Last').focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(screen.getByText('First'));
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(screen.getByText('Last'));
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('does not dismiss a dialog while an operation is in progress', () => {
  render(<Example busy/>); fireEvent.click(screen.getByText('Open')); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeTruthy();
});
