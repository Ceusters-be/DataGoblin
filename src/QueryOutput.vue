<script setup lang="ts">
import { OutputLog } from './QueryOutput';
import { shallowRef, computed } from 'vue';
import { watchMounted } from './vueLifecycle';
import { Terminal } from '@lucide/vue';
import { timestamp } from './QueryOutput';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  log?: OutputLog;
}>();
const log = computed(() => _props.log);
const host = shallowRef<HTMLDivElement | null>(null),
  follow = shallowRef(true);
watchMounted(
  () => {
    const _log = log.value;
    return [_log];
  },
  () => {
    if (follow.value && host.value)
      host.value.scrollTop = host.value.scrollHeight;
  },
);
</script>

<template>
  <div
    ref="host"
    class="query-output execution-log"
    role="tabpanel"
    aria-label="Output"
    @scroll="
      (e) => {
        const node = e.currentTarget as HTMLInputElement;
        follow = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
      }
    "
  >
    <template v-if="log?.entries.length">
      <div
        role="log"
        aria-label="Execution log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <template
          v-for="(entry, index) in log.entries"
          :key="entry.at + ':' + index"
        >
          <div :class="'execution-log-entry ' + (entry.kind ?? 'info')">
            <time :datetime="new Date(entry.at).toISOString()">
              [{{ timestamp(entry.at) }}]
            </time>
            <pre>{{ entry.text }}</pre>
          </div>
        </template>
      </div>
    </template>
    <template v-else>
      <div class="result-empty">
        <Terminal :size="25"></Terminal>
        <h3>No output yet</h3>
        <p>Execution details and errors will appear here.</p>
      </div>
    </template>
  </div>
</template>
