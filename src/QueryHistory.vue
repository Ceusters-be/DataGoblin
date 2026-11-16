<script setup lang="ts">
import { shallowRef, computed } from 'vue';
import { stateSetter, watchMounted } from './vueLifecycle';
import { invoke } from '@tauri-apps/api/core';
import { X, Search } from '@lucide/vue';
import SqlPreview from './SqlPreview.vue';
import type { QueryHistoryEntry } from './types';
import { statusLabel } from './QueryHistory';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  version: number;
  queryId: string;
  queryName: string;
  onOpen: (entry: QueryHistoryEntry) => void;
  onClose: () => void;
}>();
const version = computed(() => _props.version);
const queryId = computed(() => _props.queryId);
const queryName = computed(() => _props.queryName);
const onOpen = computed(() => _props.onOpen);
const onClose = computed(() => _props.onClose);
const entries = shallowRef<QueryHistoryEntry[]>([]);
const setEntries = stateSetter(entries);
const filter = shallowRef('');
const setFilter = stateSetter(filter);
const selected = shallowRef<string | null>(null);
const setSelected = stateSetter(selected);
const error = shallowRef('');
const setError = stateSetter(error);
const loading = shallowRef(true);
const setLoading = stateSetter(loading);
const search = shallowRef<HTMLInputElement | null>(null);
watchMounted(
  () => [],
  () => {
    const origin = document.activeElement as HTMLElement | null;
    search.value?.focus();
    return () => {
      if (origin?.isConnected) origin.focus();
    };
  },
);
watchMounted(
  () => {
    const _version = version.value;
    const _queryId = queryId.value;
    return [_version, _queryId];
  },
  () => {
    const _queryId2 = queryId.value;
    let active = true;
    setLoading(true);
    setEntries([]);
    setSelected(null);
    void invoke<QueryHistoryEntry[]>('query_history', {
      queryId: _queryId2,
    })
      .then((value) => {
        if (active) {
          setEntries(value ?? []);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  },
);
const matches = computed(() => {
  const _entries = entries.value;
  const _queryId3 = queryId.value;
  const _filter = filter.value;
  return _entries.filter(
    (e) =>
      e.queryId === _queryId3 &&
      [
        e.sql,
        e.serverName,
        e.database,
        e.error ?? '',
        statusLabel[e.status],
      ].some((value) =>
        value.toLocaleLowerCase().includes(_filter.toLocaleLowerCase()),
      ),
  );
});
const entry = computed(() => {
  const _entries2 = entries.value;
  const _selected = selected.value;
  return _entries2.find((e) => e.id === _selected);
});
</script>

<template>
  <aside
    class="query-history"
    aria-label="Query history"
    @keydown="
      (event) => {
        const _onClose = onClose!;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          _onClose();
        }
      }
    "
  >
    <header>
      <strong>History · {{ queryName }}</strong>
      <button aria-label="Close query history" @click="onClose">
        <X :size="17"></X>
      </button>
    </header>
    <label class="history-search">
      <Search :size="14"></Search>
      <input
        ref="search"
        aria-label="Search query history"
        placeholder="SQL, database, server or error"
        :value="filter"
        @input="(e) => setFilter((e.target as HTMLInputElement).value)"
      />
    </label>
    <small class="history-note">
      Executions from this query · stored on this device
    </small>
    <template v-if="error">
      <p role="alert">{{ error }}</p>
    </template>
    <template v-if="loading"><p role="status">Loading history…</p></template>
    <div class="history-list">
      <template v-for="e in matches" :key="e.id">
        <button
          :class="'history-entry' + (selected === e.id ? ' selected' : '')"
          @click="() => setSelected(e.id)"
        >
          <span>{{ e.serverName }} / {{ e.database }}</span>
          <small>
            {{ new Date(e.startedAt).toLocaleString() }} ·
            {{ e.durationMs.toLocaleString() }} ms · {{ statusLabel[e.status] }}
          </small>
          <code>{{ e.sql }}</code>
        </button>
      </template>
      <template v-if="!loading && !matches.length">
        <p>
          {{
            filter
              ? 'No matching executions.'
              : 'Run a query to start your history.'
          }}
        </p>
      </template>
    </div>
    <template v-if="entry">
      <section class="history-detail">
        <div>
          <strong>{{ statusLabel[entry.status] }}</strong>
          <button
            @click="
              () => {
                const _onOpen = onOpen!;
                const _entry = entry!;
                return _onOpen(_entry);
              }
            "
          >
            Open in new query
          </button>
        </div>
        <small>
          {{
            entry.status === 'results'
              ? 'Duration measures time to the first page, not the complete result stream.'
              : 'Duration measures the execution request.'
          }}
        </small>
        <SqlPreview :value="entry.sql" :engine="entry.engine"></SqlPreview>
        <template v-if="entry.error">
          <pre class="history-error">{{ entry.error }}</pre>
        </template>
      </section>
    </template>
  </aside>
</template>
