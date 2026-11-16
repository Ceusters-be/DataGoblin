<script setup lang="ts">
import { shallowRef, computed, watchSyncEffect } from 'vue';
import { stateSetter, watchMounted } from './vueLifecycle';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, ExternalLink, Table2, X } from '@lucide/vue';
import type { ForeignReference } from './types';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  cacheId: string;
  column: string;
  onOpen: (reference: ForeignReference) => void;
  onClose: () => void;
}>();
const cacheId = computed(() => _props.cacheId);
const column = computed(() => _props.column);
const onOpen = computed(() => _props.onOpen);
const onClose = computed(() => _props.onClose);
const references = shallowRef<ForeignReference[]>([]);
const setReferences = stateSetter(references);
const error = shallowRef('');
const setError = stateSetter(error);
const loading = shallowRef(true);
const setLoading = stateSetter(loading);
const container = shallowRef<HTMLDivElement | null>(null);
const latestClose = shallowRef(onClose.value);
watchSyncEffect(() => {
  const _onClose = onClose.value;
  return (latestClose.value = _onClose);
});
const close = shallowRef<HTMLButtonElement | null>(null);
watchMounted(
  () => [],
  () => {
    const origin = document.activeElement as HTMLElement | null;
    const outside = (event: PointerEvent) => {
      if (!container.value?.contains(event.target as Node)) latestClose.value();
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      if (origin?.isConnected) origin.focus();
    };
  },
);
watchMounted(
  () => {
    const _cacheId = cacheId.value;
    const _column = column.value;
    return [_cacheId, _column];
  },
  () => {
    const _cacheId2 = cacheId.value;
    const _column2 = column.value;
    close.value?.focus();
    let active = true;
    void invoke<ForeignReference[]>('result_references', {
      cacheId: _cacheId2,
      column: _column2,
    })
      .then((value) => {
        if (active) setReferences(value);
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
</script>

<template>
  <div
    ref="container"
    class="reference-picker"
    role="dialog"
    aria-label="Related records"
    @keydown="
      (e) => {
        const _onClose2 = onClose!;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          _onClose2();
        }
      }
    "
  >
    <header>
      <div>
        <strong>Open related record</strong>
        <small>
          From column
          <b>{{ column }}</b>
        </small>
      </div>
      <button
        class="icon-button"
        aria-label="Close relationships"
        title="Close"
        ref="close"
        @click="onClose"
      >
        <X :size="17"></X>
      </button>
    </header>
    <template v-if="loading"><p>Loading relationships…</p></template>
    <template v-if="error">
      <p role="alert">{{ error }}</p>
    </template>
    <template v-if="!loading && !error && !references.length">
      <p>No relationship metadata is available for this column.</p>
    </template>
    <template v-for="r in references" :key="r.id">
      <section class="reference-target" :title="'Foreign key: ' + r.name">
        <div class="reference-destination">
          <Table2 :size="18" aria-hidden="true"></Table2>
          <div>
            <small>Referenced table</small>
            <strong>{{ r.schema }}.{{ r.table }}</strong>
          </div>
        </div>
        <div class="reference-mappings">
          <template v-for="(source, index) in r.columns" :key="index">
            <div>
              <code>{{ source }}</code>
              <ArrowRight :size="14" aria-label="references"></ArrowRight>
              <code>{{ r.targetColumns[index] }}</code>
            </div>
          </template>
        </div>
        <button
          class="reference-open"
          :aria-label="'Open record in ' + r.schema + '.' + r.table"
          @click="
            () => {
              const _onOpen = onOpen!;
              return _onOpen(r);
            }
          "
        >
          Open record
          <ExternalLink :size="14"></ExternalLink>
        </button>
      </section>
    </template>
    <template v-if="!loading && references.length > 0">
      <p class="reference-hint">
        Opens in a new query tab on the same database.
      </p>
    </template>
  </div>
</template>
