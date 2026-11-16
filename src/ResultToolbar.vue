<script setup lang="ts">
import { shallowRef, computed, watchSyncEffect, Teleport } from 'vue';
import { stateSetter, watchMounted } from './vueLifecycle';
import {
  RefreshCw,
  Clock3,
  Square,
  Plus,
  Minus,
  Undo2,
  Eye,
  ArrowUp,
  Check,
  Download,
} from '@lucide/vue';
import ContextMenu from './ContextMenu.vue';
import { type MenuPosition } from './ContextMenu';
import DialogBoundary from './DialogBoundary.vue';
import { Props } from './ResultToolbar';
defineOptions({
  inheritAttrs: false,
});
const p = defineProps<Props>();
const menu = shallowRef<MenuPosition | null>(null);
const setMenu = stateSetter(menu);
const dialog = shallowRef<'refresh' | 'interval' | null>(null);
const setDialog = stateSetter(dialog);
const seconds = shallowRef('30');
const setSeconds = stateSetter(seconds);
const error = shallowRef('');
const setError = stateSetter(error);
const refreshing = shallowRef(false);
const setRefreshing = stateSetter(refreshing);
const inFlight = shallowRef(false);
const latest = shallowRef(p);
watchSyncEffect(() => (latest.value = p));
async function refresh(discard = false) {
  const current = latest.value;
  if (!current.onRefresh || current.busy || inFlight.value) return;
  if (current.dirty && !discard) {
    setDialog('refresh');
    return;
  }
  if (discard) current.onRevert();
  setDialog(null);
  inFlight.value = true;
  setRefreshing(true);
  setError('');
  try {
    await current.onRefresh();
  } catch (e) {
    setError(String(e));
  } finally {
    inFlight.value = false;
    setRefreshing(false);
  }
}
watchMounted(
  () => {
    const _dialog = dialog.value;
    const _menu = menu.value;
    return [p.interval, !!p.onRefresh, _dialog, _menu];
  },
  () => {
    const _dialog2 = dialog.value;
    const _menu2 = menu.value;
    if (!p.interval || !p.onRefresh) return;
    const timer = window.setInterval(() => {
      const current = latest.value;
      if (
        !current.dirty &&
        !current.busy &&
        !current.submitted &&
        !_dialog2 &&
        !_menu2 &&
        document.visibilityState !== 'hidden'
      )
        void refresh();
    }, p.interval * 1000);
    return () => window.clearInterval(timer);
  },
);
const busy = computed(() => {
  const _refreshing = refreshing.value;
  return p.busy || _refreshing;
});
const close = () => {
  setDialog(null);
  setError('');
};
</script>

