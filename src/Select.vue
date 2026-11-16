<script setup lang="ts">
import { Option } from './Select';
import { shallowRef, computed, useId, Teleport } from 'vue';
import { stateSetter, watchMounted, cssPixels } from './vueLifecycle';
import { Check, ChevronDown, Search } from '@lucide/vue';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  id?: string;
  label: string;
  title?: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
}>();
const id = computed(() => _props.id);
const label = computed(() => _props.label);
const title = computed(() => _props.title);
const value = computed(() => _props.value);
const options = computed(() => _props.options);
const onChange = computed(() => _props.onChange);
const disabled = computed(() =>
  _props.disabled === undefined ? false : _props.disabled,
);
const searchable = computed(() =>
  _props.searchable === undefined ? false : _props.searchable,
);
const listId = useId();
const trigger = shallowRef<HTMLButtonElement | null>(null);
const popup = shallowRef<HTMLDivElement | null>(null);
const list = shallowRef<HTMLDivElement | null>(null);
const searchInput = shallowRef<HTMLInputElement | null>(null);
const open = shallowRef(false);
const setOpen = stateSetter(open);
const search = shallowRef('');
const setSearch = stateSetter(search);
const active = shallowRef(0);
const setActive = stateSetter(active);
const position = shallowRef({
  left: 8,
  top: 8,
  width: 220,
  maxHeight: 320,
});
const setPosition = stateSetter(position);
const choices = computed(() => {
  const _options = options.value;
  const _search = search.value;
  return _options.filter((option) =>
    option.label
      .toLocaleLowerCase()
      .includes(_search.trim().toLocaleLowerCase()),
  );
});
function close(restore = true) {
  setOpen(false);
  if (restore) trigger.value?.focus();
}
function show() {
  const _disabled = disabled.value;
  const _options2 = options.value;
  const _value = value.value;
  if (_disabled) return;
  setSearch('');
  setActive(
    Math.max(
      0,
      _options2.findIndex((option) => option.value === _value),
    ),
  );
  setOpen(true);
}
function choose(option: Option) {
  const _onChange = onChange.value;
  _onChange(option.value);
  close();
}
watchMounted(
  () => {
    const _disabled2 = disabled.value;
    return [_disabled2];
  },
  () => {
    const _disabled3 = disabled.value;
    if (_disabled3) setOpen(false);
  },
);
watchMounted(
  () => {
    const _open = open.value;
    const _searchable = searchable.value;
    return [_open, _searchable];
  },
  () => {
    const _open2 = open.value;
    const _searchable2 = searchable.value;
    if (!_open2) return;
    function place() {
      const rect = trigger.value!.getBoundingClientRect();
      const width = Math.min(
        Math.max(rect.width, _searchable2 ? 260 : 200),
        window.innerWidth - 16,
      );
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upward = below < 240 && above > below;
      const maxHeight = Math.max(60, Math.min(320, upward ? above : below));
      const height = Math.min(
        popup.value?.getBoundingClientRect().height || maxHeight,
        maxHeight,
      );
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: upward ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
        width,
        maxHeight,
      });
    }
    place();
    (_searchable2 ? searchInput.value : list.value)?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !popup.value?.contains(event.target as Node) &&
        !trigger.value?.contains(event.target as Node)
      )
        close(false);
    };
    const scroll = (event: Event) => {
      if (!popup.value?.contains(event.target as Node)) place();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (popup.value) observer?.observe(popup.value);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
      observer?.disconnect();
    };
  },
);
watchMounted(
  () => {
    const _active = active.value;
    const _open3 = open.value;
    return [_active, _open3, listId];
  },
  () => {
    const _open4 = open.value;
    const _active2 = active.value;
    if (_open4)
      document.getElementById(`${listId}-${_active2}`)?.scrollIntoView?.({
        block: 'nearest',
      });
  },
);
function keys(event: KeyboardEvent) {
  const _choices = choices.value;
  const _searchable3 = searchable.value;
  const _active3 = active.value;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
  } else if (event.key === 'Tab') {
    close();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    setActive((index) =>
      Math.max(
        0,
        Math.min(
          _choices.length - 1,
          index + (event.key === 'ArrowDown' ? 1 : -1),
        ),
      ),
    );
  } else if (event.key === 'Enter' || (!_searchable3 && event.key === ' ')) {
    event.preventDefault();
    if (_choices[_active3]) choose(_choices[_active3]);
  } else if (!_searchable3 && (event.key === 'Home' || event.key === 'End')) {
    event.preventDefault();
    setActive(event.key === 'Home' ? 0 : Math.max(0, _choices.length - 1));
  } else if (!_searchable3 && event.key.length === 1) {
    const index = _choices.findIndex((option) =>
      option.label.toLowerCase().startsWith(event.key.toLowerCase()),
    );
    if (index >= 0) setActive(index);
  }
}
</script>

<template>
  <button
    ref="trigger"
    :id="id"
    type="button"
    class="custom-select"
    role="combobox"
    :aria-label="label"
    :title="title"
    :value="value"
    :disabled="disabled"
    :aria-expanded="open"
    aria-haspopup="listbox"
    :aria-controls="open ? listId : undefined"
    @click="
      () => {
        const _open5 = open!;
        return _open5 ? close() : show();
      }
    "
    @keydown="
      (event) => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          show();
        }
      }
    "
  >
    <span>
      {{ options.find((option) => option.value === value)?.label ?? value }}
    </span>
    <ChevronDown :size="13"></ChevronDown>
  </button>
  <template v-if="open">
    <Teleport to="body">
      <div
        ref="popup"
        class="custom-select-popup"
        :style="cssPixels(position)"
        :tabindex="-1"
        @keydown="keys"
        @pointerdown="(event) => event.stopPropagation()"
      >
        <template v-if="searchable">
          <div class="custom-select-search">
            <Search :size="14"></Search>
            <input
              ref="searchInput"
              :aria-label="`Search ${label.toLowerCase()}`"
              role="combobox"
              aria-expanded="true"
              :aria-controls="listId"
              :aria-activedescendant="
                choices[active] ? `${listId}-${active}` : undefined
              "
              placeholder="Search…"
              :value="search"
              @input="
                (event) => {
                  setSearch((event.target as HTMLInputElement).value);
                  setActive(0);
                }
              "
            />
          </div>
        </template>
        <div
          ref="list"
          :tabindex="-1"
          class="custom-select-options"
          :id="listId"
          role="listbox"
          :aria-label="label"
          :aria-activedescendant="
            choices[active] ? `${listId}-${active}` : undefined
          "
        >
          <template v-for="(option, index) in choices" :key="option.value">
            <div
              role="option"
              :id="`${listId}-${index}`"
              :aria-selected="option.value === value"
              :class="index === active ? 'highlighted' : ''"
              @mousemove="() => setActive(index)"
              @mousedown="(event) => event.preventDefault()"
              @click="() => choose(option)"
            >
              <span>{{ option.label }}</span>
              <template v-if="option.value === value">
                <Check :size="14"></Check>
              </template>
            </div>
          </template>
          <template v-if="!choices.length">
            <div class="custom-select-empty">No matches</div>
          </template>
        </div>
      </div>
    </Teleport>
  </template>
</template>
