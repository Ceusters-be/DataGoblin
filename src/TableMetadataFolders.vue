<script setup lang="ts">
import type { TableObject } from './tableObjects';
import { TableMetadata } from './TableMetadataFolders';
import { shallowRef, computed } from 'vue';
import { stateSetter } from './vueLifecycle';
import {
  ChevronRight,
  Columns3,
  Folder,
  KeyRound,
  Link2,
  ListOrdered,
} from '@lucide/vue';
import type { Column } from './types';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  columns: Column[];
  metadata?: TableMetadata;
  onRetry: () => void;
}>();
const columns = computed(() => _props.columns);
const metadata = computed(() => _props.metadata);
const onRetry = computed(() => _props.onRetry);
const open = shallowRef<Record<string, boolean>>({});
const setOpen = stateSetter(open);
const groups = computed(() => {
  const _columns = columns.value;
  const _metadata = metadata.value;
  return [
    {
      key: 'columns',
      label: 'Columns',
      items: _columns,
    },
    ...(
      [
        {
          key: 'primary',
          label: 'Primary keys',
        },
        {
          key: 'unique',
          label: 'Unique keys',
        },
        {
          key: 'foreign',
          label: 'Foreign keys',
        },
        {
          key: 'index',
          label: 'Indexes',
        },
      ] as const
    ).map((group) => ({
      ...group,
      items: (_metadata?.objects ?? []).filter(
        (item) => item.kind === group.key,
      ),
    })),
  ];
});
function describeItem(item: Column | TableObject) {
  const object = 'kind' in item ? item : undefined;
  const primary =
    !object &&
    !!metadata.value?.objects?.some(
      (key) => key.kind === 'primary' && key.columns.includes(item.name),
    );
  const foreign =
    !object &&
    !!metadata.value?.objects?.some(
      (key) => key.kind === 'foreign' && key.columns.includes(item.name),
    );
  const isForeign = object?.kind === 'foreign' || foreign;
  const isKey =
    object?.kind === 'primary' || object?.kind === 'unique' || primary;
  return {
    name: item.name,
    primary,
    foreign,
    object,
    type: 'type' in item ? item.type : '',
    icon: isForeign
      ? Link2
      : isKey
        ? KeyRound
        : object
          ? ListOrdered
          : Columns3,
    color: isForeign
      ? 'object-foreign'
      : isKey
        ? 'object-key'
        : 'object-column',
    detail: object
      ? object.details.join('\n')
      : (item as Column).type +
        ' · ' +
        ((item as Column).nullable ? 'nullable' : 'not null'),
  };
}
const displayGroups = computed(() =>
  groups.value.map((group) => ({
    ...group,
    items: group.items.map(describeItem),
  })),
);
</script>

<template>
  <div class="table-metadata-folders">
    <p v-if="metadata?.loading" class="explorer-inline-state" role="status">
      Loading table metadata…
    </p>
    <p v-if="metadata?.error" class="explorer-inline-state" role="alert">
      {{ metadata.error }}
      <button @click="onRetry">Retry</button>
    </p>
    <details
      v-for="group in displayGroups"
      :key="group.key"
      :open="!!open[group.key]"
    >
      <summary
        @click.prevent="
          setOpen((current) => ({
            ...current,
            [group.key]: !current[group.key],
          }))
        "
      >
        <ChevronRight :size="12" />
        <Folder :size="14" class="object-folder" />
        <strong>{{ group.label }}</strong>
        <span>
          {{
            metadata?.loading && !group.items.length
              ? '…'
              : metadata?.error && !group.items.length
                ? '?'
                : group.items.length
          }}
        </span>
      </summary>
      <div
        v-for="item in group.items"
        :key="item.name"
        class="metadata-object"
        :title="item.name + '\n' + item.detail"
      >
        <component :is="item.icon" :size="13" :class="item.color" />
        <KeyRound
          v-if="item.primary && item.foreign"
          :size="11"
          class="object-key"
        />
        <span>{{ item.name }}</span>
        <small v-if="!item.object">{{ item.type }}</small>
      </div>
      <p
        v-if="!group.items.length && !metadata?.loading && !metadata?.error"
        class="explorer-inline-state"
      >
        None
      </p>
    </details>
  </div>
</template>
