<script setup lang="ts">
import ThemeProvider from './ThemeProvider.vue';
import Workspace from './Workspace.vue';
import { onMounted, onBeforeUnmount } from 'vue';

function preventPageSelection(event: KeyboardEvent) {
  if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing || event.key.toLowerCase() !== 'a') return;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]')) return;
  // Editors and grids handle this shortcut first. App chrome must never fall
  // through to the WebView's native "select entire page" behavior.
  event.preventDefault();
  window.getSelection()?.removeAllRanges();
}
// Cancel only the native menu. Keep propagation intact for our custom menus,
// including menus rendered outside the app root through Teleport.
function preventNativeContextMenu(event: MouseEvent) { event.preventDefault(); }
onMounted(() => {
  document.addEventListener('keydown', preventPageSelection);
  document.addEventListener('contextmenu', preventNativeContextMenu);
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', preventPageSelection);
  document.removeEventListener('contextmenu', preventNativeContextMenu);
});
defineOptions({
  inheritAttrs: false,
});
</script>

<template>
  <ThemeProvider><Workspace></Workspace></ThemeProvider>
</template>