<template>
  <div
    class="grid-actions result-toolbar"
    role="toolbar"
    aria-label="Result actions"
  >
    <button
      class="icon-button"
      title="Refresh results"
      aria-label="Refresh results"
      :disabled="!p.onRefresh || busy"
      @click="() => void refresh()"
    >
      <RefreshCw :size="15" :class="refreshing ? 'spin' : ''"></RefreshCw>
    </button>
    <button
      :class="'icon-button' + (p.interval ? ' active' : '')"
      :title="
        p.interval
          ? `Auto-refresh every ${p.interval} seconds${p.dirty ? ' (paused while editing)' : ''}`
          : 'Auto-refresh'
      "
      aria-label="Auto-refresh"
      aria-haspopup="menu"
      :aria-expanded="!!menu"
      :disabled="!p.onRefresh || !p.onInterval"
      @click="
        (e) => {
          const rect = (
            e.currentTarget as HTMLInputElement
          ).getBoundingClientRect();
          setMenu({
            x: rect.left,
            y: rect.bottom,
            origin: e.currentTarget as HTMLInputElement,
          });
        }
      "
    >
      <Clock3 :size="15"></Clock3>
    </button>
    <button
      class="icon-button"
      title="Cancel result query"
      aria-label="Cancel result query"
      :disabled="!p.cancellable || !p.onCancel"
      @click="p.onCancel"
    >
      <Square :size="12" fill="currentColor"></Square>
    </button>
    <span class="toolbar-divider"></span>
    <button
      class="icon-button"
      title="Add row"
      aria-label="Add row"
      :disabled="!p.canAdd || busy"
      @click="p.onAdd"
    >
      <Plus :size="16"></Plus>
    </button>
    <button
      class="icon-button"
      title="Delete selected rows"
      aria-label="Delete selected rows"
      :disabled="!p.canDelete || busy || p.submitted"
      @click="p.onDelete"
    >
      <Minus :size="16"></Minus>
    </button>
    <button
      class="icon-button"
      title="Revert changes"
      aria-label="Revert changes"
      :disabled="!p.dirty || busy"
      @click="p.onRevert"
    >
      <Undo2 :size="16"></Undo2>
    </button>
    <button
      class="icon-button"
      title="Preview pending changes"
      aria-label="Preview pending changes"
      :disabled="!p.count || busy || p.submitted"
      @click="p.onPreview"
    >
      <Eye :size="16"></Eye>
    </button>
    <button
      class="icon-button submit-changes"
      title="Submit changes (Ctrl/Cmd+Enter)"
      aria-label="Submit changes"
      :disabled="!p.dirty || busy || p.submitted"
      @click="p.onSubmit"
    >
      <ArrowUp :size="17"></ArrowUp>
    </button>
    <span class="toolbar-divider"></span>
    <span class="grid-help" aria-live="polite">
      {{
        p.count
          ? `${p.count} pending ${p.count === 1 ? 'change' : 'changes'}`
          : ''
      }}{{
        p.interval ? ` · Auto ${p.interval}s${p.dirty ? ' paused' : ''}` : ''
      }}
    </span>
    <button
      class="icon-button"
      title="Export displayed results as CSV"
      aria-label="Export CSV"
      @click="p.onExport"
    >
      <Download :size="15"></Download>
    </button>
  </div>
  <template v-if="error && !dialog">
    <div role="alert" class="grid-edit-message">{{ error }}</div>
  </template>
  <template v-if="menu">
    <ContextMenu
      :position="menu"
      label="Auto-refresh interval"
      @close="() => setMenu(null)"
      :actions="[
        ...[0, 5, 10, 30, 60, 300].map((value) => ({
          label:
            value === 0
              ? 'Disabled'
              : value < 60
                ? `${value} s`
                : `${value / 60} m`,
          icon: (p.interval ?? 0) === value ? Check : undefined,
          action: () => p.onInterval?.(value),
        })),
        {
          label: 'Custom…',
          separator: true,
          action: () => {
            setSeconds(String(p.interval || 30));
            setError('');
            setDialog('interval');
          },
        },
      ]"
    ></ContextMenu>
  </template>
  <template v-if="dialog">
    <Teleport to="body">
      <DialogBoundary @close="close">
        <div class="grid-edit-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            :aria-label="
              dialog === 'refresh'
                ? 'Ignore Unsubmitted Changes'
                : 'Custom Update Interval'
            "
            class="dialog result-toolbar-dialog"
          >
            <template v-if="dialog === 'refresh'">
              <h2>Ignore Unsubmitted Changes</h2>
              <p>
                Changes are not submitted. Data will be lost.
                <br />
                Continue?
              </p>
              <div class="dialog-actions">
                <button
                  class="primary-button"
                  @click="() => void refresh(true)"
                >
                  Yes
                </button>
                <button autofocus @click="close">No</button>
              </div>
            </template>
            <template v-else>
              <form
                @submit="
                  (e) => {
                    const _seconds = seconds!;
                    e.preventDefault();
                    const value = Number(_seconds);
                    if (
                      !Number.isInteger(value) ||
                      value < 1 ||
                      value > 86400
                    ) {
                      setError('Enter a whole number from 1 to 86400 seconds.');
                      return;
                    }
                    p.onInterval?.(value);
                    close();
                  }
                "
              >
                <h2>Custom Update Interval</h2>
                <label>
                  Update interval in seconds
                  <input
                    autofocus
                    type="number"
                    min="1"
                    max="86400"
                    step="1"
                    :value="seconds"
                    @input="
                      (e) => setSeconds((e.target as HTMLInputElement).value)
                    "
                  />
                </label>
                <template v-if="error">
                  <p role="alert">{{ error }}</p>
                </template>
                <div class="dialog-actions">
                  <button class="primary-button" type="submit">OK</button>
                  <button type="button" @click="close">Cancel</button>
                </div>
              </form>
            </template>
          </section>
        </div>
      </DialogBoundary>
    </Teleport>
  </template>
</template>
