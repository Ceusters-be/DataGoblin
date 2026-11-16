// @vitest-environment jsdom
import { defineComponent, shallowRef } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from './testUtils';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import ThemeProvider from './ThemeProvider.vue';
import { useTheme, savedTheme } from './theme';
import Editor from './Editor.vue';
function Switches() {
  const {
    theme,
    setTheme
  } = useTheme();
  return <><span>{theme}</span><button onClick={() => setTheme('daylight')}>Light</button><button onClick={() => setTheme('midnight')}>Night</button></>;
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});
it('persists appearance and safely handles unknown preferences', async () => {
  localStorage.setItem('datagoblin.theme', 'missing');
  expect(savedTheme()).toBe('system');
  const first = await render(<ThemeProvider><Switches /></ThemeProvider>);
  await fireEvent.click(screen.getByText('Light'));
  expect(document.documentElement.dataset.theme).toBe('daylight');
  expect(localStorage.getItem('datagoblin.theme')).toBe('daylight');
  first.unmount();
  await render(<ThemeProvider><Switches /></ThemeProvider>);
  expect(screen.getByText('daylight')).toBeTruthy();
});
it('tracks system appearance changes', async () => {
  let listener: () => void = () => {};
  const media = {
    matches: true,
    addEventListener: (_: string, f: () => void) => {
      listener = f;
    },
    removeEventListener: vi.fn()
  };
  vi.stubGlobal('matchMedia', () => media);
  localStorage.setItem('datagoblin.theme', 'system');
  await render(<ThemeProvider><Switches /></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe('midnight');
  await act(() => {
    media.matches = false;
    listener();
  });
  expect(document.documentElement.dataset.theme).toBe('daylight');
});
it('keeps the editor document, selection and undo history across theme changes', async () => {
  const {
    container
  } = await render(<ThemeProvider><Switches /><Editor value='SELECT 1;' engine='postgres' schema={{}} onChange={vi.fn()} onRun={vi.fn()} onSave={vi.fn()} /></ThemeProvider>);
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
  await act(() => view.dispatch({
    changes: {
      from: 7,
      to: 8,
      insert: '42'
    },
    selection: {
      anchor: 9
    }
  }));
  await fireEvent.click(screen.getByText('Light'));
  expect(EditorView.findFromDOM(container.querySelector('.cm-editor')!)).toBe(view);
  expect(view.state.doc.toString()).toBe('SELECT 42;');
  expect(view.state.selection.main.head).toBe(9);
  expect(view.state.facet(EditorView.darkTheme)).toBe(false);
  await fireEvent.click(screen.getByText('Night'));
  expect(view.state.facet(EditorView.darkTheme)).toBe(true);
  await act(() => {
    undo(view);
  });
  expect(view.state.doc.toString()).toBe('SELECT 1;');
});
it.each(['graphite', 'goblin'])('maps the removed %s preference to Midnight', async previous => {
  localStorage.setItem('datagoblin.theme', previous);
  await render(<ThemeProvider><Switches /></ThemeProvider>);
  expect(screen.getByText('midnight')).toBeTruthy();
  expect(document.documentElement.dataset.theme).toBe('midnight');
});
