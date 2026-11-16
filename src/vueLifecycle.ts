import { onMounted, onBeforeUnmount, onUpdated, watch, type Ref, type CSSProperties } from 'vue';

export type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

/** Immutable updates keep large row arrays out of Vue's deep proxy graph. */
export function stateSetter<T>(state: Ref<T>): StateSetter<T> {
  return next => { state.value = typeof next === 'function' ? (next as (previous: T) => T)(state.value) : next; };
}

/** DOM-dependent observers start after mount and own their cleanup. */
export function watchMounted(sources: () => readonly unknown[], effect: () => void | (() => void)) {
  let stop: (() => void) | undefined;
  onMounted(() => {
    // Multi-source watches compare each entry, not the freshly allocated array.
    const initial = sources();
    stop = watch(initial.map((_, index) => () => sources()[index]), (_, __, cleanup) => {
      const dispose = effect();
      if (dispose) cleanup(dispose);
    }, { immediate: true, flush: 'post' });
  });
  onBeforeUnmount(() => stop?.());
}

export function afterRender(effect: () => void | (() => void)) {
  let dispose: void | (() => void);
  const run = () => { dispose?.(); dispose = effect(); };
  onMounted(run);
  onUpdated(run);
  onBeforeUnmount(() => dispose?.());
}

const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'gridRow', 'gridColumn']);
/** Explicit CSS dimensions for calculated geometry in JSX render functions. */
export function cssPixels(style: CSSProperties | Record<string, unknown>): CSSProperties {
  return Object.fromEntries(Object.entries(style).map(([key, value]) => [key,
    typeof value === 'number' && value !== 0 && !unitless.has(key) && !key.startsWith('--') ? `${value}px` : value,
  ])) as CSSProperties;
}
