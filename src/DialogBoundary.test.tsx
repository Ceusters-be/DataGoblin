// @vitest-environment jsdom
import { defineComponent, shallowRef } from 'vue';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from './testUtils';
import DialogBoundary from './DialogBoundary.vue';
afterEach(cleanup);
const Example = defineComponent((props: {
  busy?: boolean;
}) => {
  const open = shallowRef(false);
  return () => <><button onClick={() => open.value = true}>Open</button>{open.value && <DialogBoundary disabled={props.busy} onClose={() => open.value = false}><div role='dialog' aria-modal='true'><button>First</button><details><summary>More</summary><input aria-label='Hidden' /></details><button>Last</button></div></DialogBoundary>}</>;
}, {
  props: ['busy']
});
it('traps Tab, closes on Escape and restores the trigger focus', async () => {
  await render(<Example />);
  const trigger = screen.getByText('Open');
  trigger.focus();
  await fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByText('First'));
  screen.getByText('Last').focus();
  await fireEvent.keyDown(document, {
    key: 'Tab'
  });
  expect(document.activeElement).toBe(screen.getByText('First'));
  await fireEvent.keyDown(document, {
    key: 'Tab',
    shiftKey: true
  });
  expect(document.activeElement).toBe(screen.getByText('Last'));
  await fireEvent.keyDown(document, {
    key: 'Escape'
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it('does not dismiss a dialog while an operation is in progress', async () => {
  await render(<Example busy />);
  await fireEvent.click(screen.getByText('Open'));
  await fireEvent.keyDown(document, {
    key: 'Escape'
  });
  expect(screen.getByRole('dialog')).toBeTruthy();
});
