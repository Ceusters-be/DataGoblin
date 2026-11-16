<script setup lang="ts">
import { shallowRef, computed } from 'vue';
import { stateSetter, watchMounted, cssPixels } from './vueLifecycle';
import {
  storageKey,
  defaultLayout,
  savedLayout,
  fitLayout,
  defaultPanels,
} from './IslandWorkspace';
import Divider from './Divider.vue';
import { useSlots } from 'vue';
defineOptions({
  inheritAttrs: false,
});
const _props = withDefaults(
  defineProps<{
    panels?: typeof defaultPanels;
    hasResults?: boolean;
  }>(),
  { hasResults: undefined },
);
const panels = computed(() =>
  _props.panels === undefined ? defaultPanels : _props.panels,
);
const host = shallowRef<HTMLDivElement | null>(null);
const layout = shallowRef(savedLayout());
const setLayout = stateSetter(layout);
const size = shallowRef({
  width: 1200,
  height: 720,
});
const setSize = stateSetter(size);
watchMounted(
  () => [],
  () => {
    const measure = () => {
      const element = host.value;
      if (element && element.clientWidth && element.clientHeight)
        setSize({
          width: element.clientWidth,
          height: element.clientHeight,
        });
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    if (host.value) observer?.observe(host.value);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  },
);
watchMounted(
  () => {
    const _layout = layout.value;
    return [_layout];
  },
  () => {
    const _layout2 = layout.value;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(_layout2));
      } catch {
        /* Resizing still works without persistent storage. */
      }
    }, 150);
    return () => clearTimeout(timer);
  },
);
const fitted = computed(() => {
  const _size = size.value;
  const _layout3 = layout.value;
  return fitLayout(_size.width, _size.height, _layout3);
});
const slots = useSlots();
const hasResults = computed(() => _props.hasResults ?? !!slots.results);
</script>

<template>
  <div class="island-workspace">
    <div class="island-content" ref="host">
      <div
        class="island-top"
        :style="
          cssPixels(
            hasResults && panels.results
              ? {
                  flex: '0 0 ' + fitted.top + 'px',
                }
              : {
                  flex: 1,
                },
          )
        "
      >
        <div
          id="workspace-explorer"
          :hidden="!panels.explorer"
          class="workspace-island explorer-island"
          :style="
            cssPixels({
              width: fitted.left,
            })
          "
        >
          <slot name="explorer" />
        </div>
        <Divider
          :hidden="!panels.explorer"
          name="Resize explorer"
          axis="x"
          :value="fitted.left"
          :min="160"
          :max="Math.min(500, fitted.sideBudget - fitted.right)"
          :onChange="
            ((_fitted) => (left) => {
              return setLayout((current) => ({
                ...current,
                left,
                right: _fitted.right,
              }));
            })(fitted!)
          "
          @reset="
            () =>
              setLayout((current) => ({
                ...current,
                left: defaultLayout.left,
              }))
          "
        ></Divider>
        <div class="workspace-island editor-island"><slot name="editor" /></div>
        <Divider
          :hidden="!panels.queries"
          name="Resize saved queries"
          axis="x"
          :direction="-1"
          :value="fitted.right"
          :min="160"
          :max="Math.min(500, fitted.sideBudget - fitted.left)"
          :onChange="
            ((_fitted) => (right) => {
              return setLayout((current) => ({
                ...current,
                left: _fitted.left,
                right,
              }));
            })(fitted!)
          "
          @reset="
            () =>
              setLayout((current) => ({
                ...current,
                right: defaultLayout.right,
              }))
          "
        ></Divider>
        <div
          id="workspace-queries"
          :hidden="!panels.queries"
          class="workspace-island queries-island"
          :style="
            cssPixels({
              width: fitted.right,
            })
          "
        >
          <slot name="queries" />
        </div>
      </div>
      <template v-if="hasResults">
        <Divider
          :hidden="!panels.results"
          name="Resize editor and results"
          axis="y"
          :value="fitted.top"
          :min="220"
          :max="fitted.vertical - 140"
          :onChange="
            ((_fitted) => (top) => {
              return setLayout((current) => ({
                ...current,
                top: top / _fitted.vertical,
              }));
            })(fitted!)
          "
          @reset="
            () =>
              setLayout((current) => ({
                ...current,
                top: defaultLayout.top,
              }))
          "
        ></Divider>
        <div
          id="workspace-results"
          :hidden="!panels.results"
          class="workspace-island results-island"
        >
          <slot name="results" />
        </div>
      </template>
    </div>
    <slot name="footer" />
  </div>
</template>
