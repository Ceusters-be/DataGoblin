<script setup lang="ts">
import { defaultPanels } from './IslandWorkspace';
import { computed } from 'vue';
import { Database, FolderOpen, Table2 } from '@lucide/vue';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  panels: typeof defaultPanels;
  onToggle: (panel: keyof typeof defaultPanels) => void;
}>();
const panels = computed(() => _props.panels);
const onToggle = computed(() => _props.onToggle);
</script>

<template>
  <div class="workspace-controls" role="group" aria-label="Workspace panels">
    <template
      v-for="{ key, label, icon: Icon } in [
        {
          key: 'explorer',
          label: 'Database Explorer',
          icon: Database,
        },
        {
          key: 'results',
          label: 'Results',
          icon: Table2,
        },
        {
          key: 'queries',
          label: 'Saved Queries',
          icon: FolderOpen,
        },
      ] as const"
      :key="key"
    >
      <button
        class="icon-button"
        type="button"
        :title="(panels[key] ? 'Hide ' : 'Show ') + label"
        :aria-label="label"
        :aria-pressed="panels[key]"
        :aria-controls="'workspace-' + key"
        @click="
          () => {
            const _onToggle = onToggle!;
            return _onToggle(key);
          }
        "
      >
        <component :is="Icon" :size="17" />
      </button>
    </template>
  </div>
</template>
