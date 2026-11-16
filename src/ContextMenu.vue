<script setup lang="ts">
import { MenuAction } from './ContextMenu';
import { MenuPosition } from './ContextMenu';
import { shallowRef, computed, Teleport } from 'vue';
import { stateSetter, watchMounted, cssPixels } from './vueLifecycle';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  position: MenuPosition;
  label: string;
  actions: MenuAction[];
  onClose: () => void;
}>();
const position = computed(() => _props.position);
const label = computed(() => _props.label);
const actions = computed(() => _props.actions);
const onClose = computed(() => _props.onClose);
const ref = shallowRef<HTMLDivElement | null>(null);
const point = shallowRef({
  left: position.value.x,
  top: position.value.y,
});
const setPoint = stateSetter(point);
watchMounted(
  () => {
    const _position = position.value;
    return [_position];
  },
  () => {
    const _position2 = position.value;
    const _onClose = onClose.value;
    const node = ref.value!;
    const place = () => {
      const rect = node.getBoundingClientRect();
      setPoint({
        left: Math.max(
          8,
          Math.min(_position2.x, window.innerWidth - rect.width - 8),
        ),
        top: Math.max(
          8,
          Math.min(_position2.y, window.innerHeight - rect.height - 8),
        ),
      });
    };
    place();
    node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node)) _onClose();
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', outside);
    };
  },
);
function dismiss() {
  const _onClose2 = onClose.value;
  const _position3 = position.value;
  _onClose2();
  if (_position3.origin.isConnected) _position3.origin.focus();
}
const document = globalThis.document;
</script>

<template>
  <Teleport to="body">
    <div
      ref="ref"
      role="menu"
      :aria-label="label"
      class="context-menu"
      :style="cssPixels(point)"
      @contextmenu="(event) => event.preventDefault()"
      @keydown="
        (event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
          } else if (event.key === 'Tab') dismiss();
          else if (
            ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
          ) {
            event.preventDefault();
            const buttons = Array.from(
              ref!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            );
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const index =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (current +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[index]?.focus();
          }
        }
      "
    >
      <template v-for="item in actions" :key="item.label">
        <div>
          <template v-if="item.separator">
            <div role="separator"></div>
          </template>
          <button
            type="button"
            role="menuitem"
            :disabled="item.disabled"
            @click="
              () => {
                dismiss();
                item.action();
              }
            "
          >
            <span class="menu-icon">
              <component :is="item.icon" v-if="item.icon" :size="14" />
            </span>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </template>
    </div>
  </Teleport>
</template>
