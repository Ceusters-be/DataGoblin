<script setup lang="ts">
import { Engine } from './types';
import { shallowRef, computed } from 'vue';
import { watchMounted } from './vueLifecycle';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorAppearance } from './editorAppearance';
import { useTheme } from './theme';
import { PostgreSQL, MSSQL, sql } from '@codemirror/lang-sql';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  value: string;
  engine: Engine;
}>();
const value = computed(() => _props.value);
const engine = computed(() => _props.engine);
const _store = useTheme();
const dark = computed(() => _store.dark);
const host = shallowRef<HTMLDivElement | null>(null);
watchMounted(
  () => {
    const _value = value.value;
    const _engine = engine.value;
    const _dark = dark.value;
    return [_value, _engine, _dark];
  },
  () => {
    const _value2 = value.value;
    const _engine2 = engine.value;
    const _dark2 = dark.value;
    if (!host.value) return;
    const view = new EditorView({
      parent: host.value,
      state: EditorState.create({
        doc: _value2,
        extensions: [
          sql({
            dialect: _engine2 === 'sqlserver' ? MSSQL : PostgreSQL,
          }),
          editorAppearance(_dark2),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            'aria-label': 'Generated SQL',
            tabindex: '0',
          }),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': {
              height: 'auto',
            },
            '.cm-content': {
              padding: '6px 0',
            },
            '.cm-line': {
              padding: '0',
            },
          }),
        ],
      }),
    });
    return () => view.destroy();
  },
);
</script>

<template>
  <div ref="host"></div>
</template>
