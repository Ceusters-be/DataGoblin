<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from '@lucide/vue';
import { hasCustomTitlebar } from './WindowControls';
defineOptions({
  inheritAttrs: false,
});
const props = defineProps<{
  onError: (message: string) => void;
}>();
async function act(action: 'minimize' | 'toggleMaximize' | 'close') {
  try {
    // close() preserves the existing close-request handler that saves queries.
    await getCurrentWindow()[action]();
  } catch (error) {
    props.onError(String(error));
  }
}
const window = globalThis.window;
</script>

<template>
  <template v-if="hasCustomTitlebar()">
    <div class="window-controls" role="group" aria-label="Window controls">
      <button title="Minimize window" @click="() => void act('minimize')">
        <Minus :size="14"></Minus>
      </button>
      <button
        title="Maximize or restore window"
        @click="() => void act('toggleMaximize')"
      >
        <Square :size="12"></Square>
      </button>
      <button
        class="window-close"
        title="Close window"
        @click="() => void act('close')"
      >
        <X :size="16"></X>
      </button>
    </div>
  </template>
  <template v-else></template>
</template>
