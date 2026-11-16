<script setup lang="ts">
import { type ColumnFilter } from './resultFilters';
import { shallowRef, computed, Teleport } from 'vue';
import { stateSetter, watchMounted, cssPixels } from './vueLifecycle';
import Select from './Select.vue';
import { compareValues, type FilterOperator } from './resultFilters';
import type { ValueChoices } from './types';
import { Search } from '@lucide/vue';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  onViewSql?: () => void;
  scope?: 'local' | 'database';
  onScopeChange?: (scope: 'local' | 'database') => void;
  databaseDisabled?: boolean;
  loadChoices?: (search: string) => Promise<ValueChoices>;
  name: string;
  initial?: ColumnFilter;
  values: (string | null)[];
  anchor: HTMLButtonElement;
  onApply: (filter: ColumnFilter) => void;
  onSelect: (values: (string | null)[]) => void;
  onClear: () => void;
  onClose: () => void;
}>();
const name = computed(() => _props.name);
const initial = computed(() => _props.initial);
const values = computed(() => _props.values);
const anchor = computed(() => _props.anchor);
const onApply = computed(() => _props.onApply);
const onSelect = computed(() => _props.onSelect);
const onClear = computed(() => _props.onClear);
const onClose = computed(() => _props.onClose);
const loadChoices = computed(() => _props.loadChoices);
const scope = computed(() =>
  _props.scope === undefined ? 'local' : _props.scope,
);
const onScopeChange = computed(() => _props.onScopeChange);
const databaseDisabled = computed(() => _props.databaseDisabled);
const onViewSql = computed(() => _props.onViewSql);
const operator = shallowRef<FilterOperator>(
  initial.value?.operator === 'in'
    ? 'contains'
    : (initial.value?.operator ?? 'contains'),
);
const setOperator = stateSetter(operator);
const value = shallowRef(initial.value?.value ?? '');
const setValue = stateSetter(value);
const search = shallowRef('');
const setSearch = stateSetter(search);
const scrollTop = shallowRef(0);
const setScrollTop = stateSetter(scrollTop);
const list = shallowRef<HTMLDivElement | null>(null);
const allCheck = shallowRef<HTMLInputElement | null>(null);
const initialSelected = computed(() => {
  const _initial = initial.value;
  return new Set(_initial?.operator === 'in' ? _initial.values : []);
});
const draft = shallowRef(initialSelected.value);
const setDraft = stateSetter(draft);
const selected = computed(() => {
  const _loadChoices = loadChoices.value;
  const _draft = draft.value;
  const _initialSelected = initialSelected.value;
  return _loadChoices ? _draft : _initialSelected;
});
const remote = shallowRef<ValueChoices>({
  values: [],
  hasMore: false,
});
const setRemote = stateSetter(remote);
const loading = shallowRef(false);
const setLoading = stateSetter(loading);
const error = shallowRef('');
const setError = stateSetter(error);
watchMounted(
  () => {
    const _loadChoices2 = loadChoices.value;
    const _search = search.value;
    return [_loadChoices2, _search];
  },
  () => {
    const _loadChoices3 = loadChoices.value;
    const _search2 = search.value;
    if (!_loadChoices3) return;
    let active = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void _loadChoices3(_search2)
        .then((result) => {
          if (active) setRemote(result);
        })
        .catch((error) => {
          if (active) {
            setError(String(error));
            setRemote({
              values: [],
              hasMore: false,
            });
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  },
);
function select(values: (string | null)[]) {
  const _loadChoices4 = loadChoices.value;
  const _onSelect = onSelect.value;
  if (_loadChoices4) setDraft(new Set(values));
  else _onSelect(values);
}
const choices = computed(() => {
  const _loadChoices5 = loadChoices.value;
  const _remote = remote.value;
  const _values = values.value;
  const _selected = selected.value;
  const _search3 = search.value;
  const counts = new Map<string | null, number>();
  if (_loadChoices5) {
    for (const item of _remote.values) counts.set(item.value, item.count);
  } else
    for (const value of _values)
      counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of _selected) if (!counts.has(value)) counts.set(value, 0);
  return [...counts]
    .sort(([a], [b]) => compareValues(a, b))
    .filter(([value]) =>
      (value === null ? 'NULL' : value === '' ? '(empty string)' : value)
        .toLocaleLowerCase()
        .includes(_search3.toLocaleLowerCase()),
    );
});
const allSelected = computed(() => {
  const _choices = choices.value;
  const _selected2 = selected.value;
  return (
    _choices.length > 0 && _choices.every(([value]) => _selected2.has(value))
  );
});
watchMounted(
  () => {
    const _choices2 = choices.value;
    const _allSelected = allSelected.value;
    const _selected3 = selected.value;
    return [_choices2, _allSelected, _selected3];
  },
  () => {
    const _allSelected2 = allSelected.value;
    const _choices3 = choices.value;
    const _selected4 = selected.value;
    if (allCheck.value)
      allCheck.value.indeterminate =
        !_allSelected2 && _choices3.some(([value]) => _selected4.has(value));
  },
);
watchMounted(
  () => {
    const _search4 = search.value;
    return [_search4];
  },
  () => {
    setScrollTop(0);
    if (list.value) list.value.scrollTop = 0;
  },
);
const start = computed(() => {
  const _choices4 = choices.value;
  const _scrollTop = scrollTop.value;
  return Math.max(
    0,
    Math.min(_choices4.length - 1, Math.floor(_scrollTop / 28) - 4),
  );
});
const end = computed(() => {
  const _choices5 = choices.value;
  const _start = start.value;
  return Math.min(_choices5.length, _start + 22);
});
function toggle(value: string | null) {
  const _selected5 = selected.value;
  const next = new Set(_selected5);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  select([...next]);
}
const menu = shallowRef<HTMLFormElement | null>(null);
const position = shallowRef({
  left: 8,
  top: 8,
  maxHeight: Math.max(0, window.innerHeight - 16),
});
const setPosition = stateSetter(position);
function positionMenu() {
  const _anchor = anchor.value;
  const element = menu.value;
  if (!element) return;
  const anchorRect = _anchor.getBoundingClientRect();
  const maxHeight = Math.max(0, window.innerHeight - 16);
  const height = Math.min(element.getBoundingClientRect().height, maxHeight);
  const width = Math.min(
    element.getBoundingClientRect().width || 360,
    Math.max(0, window.innerWidth - 16),
  );
  const next = {
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8)),
    top: Math.max(
      8,
      Math.min(anchorRect.bottom + 6, window.innerHeight - height - 8),
    ),
    maxHeight,
  };
  setPosition((current) =>
    current.left === next.left &&
    current.top === next.top &&
    current.maxHeight === next.maxHeight
      ? current
      : next,
  );
}
watchMounted(
  () => {
    const _anchor2 = anchor.value;
    return [_anchor2];
  },
  () => {
    positionMenu();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(positionMenu);
    if (menu.value) observer?.observe(menu.value);
    window.addEventListener('resize', positionMenu);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', positionMenu);
    };
  },
);
watchMounted(() => {
  const _operator = operator.value;
  const _choices6 = choices.value;
  return [_operator, _choices6.length];
}, positionMenu);
watchMounted(
  () => {
    const _anchor3 = anchor.value;
    const _onClose = onClose.value;
    return [_anchor3, _onClose];
  },
  () => {
    const _anchor4 = anchor.value;
    const _onClose2 = onClose.value;
    const outside = (event: PointerEvent) => {
      if (
        !menu.value?.contains(event.target as Node) &&
        !_anchor4.contains(event.target as Node)
      )
        _onClose2();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        _onClose2();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  },
);
</script>

<template>
  <Teleport to="body">
    <form
      class="column-filter-menu value-filter-menu"
      ref="menu"
      role="dialog"
      :aria-label="'Filter ' + name"
      :style="cssPixels(position)"
      @submit="
        (event) => {
          const _onApply = onApply!;
          const _operator2 = operator!;
          const _value = value!;
          event.preventDefault();
          if (menu?.querySelector('details')?.open)
            _onApply({
              operator: _operator2,
              value: _value,
            });
        }
      "
    >
      <template v-if="onScopeChange">
        <div class="filter-scope" role="group" aria-label="Filter scope">
          <button
            type="button"
            :aria-pressed="scope === 'local'"
            @click="
              () => {
                const _onScopeChange = onScopeChange!;
                return _onScopeChange('local');
              }
            "
          >
            Local
          </button>
          <button
            type="button"
            :disabled="databaseDisabled"
            :aria-pressed="scope === 'database'"
            @click="
              () => {
                const _onScopeChange = onScopeChange!;
                return _onScopeChange('database');
              }
            "
          >
            Database
          </button>
        </div>
      </template>
      <template v-if="scope === 'database' && onViewSql">
        <button type="button" @click="onViewSql">View SQL</button>
      </template>
      <strong>
        {{ loadChoices ? 'Database' : 'Local' }} Filter For '{{ name }}'
      </strong>
      <template v-if="loading">
        <small role="status">Loading values…</small>
      </template>
      <template v-if="error">
        <small role="alert">{{ error }}</small>
      </template>
      <template v-if="loadChoices && remote.hasMore">
        <small>First 100 values · refine your search for more</small>
      </template>
      <div class="value-filter-search">
        <Search :size="14"></Search>
        <input
          autofocus
          @keydown="
            (event) => {
              if (event.key === 'Enter') event.preventDefault();
            }
          "
          aria-label="Search filter values"
          :value="search"
          @input="
            (event) => setSearch((event.target as HTMLInputElement).value)
          "
        />
      </div>
      <div class="value-filter-head">
        <label>
          <input
            ref="allCheck"
            type="checkbox"
            aria-label="Select all matching values"
            :disabled="!choices.length"
            :checked="allSelected"
            @input="
              () => {
                const _selected6 = selected!;
                const _choices7 = choices!;
                const _allSelected3 = allSelected!;
                const next = new Set(_selected6);
                for (const [value] of _choices7) {
                  if (_allSelected3) next.delete(value);
                  else next.add(value);
                }
                select([...next]);
              }
            "
          />
          Value
        </label>
        <span>Count</span>
      </div>
      <div
        class="value-filter-list"
        ref="list"
        @scroll="
          (event) =>
            setScrollTop((event.currentTarget as HTMLInputElement).scrollTop)
        "
      >
        <template v-if="start > 0">
          <div
            aria-hidden="true"
            :style="
              cssPixels({
                height: start * 28,
              })
            "
          ></div>
        </template>
        <template
          v-for="[value, count] in choices.slice(start, end)"
          :key="value === null ? 'null' : 'text:' + value"
        >
          <label
            class="value-filter-row"
            :title="
              value === null
                ? 'NULL (no value)'
                : value === ''
                  ? 'Empty string'
                  : value
            "
          >
            <input
              type="checkbox"
              :aria-label="
                value === null
                  ? 'Select NULL (no value)'
                  : value === ''
                    ? 'Select empty string'
                    : 'Select value ' + value
              "
              :checked="selected.has(value)"
              @input="() => toggle(value)"
            />
            <span :class="value === null ? 'filter-null-value' : ''">
              {{
                value === null
                  ? 'NULL'
                  : value === ''
                    ? '(empty string)'
                    : value
              }}
            </span>
            <span class="value-filter-count">{{ count.toLocaleString() }}</span>
          </label>
        </template>
        <template v-if="end < choices.length">
          <div
            aria-hidden="true"
            :style="
              cssPixels({
                height: (choices.length - end) * 28,
              })
            "
          ></div>
        </template>
        <template v-if="!choices.length">
          <div class="value-filter-empty">No matching values</div>
        </template>
      </div>
      <div class="value-filter-footer">
        <small>
          {{
            loadChoices
              ? `${selected.size} selected · database rows`
              : selected.size
                ? `${selected.size} selected · loaded rows only`
                : 'Select a checkbox to filter loaded rows'
          }}
        </small>
        <button
          type="button"
          aria-label="Clear selected values"
          @click="() => select([])"
        >
          Clear
        </button>
      </div>
      <template v-if="loadChoices">
        <button
          type="button"
          class="primary-button"
          :disabled="loading || !!error"
          @click="
            () => {
              const _onSelect2 = onSelect!;
              const _selected6 = selected!;
              const _onClose3 = onClose!;
              _onSelect2([..._selected6]);
              _onClose3();
            }
          "
        >
          Apply selection
        </button>
      </template>
      <details class="advanced-column-filter" @toggle="positionMenu">
        <summary>Advanced condition</summary>
        <label>
          Condition
          <Select
            label="Filter condition"
            :value="operator"
            @change="(value) => setOperator(value as FilterOperator)"
            :options="
              Object.entries({
                contains: 'Contains',
                equals: 'Equals',
                notEquals: 'Does not equal',
                startsWith: 'Starts with',
                endsWith: 'Ends with',
                greater: 'Greater than',
                less: 'Less than',
                isNull: 'Is NULL',
                notNull: 'Is not NULL',
                isEmpty: 'Is empty string',
              }).map(([value, label]) => ({
                value,
                label,
              }))
            "
          ></Select>
        </label>
        <template v-if="!['isNull', 'notNull', 'isEmpty'].includes(operator)">
          <label>
            Value
            <input
              aria-label="Filter value"
              :value="value"
              @input="
                (event) => setValue((event.target as HTMLInputElement).value)
              "
            />
          </label>
        </template>
        <small>
          {{
            loadChoices
              ? 'Filters the database. Comparisons use database types and collation.'
              : 'Filters loaded rows on this page. Text matching ignores case.'
          }}
        </small>
        <div>
          <button class="secondary-button" type="button" @click="onClear">
            Clear
          </button>
          <button class="primary-button" type="submit">Apply</button>
        </div>
      </details>
    </form>
  </Teleport>
</template>
