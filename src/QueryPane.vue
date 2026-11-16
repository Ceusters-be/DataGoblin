<script setup lang="ts">
import SavedQueryItem from './SavedQueryItem.vue';
import { QueryLibrary } from './types';
import { shallowRef, computed } from 'vue';
import { stateSetter, watchMounted, cssPixels } from './vueLifecycle';
import {
  FileCode2,
  FolderOpen,
  Plus,
  Search,
  Settings2,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  MoreHorizontal,
  X,
} from '@lucide/vue';
import DialogBoundary from './DialogBoundary.vue';
import type { SavedQuery } from './types';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  library: QueryLibrary | null;
  activeId: string;
  onOpen: (query: SavedQuery) => void;
  onNew: () => void;
  onSettings: () => void;
  onUpdate: (
    id: string,
    patch: {
      name?: string;
      pinned?: boolean;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}>();
const library = computed(() => _props.library);
const activeId = computed(() => _props.activeId);
const onOpen = computed(() => _props.onOpen);
const onNew = computed(() => _props.onNew);
const onSettings = computed(() => _props.onSettings);
const onUpdate = computed(() => _props.onUpdate);
const onDelete = computed(() => _props.onDelete);
const filter = shallowRef('');
const setFilter = stateSetter(filter);
const menu = shallowRef<{
  query: SavedQuery;
  x: number;
  y: number;
} | null>(null);
const setMenu = stateSetter(menu);
const renaming = shallowRef<SavedQuery | null>(null);
const setRenaming = stateSetter(renaming);
const name = shallowRef('');
const setName = stateSetter(name);
const busy = shallowRef(false);
const setBusy = stateSetter(busy);
const error = shallowRef('');
const setError = stateSetter(error);
const menuRef = shallowRef<HTMLDivElement | null>(null);
watchMounted(
  () => {
    const _menu = menu.value;
    return [_menu];
  },
  () => {
    const _menu2 = menu.value;
    if (!_menu2) return;
    const origin = document.activeElement as HTMLElement | null;
    menuRef.value?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.value?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMenu(null);
        origin?.focus();
      } else if (event.key === 'Tab') setMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  },
);
async function perform(action: () => Promise<void>) {
  setMenu(null);
  setBusy(true);
  setError('');
  try {
    await action();
    setRenaming(null);
  } catch (error) {
    setError(String(error));
  } finally {
    setBusy(false);
  }
}
function showMenu(query: SavedQuery, x: number, y: number) {
  const _busy = busy.value;
  if (!_busy) {
    setError('');
    setMenu({
      query,
      x: Math.max(8, Math.min(x, window.innerWidth - 218)),
      y: Math.max(8, Math.min(y, window.innerHeight - 142)),
    });
  }
}
const queries = computed(() => {
  const _library = library.value;
  const _filter = filter.value;
  return (_library?.queries ?? [])
    .filter((query) =>
      (query.name + ' ' + query.serverName + ' ' + query.database)
        .toLowerCase()
        .includes(_filter.toLowerCase()),
    )
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
      }),
    );
});
const pinned = computed(() => {
  const _queries = queries.value;
  return _queries.filter((query) => query.pinned);
});
const drafts = computed(() => {
  const _queries2 = queries.value;
  return _queries2.filter((query) => query.draft && !query.pinned);
});
const named = computed(() => {
  const _queries3 = queries.value;
  return _queries3.filter((query) => !query.draft && !query.pinned);
});
const groups = computed(() => {
  const _named = named.value;
  const grouped = new Map<string, SavedQuery[]>();
  for (const query of _named) {
    const key = JSON.stringify([query.connectionId, query.database]);
    const items = grouped.get(key) ?? [];
    items.push(query);
    grouped.set(key, items);
  }
  return Array.from(grouped, ([key, queries]) => ({
    key,
    queries,
    serverName: queries[0].serverName,
    database: queries[0].database,
  }));
});
const document = globalThis.document;
</script>

