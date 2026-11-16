<script setup lang="ts">
import { shallowRef, computed } from 'vue';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  hidden?: boolean;
  direction?: 1 | -1;
  name: string;
  axis: 'x' | 'y';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
}>();
const name = computed(() => _props.name);
const axis = computed(() => _props.axis);
const value = computed(() => _props.value);
const min = computed(() => _props.min);
const max = computed(() => _props.max);
const onChange = computed(() => _props.onChange);
const onReset = computed(() => _props.onReset);
const direction = computed(() =>
  _props.direction === undefined ? 1 : _props.direction,
);
const hidden = computed(() =>
  _props.hidden === undefined ? false : _props.hidden,
);
const drag = shallowRef<{
  coordinate: number;
  value: number;
} | null | null>(null);
const clamp = (n: number) => {
  const _min = min.value;
  const _max = max.value;
  return Math.max(_min, Math.min(_max, n));
};
</script>

<template>
  <div
    :hidden="hidden"
    :class="'workspace-divider ' + (axis === 'x' ? 'vertical' : 'horizontal')"
    role="separator"
    :tabindex="0"
    :aria-label="name"
    :aria-orientation="axis === 'x' ? 'vertical' : 'horizontal'"
    :aria-valuenow="Math.round(value)"
    :aria-valuemin="Math.round(min)"
    :aria-valuemax="Math.round(max)"
    title="Drag to resize · Arrow keys to adjust · Double-click to reset"
    @dblclick="onReset"
    @keydown="
      (event) => {
        const _axis = axis!;
        const _onChange = onChange!;
        const _value = value!;
        const _direction = direction!;
        const _min2 = min!;
        const _max2 = max!;
        const keys =
          _axis === 'x'
            ? ['ArrowLeft', 'ArrowRight']
            : ['ArrowUp', 'ArrowDown'];
        if (keys.includes(event.key)) {
          event.preventDefault();
          _onChange(
            clamp(
              _value +
                (event.key === keys[0] ? -1 : 1) *
                  (event.shiftKey ? 40 : 10) *
                  _direction,
            ),
          );
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          _onChange(event.key === 'Home' ? _min2 : _max2);
        }
      }
    "
    @pointerdown="
      (event) => {
        const _axis = axis!;
        const _value = value!;
        if (event.button !== 0) return;
        event.preventDefault();
        (event.currentTarget as HTMLInputElement).focus();
        (event.currentTarget as HTMLInputElement).setPointerCapture(
          event.pointerId,
        );
        drag = {
          coordinate: _axis === 'x' ? event.clientX : event.clientY,
          value: _value,
        };
        (event.currentTarget as HTMLInputElement).dataset.dragging = 'true';
      }
    "
    @pointermove="
      (event) => {
        const _onChange = onChange!;
        const _axis = axis!;
        const _direction = direction!;
        if (drag)
          _onChange(
            clamp(
              drag.value +
                ((_axis === 'x' ? event.clientX : event.clientY) -
                  drag.coordinate) *
                  _direction,
            ),
          );
      }
    "
    @pointerup="
      (event) => {
        drag = null;
        delete (event.currentTarget as HTMLInputElement).dataset.dragging;
        if (
          (event.currentTarget as HTMLInputElement).hasPointerCapture(
            event.pointerId,
          )
        )
          (event.currentTarget as HTMLInputElement).releasePointerCapture(
            event.pointerId,
          );
      }
    "
    @pointercancel="
      (event) => {
        drag = null;
        delete (event.currentTarget as HTMLInputElement).dataset.dragging;
      }
    "
    @lostpointercapture="
      (event) => {
        drag = null;
        delete (event.currentTarget as HTMLInputElement).dataset.dragging;
      }
    "
  ></div>
</template>
