<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { ScopeChoice } from './explorerScope';
const props = defineProps<{ label: string; names: string[]; selected: string[]; all: boolean; origin: HTMLElement }>();
const emit = defineEmits<{ apply: [choice: ScopeChoice]; close: [] }>();
const root = ref<HTMLElement>();
const search = ref('');
const all = ref(props.all);
const chosen = ref([...props.selected]);
const visible = computed(() => props.names.filter(n => n.toLowerCase().includes(search.value.toLowerCase())));
const position = ref({ left: '0px', top: '0px' });
function finish() { emit('apply', all.value ? null : chosen.value); }
function toggle(name: string, checked: boolean) {
  if (all.value) chosen.value = [...props.names];
  all.value = false;
  chosen.value = checked ? [...new Set([...chosen.value, name])] : chosen.value.filter(n => n !== name);
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node) && !props.origin.contains(event.target as Node)) finish();
}
function place() {
  const rect = props.origin.getBoundingClientRect();
  position.value = { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 320))}px`, top: `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - (root.value?.offsetHeight ?? 360) - 8))}px` };
}
onMounted(() => { place(); root.value?.querySelector('input')?.focus(); document.addEventListener('pointerdown', outside); window.addEventListener('resize', place); });
onUnmounted(() => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); });
function close() { emit('close'); props.origin.focus(); }
</script>
<template>
  <Teleport to="body">
    <div ref="root" class="explorer-scope-picker" role="dialog" :aria-label="label" :style="position"
      @keydown.esc.stop.prevent="close" @keydown.enter.stop.prevent="finish">
      <strong>{{ label }}</strong>
      <input v-model="search" type="search" aria-label="Filter selection" placeholder="Filter…" />
      <label><input v-model="all" type="checkbox" @change="chosen = all ? [...names] : []" />All {{ label.startsWith('Databases') ? 'databases' : 'schemas' }}</label>
      <div class="explorer-scope-options">
        <label v-for="name in visible" :key="name"><input type="checkbox" :checked="all || chosen.includes(name)" @change="toggle(name, ($event.target as HTMLInputElement).checked)" />{{ name }}</label>
        <p v-if="!visible.length" class="quiet">No matches.</p>
      </div>
      <div class="explorer-scope-actions"><button @click="close">Cancel</button><button @click="finish">Apply</button></div>
      <small class="quiet">Enter or click outside to apply</small>
    </div>
  </Teleport>
</template>
<style scoped>
.explorer-scope-picker { position: fixed; z-index: 1000; width: 300px; max-height: calc(100vh - 16px); display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--panel); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 8px 24px #0003; }
.explorer-scope-picker label { display: flex; align-items: center; gap: 8px; padding: 4px; overflow-wrap: anywhere; }
.explorer-scope-picker input[type=checkbox] { width: 14px; height: 14px; flex-shrink: 0; }
.explorer-scope-options { max-height: 280px; overflow: auto; }
.explorer-scope-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