<template>
  <aside class="query-pane">
    <section aria-label="Saved queries" class="query-library">
      <div class="section-title">
        SAVED QUERIES
        <div>
          <button
            class="icon-button"
            title="Query storage settings"
            @click="onSettings"
          >
            <Settings2 :size="14"></Settings2>
          </button>
          <button
            class="icon-button"
            title="New saved query"
            :disabled="!library"
            @click="onNew"
          >
            <Plus :size="16"></Plus>
          </button>
        </div>
      </div>
      <div class="query-location" :title="library?.folder">
        <FolderOpen :size="13"></FolderOpen>
        <span>{{ library?.folder ?? 'Loading query library…' }}</span>
      </div>
      <div class="search">
        <Search :size="14"></Search>
        <input
          aria-label="Find saved queries"
          placeholder="Find a query…"
          :value="filter"
          @input="
            (event) => setFilter((event.target as HTMLInputElement).value)
          "
        />
      </div>
      <div class="query-library-list">
        <template v-if="pinned.length > 0">
          <details open class="pinned-folder">
            <summary>
              <Pin :size="14"></Pin>
              Pinned
              <span>{{ pinned.length }}</span>
            </summary>
            <SavedQueryItem
              v-for="query in pinned"
              :key="query.id"
              :query="query"
              :activeId="activeId"
              :busy="busy"
              @open="onOpen"
              @menu="showMenu"
            />
          </details>
        </template>
        <details open class="draft-folder">
          <summary>
            <FolderOpen :size="14"></FolderOpen>
            Unsaved
            <span>{{ drafts.length }}</span>
          </summary>
          <SavedQueryItem
            v-for="query in drafts"
            :key="query.id"
            :query="query"
            :activeId="activeId"
            :busy="busy"
            @open="onOpen"
            @menu="showMenu"
          />
          <template v-if="!drafts.length">
            <p class="muted">
              New Query1, Query2… drafts are saved here automatically.
            </p>
          </template>
        </details>
        <template v-for="group in groups" :key="group.key">
          <details open>
            <summary>
              <FolderOpen :size="14"></FolderOpen>
              {{ group.queries[0].serverName }} /
              {{ group.queries[0].database || 'No database' }}
              <span>{{ group.queries.length }}</span>
            </summary>
            <SavedQueryItem
              v-for="query in group.queries"
              :key="query.id"
              :query="query"
              :activeId="activeId"
              :busy="busy"
              @open="onOpen"
              @menu="showMenu"
            />
          </details>
        </template>
        <template v-if="filter && !queries.length">
          <p class="muted padded">No matching queries.</p>
        </template>
      </div>
      <template v-if="error && !renaming">
        <div class="form-message error" role="alert">{{ error }}</div>
      </template>
      <p class="query-pane-note">
        Unsaved drafts are kept on disk too. Rename a draft to organize it by
        server and database.
      </p>
    </section>
    <template v-if="menu">
      <div
        ref="menuRef"
        class="query-context-menu"
        role="menu"
        :aria-label="'Actions for ' + menu.query.name"
        :style="
          cssPixels({
            left: menu.x,
            top: menu.y,
          })
        "
        @keydown="
          (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const items = Array.from(
              (
                event.currentTarget as HTMLInputElement
              ).querySelectorAll<HTMLButtonElement>('button'),
            );
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            items[
              (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) %
                items.length
            ]?.focus();
          }
        "
      >
        <button
          role="menuitem"
          @click="
            () => {
              const _onUpdate = onUpdate!;
              const _menu3 = menu!;
              return void perform(() =>
                _onUpdate(_menu3.query.id, {
                  pinned: !_menu3.query.pinned,
                }),
              );
            }
          "
        >
          <template v-if="menu.query.pinned">
            <PinOff :size="14"></PinOff>
          </template>
          <template v-else><Pin :size="14"></Pin></template>
          {{ menu.query.pinned ? 'Unpin' : 'Pin' }}
        </button>
        <button
          role="menuitem"
          @click="
            () => {
              const _menu3 = menu!;
              setRenaming(_menu3.query);
              setName(_menu3.query.name);
              setMenu(null);
            }
          "
        >
          <Pencil :size="14"></Pencil>
          Rename
        </button>
        <button
          role="menuitem"
          class="delete-query"
          @click="
            () => {
              const _onDelete = onDelete!;
              const _menu3 = menu!;
              return void perform(() => _onDelete(_menu3.query.id));
            }
          "
        >
          <Trash2 :size="14"></Trash2>
          Delete
        </button>
      </div>
    </template>
    <template v-if="renaming">
      <DialogBoundary
        @close="
          () => {
            setRenaming(null);
            setError('');
          }
        "
        :disabled="busy"
      >
        <div class="overlay">
          <form
            class="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Rename query"
            @submit="
              (event) => {
                const _onUpdate = onUpdate!;
                const _renaming = renaming!;
                const _name = name!;
                event.preventDefault();
                void perform(() =>
                  _onUpdate(_renaming.id, {
                    name: _name.trim(),
                  }),
                );
              }
            "
          >
            <div class="modal-heading">
              <h2>Rename query</h2>
              <button
                type="button"
                class="icon-button"
                title="Close rename dialog"
                :disabled="busy"
                @click="
                  () => {
                    setRenaming(null);
                    setError('');
                  }
                "
              >
                <X :size="18"></X>
              </button>
            </div>
            <label>
              Name
              <input
                aria-label="New query name"
                autofocus
                :value="name"
                @input="
                  (event) => setName((event.target as HTMLInputElement).value)
                "
                required
              />
            </label>
            <template v-if="error">
              <div class="form-message error" role="alert">{{ error }}</div>
            </template>
            <div class="modal-footer">
              <button
                type="button"
                class="secondary-button"
                :disabled="busy"
                @click="
                  () => {
                    setRenaming(null);
                    setError('');
                  }
                "
              >
                Cancel
              </button>
              <button
                type="submit"
                class="primary-button"
                :disabled="busy || !name.trim()"
              >
                Rename
              </button>
            </div>
          </form>
        </div>
      </DialogBoundary>
    </template>
  </aside>
</template>
