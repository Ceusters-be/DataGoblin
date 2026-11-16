<script setup lang="ts">
import { ForeignReference } from './types';
import { Engine } from './types';
import { ValueChoices } from './types';
import { TableBrowser } from './types';
import { ResultSet } from './types';
import { type MenuPosition } from './ContextMenu';
import { OutputEvent } from './QueryOutput';
import { shallowRef, computed, watchSyncEffect, watch, type CSSProperties } from 'vue';
import { stateSetter, watchMounted, afterRender, cssPixels } from './vueLifecycle';
import ResultToolbar from './ResultToolbar.vue';
import { useGridEditing } from './useGridEditing';
import ContextMenu from './ContextMenu.vue';
import { menuPosition } from './ContextMenu';
import { ArrowDown, ArrowUp, ChevronsUpDown, Copy, Filter, KeyRound, Link2, Columns2, LoaderCircle } from '@lucide/vue';
import ReferencePicker from './ReferencePicker.vue';
import CellValueViewer from './CellValueViewer.vue';
import SqlPreview from './SqlPreview.vue';
import ColumnFilterMenu from './ColumnFilterMenu.vue';
import { compareValues as compare, matchesFilter, type ColumnFilter } from './resultFilters';
import { GRID_ROW_HEIGHT, ROW_NUMBER_WIDTH } from './ResultsGrid';
import InlineCellEditor from './InlineCellEditor.vue';
import GridEditingDialogs from './GridEditingDialogs.vue';
defineOptions({
  inheritAttrs: false
});
const _props = defineProps<{
  onLog?: (event: OutputEvent) => void;
  logDatabase?: string;
  onCancel?: () => void;
  cancellable?: boolean;
  refreshInterval?: number;
  onRefreshInterval?: (seconds: number) => void;
  onEditDirty?: (dirty: boolean) => void;
  onEditBusy?: (busy: boolean) => void;
  onReload?: () => Promise<void>;
  cacheId?: string | null;
  onReference?: (reference: ForeignReference, column: string, rowIndex: number) => void;
  engine?: Engine;
  browser?: TableBrowser | null;
  onBrowse?: (filters: TableBrowser['filters'], sort: TableBrowser['sort']) => void;
  browserBusy?: boolean;
  loadValues?: (column: string, search: string) => Promise<ValueChoices>;
  data: ResultSet;
  rowOffset?: number;
  onExport: (rows: ResultSet['rows']) => Promise<void>;
}>();
const data = computed(() => _props.data);
const onExport = computed(() => _props.onExport);
const rowOffset = computed(() => _props.rowOffset === undefined ? 0 : _props.rowOffset);
const cacheId = computed(() => _props.cacheId);
const onReference = computed(() => _props.onReference);
const engine = computed(() => _props.engine === undefined ? 'postgres' : _props.engine);
const browser = computed(() => _props.browser);
const onBrowse = computed(() => _props.onBrowse);
const inputBusy = computed(() => _props.browserBusy);
const loadValues = computed(() => _props.loadValues);
const onEditDirty = computed(() => _props.onEditDirty);
const onReload = computed(() => _props.onReload);
const onCancel = computed(() => _props.onCancel);
const cancellable = computed(() => _props.cancellable);
const refreshInterval = computed(() => _props.refreshInterval);
const onRefreshInterval = computed(() => _props.onRefreshInterval);
const onLog = computed(() => _props.onLog);
const logDatabase = computed(() => _props.logDatabase);
const editing = useGridEditing({
  get cacheId() {
    const _cacheId = cacheId.value;
    return _cacheId;
  },
  get data() {
    const _data = data.value;
    return _data;
  },
  get rowOffset() {
    const _rowOffset = rowOffset.value;
    return _rowOffset;
  },
  get blocked() {
    const _inputBusy = inputBusy.value;
    return _inputBusy;
  },
  get enabled() {
    const _cacheId2 = cacheId.value;
    const _browser = browser.value;
    const _onReload = onReload.value;
    return !!_cacheId2 && (!!_browser || data.value.joinEditable === true) && !!_onReload;
  },
  get engine() {
    const _engine = engine.value;
    return _engine;
  },
  get onDirty() {
    const _onEditDirty = onEditDirty.value;
    return _onEditDirty;
  },
  get onReload() {
    const _onReload2 = onReload.value;
    return _onReload2;
  },
  get onMove() {
    return moveCell;
  },
  get onLog() {
    const _onLog = onLog.value;
    return _onLog;
  },
  get logDatabase() {
    const _logDatabase = logDatabase.value;
    return _logDatabase;
  }
});
watch(() => editing.busy, value => _props.onEditBusy?.(value), { immediate: true, flush: 'sync' });
defineExpose({
  discardEdits() {
    if (editing.busy) return false;
    if (editing.dirty) editing.revert();
    return true;
  },
});
const externalBusy = computed(() => {
  const _inputBusy2 = inputBusy.value;
  return _inputBusy2;
});
const browserBusy = computed(() => {
  const _inputBusy3 = inputBusy.value;
  return _inputBusy3 || editing.dirty;
});
type Cell = {
  row: number;
  column: number;
};
const anchor = shallowRef<Cell | null | null>(null);
const range = shallowRef<{
  start: Cell;
  end: Cell;
} | null>(null);
const setRange = stateSetter(range);
function selectCell(row: number, column: number, extend = false) {
  const cell = {
    row,
    column
  };
  if (extend && anchor.value) setRange({
    start: anchor.value,
    end: cell
  });else {
    anchor.value = cell;
    setRange(null);
  }
  setSelection(cell);
}
const pendingFocus = shallowRef<{
  row: number;
  column: number;
} | null | null>(null);
function moveCell(row: number, column: number, key: string, shift = false) {
  const _rows = rows.value;
  const _data2 = data.value;
  const _virtual = virtual.value;
  const _start = start.value;
  const _end = end.value;
  let r = _rows.findIndex(item => item.index === row),
    c = column;
  if (r < 0) return;
  if (key === 'Tab') {
    c += shift ? -1 : 1;
    if (c >= _data2.columns.length) {
      c = 0;
      r++;
    } else if (c < 0) {
      c = _data2.columns.length - 1;
      r--;
    }
  } else if (key === 'ArrowDown') r++;else if (key === 'ArrowUp') r--;else if (key === 'ArrowRight') c++;else if (key === 'ArrowLeft') c--;else if (key === 'Home') c = 0;else if (key === 'End') c = _data2.columns.length - 1;
  r = Math.max(0, Math.min(_rows.length - 1, r));
  c = Math.max(0, Math.min(_data2.columns.length - 1, c));
  const target = {
    row: _rows[r].index,
    column: c
  };
  pendingFocus.value = target;
  selectCell(target.row, target.column);
  if (_virtual && (r < _start || r >= _end) && scroll.value) {
    scroll.value.scrollTop = r * GRID_ROW_HEIGHT;
    setScrollTop(r * GRID_ROW_HEIGHT);
  }
}
afterRender(() => {
  const target = pendingFocus.value;
  if (!target) return;
  const node = scroll.value?.querySelector<HTMLElement>(`td[data-row="${target.row}"][data-column="${target.column}"]`);
  if (node) {
    pendingFocus.value = null;
    node.focus();
    node.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest'
    });
  }
});
const cellMenu = shallowRef<{
  position: MenuPosition;
  row: number;
  column: number;
  displayRow: number;
} | null>(null);
const setCellMenu = stateSetter(cellMenu);
watchMounted(() => {
  const _data3 = data.value;
  const _rowOffset2 = rowOffset.value;
  return [_data3, _rowOffset2];
}, () => {
  setCellMenu(null);
});
const localSort = shallowRef<{
  column: number;
  descending: boolean;
} | null>(null);
const setSort = stateSetter(localSort);
const localFilters = shallowRef<Record<number, ColumnFilter>>({});
const setLocalFilters = stateSetter(localFilters);
const filterScope = shallowRef<'local' | 'database'>('local');
const setFilterScope = stateSetter(filterScope);
const databaseFilters = computed(() => {
  const _browser2 = browser.value;
  const _data4 = data.value;
  return Object.fromEntries((_browser2?.filters ?? []).map(f => [_data4.columns.indexOf(f.column), f]));
});
const filters = computed(() => {
  const _filterScope = filterScope.value;
  const _browser3 = browser.value;
  const _databaseFilters = databaseFilters.value;
  const _localFilters = localFilters.value;
  return _filterScope === 'database' && _browser3 ? _databaseFilters : _localFilters;
});
const sort = computed(() => {
  const _browser4 = browser.value;
  const _data5 = data.value;
  const _localSort = localSort.value;
  return _browser4 ? _browser4.sort ? {
    column: _data5.columns.indexOf(_browser4.sort.column),
    descending: _browser4.sort.descending
  } : null : _localSort;
});
const referenceCell = shallowRef<{
  column: string;
  index: number;
} | null>(null);
const setReferenceCell = stateSetter(referenceCell);
const cellViewer = shallowRef<{
  value: string | null;
  column: string;
  row: number;
} | null>(null);
const setCellViewer = stateSetter(cellViewer);
const viewerOrigin = shallowRef<HTMLElement | null | null>(null);
function closeCellViewer() {
  setCellViewer(null);
  if (viewerOrigin.value?.isConnected) viewerOrigin.value.focus();
}
function openCellViewer(value: string | null, column: number, row: number, origin: HTMLElement) {
  const _data6 = data.value;
  viewerOrigin.value = origin;
  setCellViewer({
    value,
    column: _data6.columns[column],
    row
  });
}
const inspect = shallowRef(false);
const setInspect = stateSetter(inspect);
function setFilters(update: Record<number, ColumnFilter> | ((current: Record<number, ColumnFilter>) => Record<number, ColumnFilter>)) {
  const _filterScope2 = filterScope.value;
  const _browserBusy = browserBusy.value;
  const _filters = filters.value;
  const _browser5 = browser.value;
  const _onBrowse = onBrowse.value;
  const _data7 = data.value;
  if (_filterScope2 === 'database' && _browserBusy) return;
  const next = typeof update === 'function' ? update(_filters) : update;
  if (_browser5 && _filterScope2 === 'database') _onBrowse?.(Object.entries(next).map(([column, f]) => ({
    ...f,
    column: _data7.columns[Number(column)]
  })), _browser5.sort);else setLocalFilters(next);
}
const filterColumn = shallowRef<number | null>(null);
const setFilterColumn = stateSetter(filterColumn);
const loadChoices = (search: string) => {
  const _loadValues = loadValues.value;
  const _data8 = data.value;
  const _filterColumn = filterColumn.value;
  return _loadValues!(_data8.columns[_filterColumn!], search);
};
const filterAnchor = shallowRef<HTMLButtonElement | null | null>(null);
const closeFilter = () => {
  setFilterColumn(null);
  filterAnchor.value?.focus();
};
const widths = shallowRef<Record<number, number>>({});
const setWidths = stateSetter(widths);
const selection = shallowRef<{
  row: number;
  column: number | null;
} | null>(null);
const setSelection = stateSetter(selection);
const message = shallowRef('');
const setMessage = stateSetter(message);
const scrollTop = shallowRef(0);
const setScrollTop = stateSetter(scrollTop);
const viewportHeight = shallowRef(600);
const setViewportHeight = stateSetter(viewportHeight);
const scroll = shallowRef<HTMLDivElement | null>(null);
watchMounted(() => {
  const _data9 = data.value;
  return [_data9.rows];
}, () => {
  setReferenceCell(null);
  setCellViewer(null);
  setSelection(null);
  setRange(null);
  anchor.value = null;
  setSort(null);
  setMessage('');
  setScrollTop(0);
  if (scroll.value) scroll.value.scrollTop = 0;
});
watchMounted(() => [], () => {
  const element = scroll.value;
  if (!element || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
  observer.observe(element);
  return () => observer.disconnect();
});
const drag = shallowRef<{
  column: number;
  x: number;
  width: number;
} | null | null>(null);
const predicates = computed(() => {
  const _localFilters2 = localFilters.value;
  return Object.entries(_localFilters2).map(([column, filter]) => {
    const selected = filter.operator === 'in' ? new Set(filter.values) : null;
    return {
      column: Number(column),
      test: (value: string | null) => selected ? selected.has(value) : matchesFilter(value, filter)
    };
  });
});
const rows = computed(() => {
  const _data0 = data.value;
  const _predicates = predicates.value;
  const _sort = sort.value;
  const _browser6 = browser.value;
  const values = _data0.rows.map((original, index) => ({
    values: editing.changes.length ? original.map((value, column) => {
      const change = editing.changeAt(index, column);
      return change ? change.value : value;
    }) : original,
    index
  })).filter(row => _predicates.every(({
    column,
    test
  }) => test(row.values[column])));
  if (_sort && !_browser6) values.sort((a, b) => {
    const av = a.values[_sort.column],
      bv = b.values[_sort.column];
    // NULL stays last in either direction; ties retain database order.
    const order = av === null || bv === null ? compare(av, bv) : compare(av, bv) * (_sort.descending ? -1 : 1);
    return order || a.index - b.index;
  });
  return [...values, ...editing.added.map(index => ({
    index,
    values: _data0.columns.map((_, column) => editing.changeAt(index, column)?.value ?? null)
  }))];
});
watchMounted(() => {
  const _filters2 = filters.value;
  return [_filters2];
}, () => {
  setSelection(null);
  setRange(null);
  anchor.value = null;
});
watchMounted(() => {
  const _sort2 = sort.value;
  return [_sort2];
}, () => {
  setRange(null);
  anchor.value = null;
});
watchMounted(() => {
  const _filters3 = filters.value;
  const _sort3 = sort.value;
  return [_filters3, _sort3];
}, () => {
  setScrollTop(0);
  if (scroll.value) scroll.value.scrollTop = 0;
});
const filterValues = computed(() => {
  const _filterColumn2 = filterColumn.value;
  const _data1 = data.value;
  const _predicates2 = predicates.value;
  return _filterColumn2 === null ? [] : _data1.rows.filter(row => _predicates2.every(({
    column,
    test
  }) => column === _filterColumn2 || test(row[column]))).map(row => row[_filterColumn2]);
});
const keys = computed(() => {
  const _data10 = data.value;
  return new Map(_data10.columnKeys?.map(key => [key.name, key]));
});
const filterCount = computed(() => {
  const _localFilters3 = localFilters.value;
  return Object.keys(_localFilters3).length;
});
const databaseFilterCount = computed(() => {
  const _databaseFilters2 = databaseFilters.value;
  return Object.keys(_databaseFilters2).length;
});
const cycleSort = (column: number) => {
  const _browserBusy2 = browserBusy.value;
  const _sort4 = sort.value;
  const _browser7 = browser.value;
  const _onBrowse2 = onBrowse.value;
  const _data11 = data.value;
  if (_browserBusy2) return;
  const next = _sort4?.column !== column ? {
    column,
    descending: false
  } : !_sort4.descending ? {
    column,
    descending: true
  } : null;
  if (_browser7) _onBrowse2?.(_browser7.filters, next ? {
    ...next,
    column: _data11.columns[next.column]
  } : null);else setSort(next);
};
const virtual = computed(() => {
  const _rows2 = rows.value;
  return _rows2.length > 100;
});
const start = computed(() => {
  const _virtual2 = virtual.value;
  const _rows3 = rows.value;
  const _scrollTop = scrollTop.value;
  return _virtual2 ? Math.max(0, Math.min(_rows3.length - 1, Math.floor(_scrollTop / GRID_ROW_HEIGHT) - 10)) : 0;
});
const end = computed(() => {
  const _virtual3 = virtual.value;
  const _rows4 = rows.value;
  const _start2 = start.value;
  const _viewportHeight = viewportHeight.value;
  return _virtual3 ? Math.min(_rows4.length, _start2 + Math.ceil(_viewportHeight / GRID_ROW_HEIGHT) + 22) : _rows4.length;
});
const defaultWidths = computed(() => {
  const _data12 = data.value;
  return _data12.columns.map((name, column) => Math.min(320, Math.max(110, name.length * 8 + 68, ..._data12.rows.slice(0, 50).map(row => Math.min(40, (row[column] ?? 'NULL').length) * 8 + 22))));
});
const width = (column: number) => {
  const _widths = widths.value;
  const _defaultWidths = defaultWidths.value;
  return _widths[column] ?? _defaultWidths[column];
};
const selectedCells = computed(() => {
  const _range = range.value;
  const _selection = selection.value;
  const _rows5 = rows.value;
  if (!_range) return _selection?.column != null ? [{
    row: _selection.row,
    column: _selection.column
  }] : [];
  const first = _rows5.findIndex(r => r.index === _range.start.row),
    last = _rows5.findIndex(r => r.index === _range.end.row);
  if (first < 0 || last < 0) return [];
  const cells: Cell[] = [];
  for (let r = Math.min(first, last); r <= Math.max(first, last); r++) {
    for (let c = Math.min(_range.start.column, _range.end.column); c <= Math.max(_range.start.column, _range.end.column); c++) cells.push({
      row: _rows5[r].index,
      column: c
    });
  }
  return cells;
});
const selectedSet = computed(() => {
  const _selectedCells = selectedCells.value;
  return new Set(_selectedCells.map(c => `${c.row}:${c.column}`));
});
const pasteRows = shallowRef(data.value.rows);
watchSyncEffect(() => {
  const _data13 = data.value;
  return pasteRows.value = _data13.rows;
});
async function pasteClipboard() {
  const _data14 = data.value;
  const _selectedCells2 = selectedCells.value;
  const originalRows = _data14.rows;
  const target = _selectedCells2;
  try {
    const text = await navigator.clipboard.readText();
    if (pasteRows.value !== originalRows) {
      setMessage('The displayed page changed. Paste again into the current selection.');
      return;
    }
    setMessage(editing.paste(target, text));
  } catch {
    setMessage('Clipboard access failed. Use Ctrl/Cmd+V on the selected cells.');
  }
}
async function copy(rowOnly = false, target = selection.value) {
  const _data15 = data.value;
  const selection = target;
  if (!selection) return;
  const row = (_data15.rows[selection.row] ?? _data15.columns.map(() => null)).map((value, column) => {
    const change = editing.changeAt(selection.row, column);
    return change ? change.value : value;
  });
  const value = !rowOnly && selection.column !== null ? row[selection.column] ?? 'NULL' : row.map(value => {
    const text = value ?? 'NULL';
    return /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }).join('\t');
  try {
    await navigator.clipboard.writeText(value);
    setMessage('');
  } catch {
    setMessage('Could not access the clipboard. Try selecting and copying the text manually.');
  }
}
const window = globalThis.window;
</script>

<template>
<div class="results-grid-container" :style="cssPixels({
  '--grid-row-height': `${GRID_ROW_HEIGHT}px`
} as CSSProperties)" @keydown.capture="event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !event.isComposing && event.key.toLowerCase() === 'a') {
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable], [role=textbox], [role=dialog]')) return;
    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    if (rows.length && data.columns.length) {
      const first = { row: rows[0].index, column: 0 };
      anchor = first;
      setSelection(first);
      setRange({ start: first, end: { row: rows[rows.length - 1].index, column: data.columns.length - 1 } });
    }
    return;
  }
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
  if ((event.target as HTMLElement).closest('[role=\u0022dialog\u0022]')) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) editing.requestApply();
}"><ResultToolbar :dirty="editing.dirty" :count="editing.pendingCount" :busy="!!externalBusy || editing.busy" :submitted="editing.submitted" :canAdd="editing.canAdd" :canDelete="editing.canAdd && (!!selectedCells.length || !!selection)" @refresh="onReload" @cancel="onCancel" :cancellable="cancellable" :interval="refreshInterval" @interval="onRefreshInterval" :onAdd="(_rows6 => () => {
  const row = editing.addRow();
  if (row !== undefined) {
    selectCell(row, 0);
    pendingFocus = {
      row,
      column: 0
    };
    if (scroll) {
      scroll.scrollTop = (_rows6.length + 1) * GRID_ROW_HEIGHT;
      setScrollTop((_rows6.length + 1) * GRID_ROW_HEIGHT);
    }
  }
})(rows!)" :onDelete="((_selectedCells3, _selection3) => () => {
  return editing.deleteRows(_selectedCells3.length ? _selectedCells3.map(c => c.row) : _selection3 ? [_selection3.row] : []);
})(selectedCells!, selection!)" @revert="editing.revert" @preview="editing.inspect" @submit="editing.requestApply" :onExport="((_onExport, _rows6) => () => {
  return void _onExport(_rows6.map(row => row.values));
})(onExport!, rows!)"></ResultToolbar><span class="sr-only">{{ editing.hint }}</span><span v-if="data.editReason && cacheId" class="key-metadata-note" :title="data.editReason">Read-only result</span><GridEditingDialogs :editing="editing" /><template v-if="inspect && browser"><div class="generated-sql"><SqlPreview :value="browser.sql" :engine="engine"></SqlPreview><pre>{{ browser.parameters.map((value, i) => `${i + 1}: ${JSON.stringify(value)}`).join('\n') }}</pre><button @click="() => setInspect(false)">Close SQL</button></div></template><template v-if="message"><div class="grid-feedback" role="status">{{ message }}</div></template><template v-if="filterCount > 0"><div class="grid-filter-status"><span>{{ rows.length }} of {{ data.rows.length }} loaded rows match · {{ filterCount }} column {{ filterCount === 1 ? 'filter' : 'filters' }}</span><button @click="() => setLocalFilters({})">Clear filters</button></div></template><template v-if="databaseFilterCount > 0"><div class="grid-filter-status"><span>{{ databaseFilterCount }} database {{ databaseFilterCount === 1 ? 'filter' : 'filters' }} active</span><button :disabled="browserBusy" @click="() => {
  const _onBrowse3 = onBrowse!;
  const _browser8 = browser!;
  return _onBrowse3?.([], _browser8!.sort);
}">Clear database filters</button></div></template><template v-if="data.keyMetadataError"><span class="key-metadata-note" :title="data.keyMetadataError">Key metadata unavailable</span></template><template v-if="filterColumn !== null && filterAnchor"><ColumnFilterMenu :onViewSql="(_browser8 => _browser8 ? () => {
  setInspect(true);
  closeFilter();
} : undefined)(browser)" :scope="filterScope" :onScopeChange="((_browser8, _loadValues2) => _browser8 && _loadValues2 ? setFilterScope : undefined)(browser, loadValues)" :databaseDisabled="browserBusy" :loadChoices="filterScope === 'database' && browser && loadValues ? loadChoices : undefined" :key="filterColumn + ':' + filterScope" :name="data.columns[filterColumn]" :initial="filters[filterColumn]" :values="filterValues" :onSelect="(_filterColumn3 => values => {
  return setFilters(current => {
    const next = {
      ...current
    };
    if (values.length) next[_filterColumn3] = {
      operator: 'in',
      value: '',
      values
    };else delete next[_filterColumn3];
    return next;
  });
})(filterColumn!)" :anchor="filterAnchor" @close="closeFilter" :onApply="(_filterColumn3 => filter => {
  setFilters(current => ({
    ...current,
    [_filterColumn3]: filter
  }));
  closeFilter();
})(filterColumn!)" :onClear="(_filterColumn3 => () => {
  setFilters(current => {
    const next = {
      ...current
    };
    delete next[_filterColumn3];
    return next;
  });
  closeFilter();
})(filterColumn!)"></ColumnFilterMenu></template><div class="grid-viewport" :aria-busy="!!externalBusy"><div class="grid-scroll" @paste="event => {
  const _selectedCells3 = selectedCells!;
  if ((event.target as HTMLElement).closest('input, textarea, [contenteditable=\u0022true\u0022]')) return;
  event.preventDefault();
  setMessage(editing.paste(_selectedCells3, event.clipboardData!.getData('text/plain')));
}" ref="scroll" @scroll="event => {
  const _virtual4 = virtual!;
  if (_virtual4) setScrollTop((event.currentTarget as HTMLInputElement).scrollTop);
}" @keydown="event => {
  if ((event.target as HTMLElement).closest('input, textarea, [contenteditable=\u0022true\u0022]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
    event.preventDefault();
    void copy();
  }
}"><table class="result-grid interactive-grid" :style="(_data16 => cssPixels({
  width: ROW_NUMBER_WIDTH + _data16.columns.reduce((total, _, column) => total + width(column), 0)
}))(data)"><colgroup><col :style="cssPixels({
  width: ROW_NUMBER_WIDTH
})"></col><template v-for="(_, column) in data.columns" :key="column"><col  :style="cssPixels({
  width: width(column)
})"></col></template></colgroup><thead><tr><th scope="col">#</th><template v-for="(name, column) in data.columns" :key="column"><th  scope="col" :aria-sort="sort?.column === column ? sort.descending ? 'descending' : 'ascending' : 'none'"><div class="result-column-heading"><span class="column-key-icons"><template v-if="keys.get(name)?.primaryKey"><span role="img" aria-label="Primary key" title="Primary key" class="primary-key"><KeyRound :size="13"></KeyRound></span></template><template v-if="keys.get(name)?.foreignKey"><span role="img" aria-label="Foreign key" title="Foreign key" class="foreign-key"><Link2 :size="13"></Link2></span></template><template v-if="!keys.get(name)?.primaryKey && !keys.get(name)?.foreignKey"><Columns2 :size="13" aria-hidden="true"></Columns2></template></span><button :disabled="!!browser && browserBusy" class="column-name" :title="name" @click="() => cycleSort(column)">{{ name }}</button><button :class="'column-filter-button' + (localFilters[column] || databaseFilters[column] ? ' active' : '')" :title="'Filter ' + name" :aria-label="'Filter ' + name" :aria-pressed="!!localFilters[column] || !!databaseFilters[column]" @click="event => {
  filterAnchor = event.currentTarget as HTMLButtonElement;
  setFilterColumn(current => current === column ? null : column);
}"><Filter :size="13"></Filter></button><button :disabled="!!browser && browserBusy" class="sort-column" :aria-label="'Sort ' + name" :title="'Sort by ' + name + ' (ascending, descending, original order)'" @click="() => cycleSort(column)"><template v-if="sort?.column === column"><template v-if="sort.descending"><ArrowDown :size="13"></ArrowDown></template><template v-else><ArrowUp :size="13"></ArrowUp></template></template><template v-else><ChevronsUpDown :size="13"></ChevronsUpDown></template></button></div><div class="column-resizer" role="separator" :aria-label="'Resize ' + name" aria-orientation="vertical" :aria-valuenow="width(column)" :aria-valuemin="80" :aria-valuemax="1000" :tabindex="0" @keydown="event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    setWidths(current => ({
      ...current,
      [column]: Math.max(80, Math.min(1000, width(column) + (event.key === 'ArrowRight' ? 20 : -20)))
    }));
  }
}" @dblclick="() => {
  const _data16 = data!;
  return setWidths(current => ({
    ...current,
    [column]: Math.min(600, _data16.rows.reduce((maximum, row) => Math.max(maximum, (row[column] ?? 'NULL').length * 8 + 35), Math.max(140, name.length * 8 + 35)))
  }));
}" @pointerdown="event => {
  event.preventDefault();
  (event.currentTarget as HTMLInputElement).setPointerCapture(event.pointerId);
  drag = {
    column,
    x: event.clientX,
    width: width(column)
  };
}" @pointermove="event => {
  const start = drag;
  if (start?.column === column) setWidths(current => ({
    ...current,
    [column]: Math.max(80, Math.min(1000, start.width + event.clientX - start.x))
  }));
}" @pointerup="() => {
  drag = null;
}" @lostpointercapture="() => {
  drag = null;
}" @pointercancel="() => {
  drag = null;
}"></div></th></template></tr></thead><tbody><template v-if="start > 0"><tr aria-hidden="true"><td :colspan="data.columns.length + 1" :style="cssPixels({
  height: start * GRID_ROW_HEIGHT,
  padding: 0,
  border: 0
})"></td></tr></template><template v-for="({
  values,
  index
}, visibleIndex) in rows.slice(start, end)" :key="index"><tr  :class="(selection?.row === index && selection.column === null ? 'selected-row ' : '') + (editing.added.includes(index) ? 'inserted-row ' : '') + (editing.deleted.includes(index + rowOffset) ? 'deleted-row' : '')"><td><button class="row-selector" :aria-label="'Select row ' + (rowOffset + start + visibleIndex + 1)" @click="() => {
  setRange(null);
  anchor = null;
  setSelection({
    row: index,
    column: null
  });
  setMessage('');
}">{{ rowOffset + start + visibleIndex + 1 }}</button></td><template v-for="(value, column) in values" :key="column"><td  :data-row="index" :data-column="column" :tabindex="0" :aria-selected="selectedSet.has(`${index}:${column}`)" @mousedown="event => {
  if (event.shiftKey && event.button === 0) event.preventDefault();
}" @contextmenu="event => {
  const _selectedSet = selectedSet!;
  const _rowOffset3 = rowOffset!;
  const _start3 = start!;
  event.preventDefault();
  if (!_selectedSet.has(`${index}:${column}`)) selectCell(index, column);
  setCellMenu({
    position: menuPosition(event),
    row: index,
    column,
    displayRow: _rowOffset3 + _start3 + visibleIndex + 1
  });
}" @dblclick="event => {
  const _rowOffset3 = rowOffset!;
  const _start3 = start!;
  if (!editing.open(index, column)) openCellViewer(value, column, _rowOffset3 + _start3 + visibleIndex + 1, event.currentTarget as HTMLInputElement);
}" @keydown="event => {
  const _rowOffset3 = rowOffset!;
  const _start3 = start!;
  if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
    event.preventDefault();
    const origin = event.currentTarget as HTMLInputElement;
    const rect = origin.getBoundingClientRect();
    setCellMenu({
      position: {
        x: rect.left,
        y: rect.bottom,
        origin
      },
      row: index,
      column,
      displayRow: _rowOffset3 + _start3 + visibleIndex + 1
    });
  } else if (event.key === 'Enter' || event.key === 'F2') {
    event.preventDefault();
    if (!editing.open(index, column)) openCellViewer(value, column, _rowOffset3 + _start3 + visibleIndex + 1, event.currentTarget as HTMLInputElement);
  } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    moveCell(index, column, event.key, event.shiftKey);
  } else if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && (event.key.length === 1 || event.key === 'Backspace')) {
    if (editing.open(index, column, event.key === 'Backspace' ? '' : event.key)) event.preventDefault();
  }
}" :class="(selectedSet.has(`${index}:${column}`) ? 'selected-cell ' : '') + (editing.changeAt(index, column) ? 'edited-cell ' : '') + (editing.active(index, column) ? 'editing-cell' : '')" :title="editing.active(index, column) ? undefined : value ?? 'NULL (no value)'" @focus="() => {
  setSelection({
    row: index,
    column
  });
  setMessage('');
}" @click="event => selectCell(index, column, event.shiftKey)"><template v-if="value !== null && !data.joinEditable && keys.get(data.columns[column])?.foreignKey && cacheId && onReference"><button class="foreign-key-link" :disabled="browserBusy" :title="'Open related record for ' + data.columns[column]" :aria-label="'Open related record for ' + data.columns[column] + ' row ' + (rowOffset + start + visibleIndex + 1)" @dblclick="event => event.stopPropagation()" @keydown="event => event.stopPropagation()" @click="event => {
  const _data16 = data!;
  const _rowOffset3 = rowOffset!;
  event.stopPropagation();
  setReferenceCell({
    column: _data16.columns[column],
    index: index + _rowOffset3
  });
}"><Link2 :size="13"></Link2></button></template><InlineCellEditor v-if="editing.active(index, column)" :editing="editing" :row="index" :column="column" /><template v-else><template v-if="editing.placeholder(index, column) && !editing.changeAt(index, column)"><span class="draft-placeholder">{{ editing.placeholder(index, column) }}</span></template><template v-else><template v-if="editing.changeAt(index, column)"><span class="edited-value"><template v-if="editing.changeAt(index, column)!.value === null"><span class="null-value">NULL</span></template><template v-else><template v-if="editing.changeAt(index, column)!.value === ''"><span class="empty-value">empty</span></template><template v-else>{{ editing.changeAt(index, column)!.value }}</template></template></span></template><template v-else><template v-if="value === null"><span class="null-value">NULL</span></template><template v-else><template v-if="value === ''"><span class="empty-value" aria-label="Empty string">empty</span></template><template v-else>{{ value }}</template></template></template></template></template></td></template></tr></template><template v-if="end < rows.length"><tr aria-hidden="true"><td :colspan="data.columns.length + 1" :style="cssPixels({
  height: (rows.length - end) * GRID_ROW_HEIGHT,
  padding: 0,
  border: 0
})"></td></tr></template></tbody></table><template v-if="!rows.length"><div class="muted padded">{{ filterCount ? 'No rows match the filters on this page.' : 'Query returned no rows.' }}</div></template></div><template v-if="externalBusy"><div class="grid-loading-overlay" role="status" aria-label="Loading results"><LoaderCircle :size="28" class="spin" aria-hidden="true"></LoaderCircle><span class="sr-only">Loading results…</span></div></template></div><template v-if="cellMenu"><ContextMenu :position="cellMenu.position" label="Result cell actions" @close="() => setCellMenu(null)" :actions="((_cellMenu, _selectedCells3, _data16, _browserBusy3, _cacheId3, _onReference, _keys, _rowOffset3) => [{
  label: 'Copy cell',
  icon: Copy,
  action: () => void copy(false, _cellMenu)
}, {
  label: 'Paste',
  disabled: !_selectedCells3.length || _selectedCells3.some(c => !editing.editable(c.column, c.row)),
  action: () => void pasteClipboard()
}, {
  label: 'Copy row',
  icon: Copy,
  action: () => void copy(true, _cellMenu)
}, {
  label: 'Edit cell',
  disabled: !editing.editable(_cellMenu.column, _cellMenu.row),
  action: () => {
    editing.open(_cellMenu.row, _cellMenu.column);
  }
}, ...(editing.isUuid(_cellMenu.column) ? [{
  label: 'Generate UUID',
  disabled: !editing.editable(_cellMenu.column, _cellMenu.row),
  action: () => editing.generateUuid(_cellMenu.row, _cellMenu.column)
}] : []), ...(editing.isDate(_cellMenu.column) ? [{
  label: 'Set now',
  disabled: !editing.editable(_cellMenu.column, _cellMenu.row),
  action: () => editing.setNow(_cellMenu.row, _cellMenu.column)
}] : []), {
  label: 'Set NULL',
  disabled: !editing.editable(_cellMenu.column, _cellMenu.row),
  action: () => editing.setNull(_cellMenu.row, _cellMenu.column)
}, {
  label: 'View full value',
  separator: true,
  action: () => openCellViewer(editing.changeAt(_cellMenu.row, _cellMenu.column)?.value ?? _data16.rows[_cellMenu.row]?.[_cellMenu.column] ?? null, _cellMenu.column, _cellMenu.displayRow, _cellMenu.position.origin)
}, {
  label: 'Filter locally by this value',
  icon: Filter,
  action: () => setLocalFilters(current => ({
    ...current,
    [_cellMenu.column]: {
      operator: 'in',
      value: '',
      values: [editing.changeAt(_cellMenu.row, _cellMenu.column)?.value ?? _data16.rows[_cellMenu.row]?.[_cellMenu.column] ?? null]
    }
  }))
}, {
  label: 'Open related records',
  icon: Link2,
  disabled: !!_data16.joinEditable || _browserBusy3 || !_cacheId3 || !_onReference || !_keys.get(_data16.columns[_cellMenu.column])?.foreignKey || (editing.changeAt(_cellMenu.row, _cellMenu.column)?.value ?? _data16.rows[_cellMenu.row]?.[_cellMenu.column] ?? null) === null,
  action: () => setReferenceCell({
    column: _data16.columns[_cellMenu.column],
    index: _cellMenu.row + _rowOffset3
  })
}])(cellMenu, selectedCells, data, browserBusy, cacheId, onReference, keys, rowOffset)"></ContextMenu></template><template v-if="referenceCell && cacheId && onReference"><ReferencePicker :cacheId="cacheId" :column="referenceCell.column" @close="() => setReferenceCell(null)" :onOpen="((_onReference, _referenceCell) => reference => {
  _onReference(reference, _referenceCell.column, _referenceCell.index);
  setReferenceCell(null);
})(onReference!, referenceCell!)"></ReferencePicker></template><template v-if="cellViewer"><CellValueViewer :key="cellViewer.column + ':' + cellViewer.row" v-bind="cellViewer" @close="closeCellViewer"></CellValueViewer></template></div>
</template>
