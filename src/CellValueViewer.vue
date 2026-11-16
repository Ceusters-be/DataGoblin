<script setup lang="ts">
import { shallowRef, computed } from 'vue';
import { stateSetter, watchMounted } from './vueLifecycle';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import {
  foldGutter,
  foldKeymap,
  foldAll,
  unfoldAll,
} from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { Copy, Search, X } from '@lucide/vue';
import { editorAppearance } from './editorAppearance';
import { useTheme } from './theme';
import { formatCellJson } from './cellValue';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  value: string | null;
  column: string;
  row: number;
  onClose: () => void;
}>();
const value = computed(() => _props.value);
const column = computed(() => _props.column);
const row = computed(() => _props.row);
const onClose = computed(() => _props.onClose);
const _store = useTheme();
const dark = computed(() => _store.dark);
const formatted = computed(() => {
  const _value = value.value;
  return _value === null ? null : formatCellJson(_value);
});
const raw = shallowRef(false);
const setRaw = stateSetter(raw);
const message = shallowRef('');
const setMessage = stateSetter(message);
const host = shallowRef<HTMLDivElement | null>(null);
const close = shallowRef<HTMLButtonElement | null>(null);
const view = shallowRef<EditorView | null | null>(null);
const text = computed(() => {
  const _value2 = value.value;
  const _raw = raw.value;
  const _formatted = formatted.value;
  return _value2 === null
    ? ''
    : !_raw && _formatted !== null
      ? _formatted
      : _value2;
});
watchMounted(
  () => [],
  () => {
    close.value?.focus();
  },
);
watchMounted(
  () => {
    const _text = text.value;
    const _formatted2 = formatted.value;
    const _value3 = value.value;
    const _dark = dark.value;
    return [_text, _formatted2, _value3, _dark];
  },
  () => {
    const _value4 = value.value;
    const _text2 = text.value;
    const _formatted3 = formatted.value;
    const _dark2 = dark.value;
    if (!host.value || _value4 === null || _value4 === '') return;
    const editor = new EditorView({
      parent: host.value,
      state: EditorState.create({
        doc: _text2,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            'aria-label': 'Cell value',
            tabindex: '0',
          }),
          lineNumbers(),
          EditorView.lineWrapping,
          ...(_formatted3 !== null ? [json(), foldGutter()] : []),
          search({
            top: true,
          }),
          keymap.of([...searchKeymap, ...foldKeymap]),
          editorAppearance(_dark2),
        ],
      }),
    });
    view.value = editor;
    return () => {
      view.value = null;
      editor.destroy();
    };
  },
);
async function copy() {
  const _value5 = value.value;
  try {
    await navigator.clipboard.writeText(_value5 ?? 'NULL');
    setMessage('Original value copied.');
  } catch {
    setMessage(
      'Could not access the clipboard. Select the text to copy it manually.',
    );
  }
}
</script>

<template>
  <aside
    class="cell-value-viewer"
    role="dialog"
    aria-label="Cell value viewer"
    @keydown="
      (event) => {
        const _onClose = onClose!;
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          _onClose();
        }
      }
    "
  >
    <header>
      <div>
        <strong>{{ column }}</strong>
        <small>
          Row {{ row }} ·
          {{
            value === null
              ? 'SQL NULL'
              : value === ''
                ? 'Empty string'
                : formatted !== null
                  ? 'JSON'
                  : 'Text'
          }}
        </small>
      </div>
      <button
        ref="close"
        aria-label="Close value viewer"
        title="Close (Escape)"
        @click="onClose"
      >
        <X :size="17"></X>
      </button>
    </header>
    <div class="cell-value-actions">
      <button @click="() => void copy()">
        <Copy :size="13"></Copy>
        Copy value
      </button>
      <button
        :disabled="!value"
        @click="
          () => {
            if (view) openSearchPanel(view);
          }
        "
      >
        <Search :size="13"></Search>
        Search
      </button>
      <template v-if="formatted !== null">
        <button
          :aria-pressed="raw"
          @click="
            () => {
              const _raw2 = raw!;
              return setRaw(!_raw2);
            }
          "
        >
          {{ raw ? 'Format JSON' : 'Raw text' }}
        </button>
        <button
          :disabled="raw"
          @click="
            () => {
              if (view) foldAll(view);
            }
          "
        >
          Collapse all
        </button>
        <button
          :disabled="raw"
          @click="
            () => {
              if (view) unfoldAll(view);
            }
          "
        >
          Expand all
        </button>
      </template>
    </div>
    <template v-if="value === null">
      <p class="cell-value-empty">NULL — no value</p>
    </template>
    <template v-if="value === ''">
      <p class="cell-value-empty">Empty string — 0 characters</p>
    </template>
    <div class="cell-value-content" ref="host"></div>
    <div class="cell-value-status" role="status">
      {{ message || 'Read-only · Copy value copies the original text' }}
    </div>
  </aside>
</template>
