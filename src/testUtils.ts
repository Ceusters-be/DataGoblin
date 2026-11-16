import { defineComponent, nextTick, shallowRef, type VNode } from 'vue';
import { render as renderVue, fireEvent as events } from '@testing-library/vue';
export { cleanup, screen, within, waitFor } from '@testing-library/vue';

/** Mount render-function fixtures through Vue, preserving instance identity on updates. */
export async function render(node: VNode | (() => VNode)) {
  const current = shallowRef(node);
  const view = renderVue(defineComponent({ setup: () => () => typeof current.value === 'function' ? current.value() : current.value }));
  await nextTick();
  return { ...view, rerender: async (next: VNode) => { current.value = next; await nextTick(); } };
}

export const fireEvent = Object.assign((...args: Parameters<typeof events>) => events(...args), events, {
  async change(node: Element, options?: { target?: { value?: string } }) {
    await events.update(node, options?.target?.value);
  },
});

export async function act(fn: () => unknown) { await fn(); await nextTick(); }
