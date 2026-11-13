// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ColumnFilterMenu } from './ColumnFilterMenu';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('repositions expanded controls within the viewport and adapts when the window shrinks', () => {
  vi.stubGlobal('innerWidth', 1024);
  vi.stubGlobal('innerHeight', 600);
  const anchor = document.createElement('button');
  anchor.getBoundingClientRect = () => ({ left: 900, bottom: 450 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: 360, height: this.querySelector('details')?.open ? 650 : 280 } as DOMRect;
  });
  render(<ColumnFilterMenu name="JobActionCOID" values={['one']} anchor={anchor} onApply={vi.fn()} onSelect={vi.fn()} onClear={vi.fn()} onClose={vi.fn()}/>);
  const dialog = screen.getByRole('dialog') as HTMLElement;
  expect(dialog.style.left).toBe('656px');
  expect(dialog.style.top).toBe('312px');
  const details = screen.getByText('Advanced condition').parentElement as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  expect(dialog.style.top).toBe('8px');
  expect(dialog.style.maxHeight).toBe('584px');
  vi.stubGlobal('innerHeight', 400);
  fireEvent(window, new Event('resize'));
  expect(dialog.style.maxHeight).toBe('384px');
  expect(dialog.style.top).toBe('8px');
  expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
});
