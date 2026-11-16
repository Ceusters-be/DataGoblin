<script setup lang="ts">
import { FileCode2, Pin, MoreHorizontal } from '@lucide/vue';
import type { SavedQuery } from './types';
const props = defineProps<{
  query: SavedQuery;
  activeId: string;
  busy: boolean;
  onOpen: (query: SavedQuery) => void;
  onMenu: (query: SavedQuery, x: number, y: number) => void;
}>();
function openMenu(event: MouseEvent | KeyboardEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  props.onMenu(props.query, rect.left, rect.bottom);
}
function menuKey(event: KeyboardEvent) {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    openMenu(event);
  }
}
</script>

<template>
  <div
    class="saved-query-row"
    @contextmenu.prevent="onMenu(query, $event.clientX, $event.clientY)"
  >
    <button
      :title="query.name + (query.database ? ' · ' + query.database : '')"
      :class="{ 'current-query': query.id === activeId }"
      @click="onOpen(query)"
      @keydown="menuKey"
    >
      <Pin v-if="query.pinned" :size="14" />
      <FileCode2 v-else :size="14" />
      <span>{{ query.name }}</span>
    </button>
    <button
      class="icon-button query-actions"
      :aria-label="'Actions for ' + query.name"
      :disabled="busy"
      @click="openMenu"
    >
      <MoreHorizontal :size="14" />
    </button>
  </div>
</template>
