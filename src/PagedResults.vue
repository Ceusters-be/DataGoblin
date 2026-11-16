<script setup lang="ts">
import { ForeignReference } from './types';
import { Engine } from './types';
import { TableBrowser } from './types';
import { ResultSet } from './types';
import { QueryResult } from './types';
import { OutputEvent } from './QueryOutput';
import { shallowRef, computed, Teleport, watch, onBeforeUnmount } from 'vue';
import { stateSetter, watchMounted, cssPixels } from './vueLifecycle';
import { editingPage } from './useGridEditing';
import { invoke } from '@tauri-apps/api/core';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from '@lucide/vue';
import ResultsGrid from './ResultsGrid.vue';
import type { ResultPage, ValueChoices } from './types';
import { defaultPageSize } from './PagedResults';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  onLog?: (event: OutputEvent) => void;
  logDatabase?: string;
  onCancel?: () => void;
  cancellable?: boolean;
  refreshInterval?: number;
  onRefreshInterval?: (seconds: number) => void;
  onReload?: () => Promise<void>;
  onEditingChange?: (dirty: boolean) => void;
  onReference?: (
    reference: ForeignReference,
    column: string,
    rowIndex: number,
  ) => void;
  engine?: Engine;
  browser?: TableBrowser | null;
  onBrowse?: (
    filters: TableBrowser['filters'],
    sort: TableBrowser['sort'],
  ) => void;
  browserBusy?: boolean;
  data: ResultSet;
  cacheId?: string | null;
  setIndex: number;
  truncated: boolean;
  onExport: (rows: ResultSet['rows']) => Promise<void>;
  initialSize?: number;
  closed?: boolean;
  onUpdate?: (result: QueryResult) => void;
  onBusy?: (busy: boolean) => void;
}>();
const data = computed(() => _props.data);
const cacheId = computed(() => _props.cacheId);
const setIndex = computed(() => _props.setIndex);
const truncated = computed(() => _props.truncated);
const onExport = computed(() => _props.onExport);
const initialSize = computed(() =>
  _props.initialSize === undefined ? 500 : _props.initialSize,
);
const closed = computed(() =>
  _props.closed === undefined ? false : _props.closed,
);
const onUpdate = computed(() => _props.onUpdate);
const onBusy = computed(() => _props.onBusy);
const onReference = computed(() => _props.onReference);
const engine = computed(() => _props.engine);
const browser = computed(() => _props.browser);
const onBrowse = computed(() => _props.onBrowse);
const browserBusy = computed(() => _props.browserBusy);
const onReload = computed(() => _props.onReload);
const onEditingChange = computed(() => _props.onEditingChange);
const onCancel = computed(() => _props.onCancel);
const cancellable = computed(() => _props.cancellable);
const refreshInterval = computed(() => _props.refreshInterval);
const onRefreshInterval = computed(() => _props.onRefreshInterval);
const onLog = computed(() => _props.onLog);
const logDatabase = computed(() => _props.logDatabase);
const loadValues = (column: string, search: string) => {
  const _cacheId = cacheId.value;
  return invoke<ValueChoices>('table_values', {
    cacheId: _cacheId,
    column,
    search,
  });
};
const page = shallowRef(
  (() => {
    const _cacheId2 = cacheId.value;
    const _initialSize = initialSize.value;
    const _data = data.value;
    return (
      editingPage(_cacheId2) ?? {
        offset: 0,
        size: _initialSize,
        rows: _data.rows,
      }
    );
  })(),
);
const setPage = stateSetter(page);
const editing = shallowRef(false);
const setEditing = stateSetter(editing);
const busy = shallowRef(false);
const setBusy = stateSetter(busy);
const loadingAll = shallowRef(false);
const loadedRows = shallowRef(0);
const allBatchSize = 500;
const editBusy = shallowRef(false);
const grid = shallowRef<InstanceType<typeof ResultsGrid> | null>(null);
watch(() => busy.value || editBusy.value, value => _props.onBusy?.(value), { immediate: true, flush: 'sync' });
onBeforeUnmount(() => _props.onBusy?.(false));
defineExpose({
  discardEdits() {
    if (busy.value || editBusy.value) return false;
    return grid.value?.discardEdits() ?? true;
  },
});
const error = shallowRef('');
const setError = stateSetter(error);
const status = shallowRef('');
const setStatus = stateSetter(status);
const menu = shallowRef(false);
const setMenu = stateSetter(menu);
const savedSize = shallowRef(defaultPageSize());
const setSavedSize = stateSetter(savedSize);
const menuPosition = shallowRef({
  left: 0,
  bottom: 0,
  maxHeight: 300,
});
const setMenuPosition = stateSetter(menuPosition);
const menuRef = shallowRef<HTMLDivElement | null>(null);
const trigger = shallowRef<HTMLButtonElement | null>(null);
const custom = shallowRef(false);
const setCustom = stateSetter(custom);
const customSize = shallowRef('500');
const setCustomSize = stateSetter(customSize);
const generation = shallowRef(0);
const total = shallowRef(data.value.totalRows ?? data.value.rows.length);
const setTotal = stateSetter(total);
const hasMore = shallowRef(data.value.hasMore ?? false);
const setHasMore = stateSetter(hasMore);
const countedTotal = shallowRef<number | null>(null);
const setCountedTotal = stateSetter(countedTotal);
async function load(offset: number, size: number) {
  const _closed = closed.value;
  const _busy = busy.value;
  const _browserBusy = browserBusy.value;
  const _editing = editing.value;
  const _cacheId3 = cacheId.value;
  const _setIndex = setIndex.value;
  const _data2 = data.value;
  const _onLog = onLog.value;
  const _total = total.value;
  const _onUpdate = onUpdate.value;
  if (_closed || _busy || _browserBusy || _editing) return;
  setMenu(false);
  const request = ++generation.value;
  const started = performance.now();
  setBusy(true);

  setError('');
  setStatus('');
  try {
    if (!Number.isInteger(size) || size < 0 || size > 10000)
      throw new Error('Choose a page size between 1 and 10,000.');
    if (size === 0 && _cacheId3) {
      loadingAll.value = true;
      loadedRows.value = page.value.offset === offset ? page.value.rows.length : 0;
      let rows: ResultSet['rows'] = [];
      while (request === generation.value && !closed.value) {
        const response = await invoke<ResultPage>('result_page', {
          cacheId: _cacheId3, setIndex: _setIndex,
          offset: offset + rows.length, pageSize: allBatchSize,
        });
        if (request !== generation.value || closed.value) return;
        if (!response.rows.length && (response.hasMore || offset + rows.length < response.totalRows))
          throw new Error('Loading stopped because the next batch returned no rows. Loaded rows are still available.');
        rows = rows.concat(response.rows);
        loadedRows.value = rows.length;
        setPage({ offset, size: 0, rows });
        setCustom(false);
        setTotal(response.totalRows ?? offset + rows.length);
        setHasMore(response.hasMore ?? false);
        if (response.result) _onUpdate?.(response.result);
        // A completed backend stream can still have cached rows beyond this batch.
        if (!response.hasMore && offset + rows.length >= response.totalRows) {
          if (!response.result?.truncated) setCountedTotal(null);
          break;
        }
      }
      if (request === generation.value && !closed.value) {
        const duration = Math.round(performance.now() - started);
        _onLog?.({kind:'success',text:`${rows.length} rows retrieved in ${duration} ms · All data · ${allBatchSize.toLocaleString()}-row batches`,duration});
      }
      return;
    }
    const response = _cacheId3
      ? await invoke<ResultPage>('result_page', {
          cacheId: _cacheId3,
          setIndex: _setIndex,
          offset,
          pageSize: size,
        })
      : {
          rows: _data2.rows.slice(
            offset,
            size === 0 ? undefined : offset + size,
          ),
          totalRows: _data2.rows.length,
          hasMore: false,
        };
    if (request === generation.value) {
      const duration = Math.round(performance.now() - started);
      _onLog?.({
        kind: 'success',
        text: `${response.rows.length} rows retrieved starting from ${offset + 1} in ${duration} ms${_cacheId3 ? ' · Result page' : ' · Local page'}`,
        duration,
      });
      setPage({
        offset,
        size,
        rows: response.rows,
      });
      setCustom(false);
      setTotal(response.totalRows ?? _total);
      setHasMore(response.hasMore ?? false);
      if (!response.hasMore && !response.result?.truncated)
        setCountedTotal(null);
      if (response.result) _onUpdate?.(response.result);
    }
  } catch (error) {
    if (request === generation.value) {
      const text = error instanceof Error ? error.message : String(error);
      setError(text);
      _onLog?.({
        kind: 'error',
        text,
        duration: Math.round(performance.now() - started),
      });
    }
  } finally {
    if (request === generation.value) {
      setBusy(false);
      loadingAll.value = false;

    }
  }
}
async function countRows() {
  const _cacheId4 = cacheId.value;
  const _closed2 = closed.value;
  const _busy2 = busy.value;
  const _browserBusy2 = browserBusy.value;
  const _editing2 = editing.value;
  const _setIndex2 = setIndex.value;
  const _onLog2 = onLog.value;
  if (!_cacheId4 || _closed2 || _busy2 || _browserBusy2 || _editing2) return;
  const request = ++generation.value;
  const started = performance.now();
  setBusy(true);

  setError('');
  setStatus('');
  try {
    const count = await invoke<number>('result_count', {
      cacheId: _cacheId4,
      setIndex: _setIndex2,
    });
    if (request === generation.value) {
      setCountedTotal(count);
      const duration = Math.round(performance.now() - started);
      _onLog2?.({
        kind: 'success',
        text: `Count completed: ${count} rows in ${duration} ms`,
        duration,
      });
    }
  } catch (error) {
    if (request === generation.value) {
      const text = error instanceof Error ? error.message : String(error);
      setError(text);
      _onLog2?.({
        kind: 'error',
        text,
        duration: Math.round(performance.now() - started),
      });
    }
  } finally {
    if (request === generation.value) {
      setBusy(false);

    }
  }
}
watchMounted(
  () => [],
  () => {
    const _initialSize2 = initialSize.value;
    const _cacheId5 = cacheId.value;
    const _data3 = data.value;
    const size = defaultPageSize();
    if (
      size !== _initialSize2 ||
      (!_cacheId5 && _data3.rows.length > _initialSize2)
    )
      void load(0, size);
    return () => {
      generation.value++;

    };
  },
);
function closeMenu() {
  setMenu(false);
  trigger.value?.focus();
}
function openMenu() {
  const _menu = menu.value;
  if (_menu) {
    closeMenu();
    return;
  }
  const rect = trigger.value!.getBoundingClientRect();
  setMenuPosition({
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 198)),
    bottom: window.innerHeight - rect.top + 8,
    maxHeight: Math.max(100, rect.top - 16),
  });
  setMenu(true);
  setError('');
  setCustom(false);
}
watchMounted(
  () => {
    const _menu2 = menu.value;
    return [_menu2];
  },
  () => {
    const _menu3 = menu.value;
    if (!_menu3) return;
    menuRef.value
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.value?.contains(event.target as Node) &&
        !trigger.value?.contains(event.target as Node)
      )
        setMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeMenu();
      }
    };
    const resize = () => setMenu(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
    };
  },
);
const range = computed(() => {
  const _total2 = total.value;
  const _page = page.value;
  return _total2 === 0
    ? '0'
    : `${_page.offset + 1}–${_page.offset + _page.rows.length}`;
});
const displayTotal = computed(() => {
  const _countedTotal = countedTotal.value;
  const _total3 = total.value;
  return _countedTotal ?? _total3;
});
const unknown = computed(() => {
  const _countedTotal2 = countedTotal.value;
  const _truncated = truncated.value;
  const _hasMore = hasMore.value;
  return _countedTotal2 === null && (_truncated || _hasMore);
});
const totalLabel = computed(() => {
  const _displayTotal = displayTotal.value;
  const _unknown = unknown.value;
  return `of ${_displayTotal.toLocaleString()}${_unknown ? '+' : ''}`;
});
const last = computed(() => {
  const _page2 = page.value;
  const _truncated2 = truncated.value;
  const _total4 = total.value;
  const _displayTotal2 = displayTotal.value;
  return _page2.size === 0
    ? 0
    : Math.max(
        0,
        Math.floor(
          ((_truncated2 ? _total4 : _displayTotal2) - 1) / _page2.size,
        ) * _page2.size,
      );
});
const presets = computed(() => [10, 100, 250, 500, 1000]);
const document = globalThis.document;
const HTMLInputElement = globalThis.HTMLInputElement;
const localStorage = globalThis.localStorage;
</script>

<template>
  <div class="paged-results">
    <div class="pagination" role="group" aria-label="Result pages">
      <button
        class="icon-button"
        title="First page"
        :disabled="
          closed || busy || browserBusy || editing || page.offset === 0
        "
        @click="
          () => {
            const _page3 = page!;
            return void load(0, _page3.size);
          }
        "
      >
        <ChevronsLeft :size="16"></ChevronsLeft>
      </button>
      <button
        class="icon-button"
        title="Previous page"
        :disabled="
          closed || busy || browserBusy || editing || page.offset === 0
        "
        @click="
          () => {
            const _page3 = page!;
            return void load(
              Math.max(0, _page3.offset - _page3.size),
              _page3.size,
            );
          }
        "
      >
        <ChevronLeft :size="16"></ChevronLeft>
      </button>
      <div
        class="pager-readout"
        :aria-label="range + ' ' + totalLabel"
        aria-live="polite"
      >
        <button
          ref="trigger"
          class="page-range"
          aria-label="Page size"
          aria-haspopup="menu"
          :aria-expanded="menu"
          :disabled="closed || busy || browserBusy || editing"
          @click="openMenu"
          @keydown="
            (event) => {
              const _menu4 = menu!;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!_menu4) openMenu();
              }
            }
          "
        >
          {{ range }}
          <ChevronDown :size="12"></ChevronDown>
        </button>
        <button
          class="row-count"
          aria-label="Count all rows"
          :title="unknown ? 'Run a separate table COUNT query' : 'Total rows'"
          :disabled="closed || busy || browserBusy || editing || !unknown"
          @click="() => void countRows()"
        >
          {{ totalLabel }}
        </button>
      </div>
      <button
        class="icon-button"
        title="Next page"
        :disabled="
          closed ||
          busy ||
          browserBusy ||
          editing ||
          (!hasMore && page.offset >= last)
        "
        @click="
          () => {
            const _page3 = page!;
            return void load(_page3.offset + _page3.size, _page3.size);
          }
        "
      >
        <ChevronRight :size="16"></ChevronRight>
      </button>
      <button
        class="icon-button"
        :title="unknown ? 'Last page (total not known yet)' : 'Last page'"
        :disabled="
          closed ||
          busy ||
          browserBusy ||
          editing ||
          unknown ||
          page.offset >= last
        "
        @click="
          () => {
            const _last = last!;
            const _page3 = page!;
            return void load(_last, _page3.size);
          }
        "
      >
        <ChevronsRight :size="16"></ChevronsRight>
      </button>
      <span v-if="loadingAll" class="quiet" role="status" aria-live="polite">
        Loading all data… {{ loadedRows.toLocaleString() }} rows loaded · {{ allBatchSize.toLocaleString() }} per batch
      </span>
    </div>
    <template v-if="menu">
      <Teleport to="body">
        <div
          ref="menuRef"
          class="page-size-menu"
          role="menu"
          aria-label="Page size options"
          :style="cssPixels(menuPosition)"
          @keydown="
            (event) => {
              if (
                (event.target as HTMLInputElement) instanceof HTMLInputElement
              )
                return;
              if (event.key === 'Tab') {
                setMenu(false);
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
                return;
              event.preventDefault();
              const buttons = Array.from(
                menuRef!.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled)',
                ),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index +
                        (event.key === 'ArrowDown' ? 1 : -1) +
                        buttons.length) %
                      buttons.length
              ]?.focus();
            }
          "
        >
          <div class="page-menu-heading">Page Size</div>
          <template
            v-for="size in [
              ...presets,
              ...(!presets.includes(page.size) && page.size !== 0
                ? [page.size]
                : []),
              0,
            ]"
            :key="size"
          >
            <button
              role="menuitemradio"
              :aria-checked="page.size === size"
              @click="
                () => {
                  closeMenu();
                  void load(0, size);
                }
              "
            >
              <template v-if="page.size === size">
                <Check :size="13"></Check>
              </template>
              <template v-else><span class="menu-check-space"></span></template>
              {{ size === 0 ? 'All' : size.toLocaleString() }}
              <template v-if="savedSize === size">
                <span class="page-menu-default">Default</span>
              </template>
            </button>
          </template>
          <button
            role="menuitem"
            @click="
              () => {
                const _page3 = page!;
                setCustom(true);
                setCustomSize(String(_page3.size || 500));
              }
            "
          >
            Custom…
          </button>
          <template v-if="custom">
            <div class="custom-page-size">
              <input
                autofocus
                aria-label="Custom page size"
                type="number"
                min="1"
                max="10000"
                :value="customSize"
                @input="
                  (event) =>
                    setCustomSize((event.target as HTMLInputElement).value)
                "
              />
              <button
                @click="
                  () => {
                    const _customSize = customSize!;
                    const size = Number(_customSize);
                    if (!Number.isInteger(size) || size < 1 || size > 10000) {
                      setError('Choose a page size between 1 and 10,000.');
                      return;
                    }
                    closeMenu();
                    void load(0, size);
                  }
                "
              >
                Apply
              </button>
            </div>
          </template>
          <div v-if="error" role="alert">{{ error }}</div>
          <button
            role="menuitem"
            class="save-page-default"
            @click="
              () => {
                const _page3 = page!;
                try {
                  localStorage.setItem(
                    'datagoblin.pageSize',
                    String(_page3.size),
                  );
                  setSavedSize(_page3.size);
                  setStatus('Default page size saved.');
                  closeMenu();
                } catch {
                  setError('Could not save the default page size.');
                }
              }
            "
          >
            Set as default
          </button>
        </div>
      </Teleport>
    </template>
    <template v-if="status">
      <span class="sr-only" role="status">{{ status }}</span>
    </template>
    <ResultsGrid
      ref="grid"
      @edit-busy="value => { editBusy = value; }"
      @log="onLog"
      :logDatabase="logDatabase"
      @cancel="onCancel"
      :cancellable="cancellable || busy"
      :refreshInterval="refreshInterval"
      @refresh-interval="onRefreshInterval"
      @reload="onReload"
      :onEditDirty="
        ((_onEditingChange) => (dirty) => {
          setEditing(dirty);
          _onEditingChange?.(dirty);
        })(onEditingChange!)
      "
      :cacheId="!closed && setIndex === 0 ? cacheId : null"
      @reference="onReference"
      :engine="engine"
      :browser="browser"
      @browse="onBrowse"
      :browserBusy="browserBusy || busy"
      :loadValues="loadValues"
      :data="{
        ...data,
        rows: page.rows,
        pageSize: page.size,
      }"
      :rowOffset="page.offset"
      @export="onExport"
    ></ResultsGrid>
  </div>
</template>
