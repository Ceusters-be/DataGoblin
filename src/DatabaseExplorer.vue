<script setup lang="ts">
import { Column } from './types';
import { type TableMetadata } from './TableMetadataFolders';
import { type MenuPosition, type MenuAction } from './ContextMenu';
import { shallowRef, computed } from 'vue';
import { stateSetter, watchMounted } from './vueLifecycle';
import ExplorerScopePicker from './ExplorerScopePicker.vue';
import { defaultDatabase, defaultSchema, scopeNames, isRoutine, type ExplorerScope, type ScopeChoice } from './explorerScope';
import ContextMenu from './ContextMenu.vue';
import { menuPosition } from './ContextMenu';
import { quoteIdentifier } from './sql';
import TableMetadataFolders from './TableMetadataFolders.vue';
import {
  ChevronRight,
  Database,
  FileCode2,
  Folder,
  Network,
  Server,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Table2,
  X,
} from '@lucide/vue';
import type { Connection, Table } from './types';
import { contextKey, tableKey } from './DatabaseExplorer';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  reveal?: {
    connection: Connection;
    table: Table;
    id: string;
  };
  scope?: ExplorerScope;
  schemas?: Record<string, string[]>;
  routines?: Record<string, Table[]>;
  onRefreshSchema?: (connection: Connection, schema: string) => Promise<boolean | undefined>;
  onScopeChange?: (connection: Connection, level: 'databases' | 'schemas', choice: ScopeChoice) => Promise<void>;
  connections: Connection[];
  databases: Record<string, string[]>;
  tables: Record<string, Table[]>;
  objects: Record<string, Record<string, TableMetadata>>;
  columns: Record<string, Record<string, Column[]>>;
  onBrowse: (
    connection: Connection,
    force?: boolean,
  ) => Promise<boolean | undefined>;
  onColumns: (
    connection: Connection,
    table: Table,
    force?: boolean,
  ) => Promise<void>;
  onSelect: (connection: Connection) => void;
  onOpen: (connection: Connection, table?: Table) => void | Promise<void>;
  onEdit: (connection: Connection) => void;
  onNew: () => void;
}>();
const connections = computed(() => _props.connections);
const databases = computed(() => _props.databases);
const tables = computed(() => _props.tables);
const columns = computed(() => _props.columns);
const objects = computed(() => _props.objects);
const onBrowse = computed(() => _props.onBrowse);
const onColumns = computed(() => _props.onColumns);
const onSelect = computed(() => _props.onSelect);
const onOpen = computed(() => _props.onOpen);
const onEdit = computed(() => _props.onEdit);
const onNew = computed(() => _props.onNew);
const reveal = computed(() => _props.reveal);
const treeRoot = shallowRef<HTMLElement | null>(null);
const tableMenu = shallowRef<{
  c: Connection;
  table: Table;
  position: MenuPosition;
} | null>(null);
const nodeMenu = shallowRef<{ c: Connection; level: 'server' | 'database' | 'schema'; schema?: string; position: MenuPosition } | null>(null);
function serverContext(c: Connection): Connection {
  return { ...c, database: chosenDatabases(c)[0] ?? defaultDatabase(c) };
}
function serverBusy(c: Connection) {
  return Object.entries(pending.value).some(([key, busy]) => busy && JSON.parse(key)[0] === c.id);
}
async function refreshServer(c: Connection) {
  const first = serverContext(c);
  await load(first, true);
  await Promise.all(chosenDatabases(c).filter(name => name !== first.database).map(database => load({ ...c, database }, true)));
}
const nodeMenuActions = computed<MenuAction[]>(() => {
  const menu = nodeMenu.value;
  if (!menu) return [];
  const server = menu.level === 'server';
  const c = server ? serverContext(menu.c) : menu.c;
  return [
    { label: 'New query', icon: FileCode2, action: () => onOpen.value(c) },
    { label: 'Refresh', icon: RefreshCw, disabled: server ? serverBusy(menu.c) : !!pending.value[contextKey(c)],
      action: () => { if (server) void refreshServer(menu.c); else void load(c, true, menu.schema); } },
    ...(_props.scope ? [{ label: server ? 'Choose databases…' : 'Choose schemas…', icon: Database, separator: true,
      action: () => { void showPicker(menu.position.origin, menu.c, server ? 'databases' : 'schemas'); } }] : []),
    ...(server ? [{ label: 'Edit connection', icon: Settings2, separator: true, action: () => onEdit.value(menu.c) }] : []),
  ];
});
function showNodeMenu(event: MouseEvent, c: Connection, level: 'server' | 'database' | 'schema', schema?: string) {
  tableMenu.value = null;
  nodeMenu.value = { c, level, schema, position: menuPosition(event) };
}
function nodeMenuKey(event: KeyboardEvent, c: Connection, level: 'server' | 'database' | 'schema', schema?: string) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  event.stopPropagation();
  const origin = event.target as HTMLElement;
  const rect = origin.getBoundingClientRect();
  tableMenu.value = null;
  nodeMenu.value = { c, level, schema, position: { x: rect.left, y: rect.bottom, origin } };
}
const setTableMenu = stateSetter(tableMenu);
const message = shallowRef('');
const setMessage = stateSetter(message);
const open = shallowRef<Record<string, boolean>>({});
const setOpen = stateSetter(open);
const selected = shallowRef<Connection | undefined>();
const setSelected = stateSetter(selected);
const filter = shallowRef('');
const setFilter = stateSetter(filter);
const pending = shallowRef<Record<string, boolean>>({});
const setPending = stateSetter(pending);
const errors = shallowRef<Record<string, boolean>>({});
const setErrors = stateSetter(errors);
watchMounted(
  () => {
    const _reveal = reveal.value;
    return [_reveal];
  },
  () => {
    const _reveal2 = reveal.value;
    const _onColumns = onColumns.value;
    if (!_reveal2) return;
    const c = _reveal2.connection,
      t = _reveal2.table,
      key = contextKey(c),
      schemaKey = key + ':schema:' + t.schema;
    setFilter('');
    setSelected(c);
    setOpen((prev) => ({
      ...prev,
      [c.id]: true,
      [key]: true,
      [schemaKey]: true,
      [schemaKey +
      ':' +
      (t.kind.toUpperCase().includes('VIEW') ? 'Views' : 'Tables')]: true,
      [key + tableKey(t)]: true,
    }));
    void _onColumns(c, t);
    const timer = window.setTimeout(() => {
      const node = treeRoot.value?.querySelector<HTMLElement>(
        '[data-editor-reveal="true"]',
      );
      node?.scrollIntoView?.({
        block: 'nearest',
      });
      node?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  },
);
const term = computed(() => {
  const _filter = filter.value;
  return _filter.trim().toLowerCase();
});
const toggle = (key: string) =>
  setOpen((prev) => ({
    ...prev,
    [key]: !prev[key],
  }));
async function load(c: Connection, force = false, schema?: string) {
  const _pending = pending.value;
  const _onBrowse = onBrowse.value;
  const key = contextKey(c);
  if (_pending[key]) return;
  setPending((prev) => ({
    ...prev,
    [key]: true,
  }));
  setErrors((prev) => ({
    ...prev,
    [key]: false,
  }));
  try {
    const result = schema && _props.onRefreshSchema ? await _props.onRefreshSchema(c, schema) : await _onBrowse(c, force);
    if (result === false)
      setErrors((prev) => ({
        ...prev,
        [key]: true,
      }));
  } catch {
    setErrors((prev) => ({
      ...prev,
      [key]: true,
    }));
  } finally {
    setPending((prev) => ({
      ...prev,
      [key]: false,
    }));
  }
}
function select(c: Connection) {
  const _onSelect = onSelect.value;
  setSelected(c);
  _onSelect(c);
}
const picker = shallowRef<{ c: Connection; level: 'databases' | 'schemas'; origin: HTMLElement } | null>(null);
function availableDatabases(c: Connection) {
  return databases.value[c.id] ?? [defaultDatabase(c)];
}
function chosenDatabases(c: Connection) {
  if (!_props.scope) return [...new Set([c.database, ...(databases.value[c.id] ?? [])])];
  const available = availableDatabases(c);
  return scopeNames(_props.scope.databases[c.id], available, [available.includes(defaultDatabase(c)) ? defaultDatabase(c) : c.database]);
}
function availableSchemas(c: Connection) {
  return _props.schemas?.[contextKey(c)] ?? [...new Set((tables.value[contextKey(c)] ?? []).map(t => t.schema))];
}
function chosenSchemas(c: Connection) {
  const available = availableSchemas(c);
  return _props.scope ? scopeNames(_props.scope.schemas[contextKey(c)], available, [defaultSchema(c.engine)]) : available;
}
async function openPicker(event: MouseEvent, c: Connection, level: 'databases' | 'schemas') {
  await showPicker(event.currentTarget as HTMLElement, c, level);
}
async function showPicker(origin: HTMLElement, c: Connection, level: 'databases' | 'schemas') {
  await load(c);
  picker.value = { c, level, origin };
}
async function applyScope(choice: ScopeChoice) {
  const active = picker.value;
  if (!active) return;
  picker.value = null;
  active.origin.focus();
  await _props.onScopeChange?.(active.c, active.level, choice);
}
async function toggleServer(c: Connection) {
  const wasOpen = open.value[c.id];
  toggle(c.id);
  if (wasOpen) return;
  const first = { ...c, database: chosenDatabases(c)[0] ?? defaultDatabase(c) };
  select(first);
  await load(first);
  const selected = chosenDatabases(c);
  if (selected[0]) setOpen(prev => ({ ...prev, [contextKey({ ...c, database: selected[0] })]: true }));
  await Promise.all(selected.map(database => load({ ...c, database })));
}
const navigator = globalThis.navigator;
function databaseNodes(server: Connection) {
  const names = [...new Set([
    ...chosenDatabases(server),
    ...(reveal.value?.connection.id === server.id ? [reveal.value.connection.database] : []),
  ])];
  return names.map((name) => {
    const connection = { ...server, database: name };
    const key = contextKey(connection);
    const loaded = tables.value[key];
    const matches = [...(loaded ?? []), ...(_props.routines?.[key] ?? [])].filter((table) =>
      (table.schema + '.' + table.name).toLowerCase().includes(term.value),
    );
    const schemas = [...new Set([...chosenSchemas(connection), ...(reveal.value?.connection.id === server.id && reveal.value.connection.database === name ? [reveal.value.table.schema] : [])])].filter(schema => !term.value || matches.some(t => t.schema === schema)).map(
      (name) => {
        const schemaTables = matches.filter((table) => table.schema === name);
        const schemaKey = key + ':schema:' + name;
        const groups = ['Tables', 'Views', 'Routines']
          .map((name) => ({
            name,
            key: schemaKey + ':' + name,
            tables: schemaTables
              .filter(
                (table) =>
                  (isRoutine(table.kind) ? 'Routines' : table.kind.toUpperCase().includes('VIEW')
                    ? 'Views'
                    : 'Tables') === name,
              )
              .map((table) => ({
                table,
                key: isRoutine(table.kind) ? JSON.stringify([table.schema, table.name, table.kind]) : tableKey(table),
                expansionKey: key + tableKey(table),
              })),
          }));
        return { name, key: schemaKey, count: schemaTables.length, groups };
      },
    );
    return { connection, key, loaded: !!loaded, schemas };
  });
}
function toggleDatabase(connection: Connection) {
  const key = contextKey(connection);
  const wasOpen = open.value[key];
  select(connection);
  toggle(key);
  if (!wasOpen) void load(connection);
}
const openingRoutines = shallowRef(new Set<string>());
function routineKey(c: Connection, routine: Table) { return JSON.stringify([c.id, c.database, routine.schema, routine.name, routine.kind]); }
async function openRoutine(c: Connection, routine: Table) {
  const key = routineKey(c, routine);
  if (openingRoutines.value.has(key)) return;
  openingRoutines.value = new Set([...openingRoutines.value, key]);
  try { await onOpen.value(c, routine); }
  finally { const next = new Set(openingRoutines.value); next.delete(key); openingRoutines.value = next; }
}
function toggleTable(connection: Connection, table: Table, key: string) {
  const wasOpen = open.value[key];
  toggle(key);
  if (!wasOpen) void onColumns.value(connection, table);
}
function showTableMenu(
  event: MouseEvent,
  connection: Connection,
  table: Table,
) {
  nodeMenu.value = null;
  setTableMenu({ c: connection, table, position: menuPosition(event) });
}
function tableMenuKey(
  event: KeyboardEvent,
  connection: Connection,
  table: Table,
) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
    return;
  event.preventDefault();
  const origin = event.target as HTMLElement;
  const rect = origin.getBoundingClientRect();
  nodeMenu.value = null;
  setTableMenu({
    c: connection,
    table,
    position: { x: rect.left, y: rect.bottom, origin },
  });
}
</script>

<template>
  <aside ref="treeRoot" class="sidebar database-explorer">
    <div class="section-title">
      Database Explorer
      <div>
        <button
          class="icon-button"
          title="Refresh schema"
          :disabled="!selected || !!pending[contextKey(selected)]"
          @click="
            () => {
              const _selected2 = selected!;
              return _selected2 && void load(_selected2, true);
            }
          "
        >
          <RefreshCw :size="14"></RefreshCw>
        </button>
        <button class="icon-button" title="New connection" @click="onNew">
          <Plus :size="16"></Plus>
        </button>
      </div>
    </div>
    <template v-if="connections.length > 0">
      <div class="explorer-search search">
        <Search :size="14"></Search>
        <input
          aria-label="Filter tables"
          placeholder="Find table or schema…"
          :value="filter"
          @input="
            (event) => setFilter((event.target as HTMLInputElement).value)
          "
          @keydown="
            (event) => {
              if (event.key === 'Escape') {
                setFilter('');
                event.stopPropagation();
              }
            }
          "
        />
        <template v-if="filter">
          <button
            class="icon-button"
            title="Clear table search"
            @click="() => setFilter('')"
          >
            <X :size="13"></X>
          </button>
        </template>
      </div>
      <div class="tree-heading">
        <span>{{ term ? 'Search in expanded databases' : 'Connections' }}</span>
        <button
          class="icon-button"
          title="Collapse all schemas"
          :disabled="!!term"
          @click="
            () =>
              setOpen((prev) =>
                Object.fromEntries(
                  Object.entries(prev).filter(
                    ([key]) => !key.includes(':schema:'),
                  ),
                ),
              )
          "
        >
          <ChevronRight :size="13"></ChevronRight>
        </button>
      </div>
    </template>
    <div class="tree">
      <template v-for="c in connections" :key="c.id">
        <div class="explorer-server">
          <div class="explorer-node-row"
            @contextmenu.stop.prevent="showNodeMenu($event, c, 'server')"
            @keydown="nodeMenuKey($event, c, 'server')">
            <button
              class="explorer-node"
              :aria-label="c.name"
              :aria-expanded="!!open[c.id]"
              :title="`${c.name} · ${c.engine === 'postgres' ? 'PostgreSQL' : 'SQL Server'} · ${c.host}`"
              @click="toggleServer(c)"
            >
              <ChevronRight
                :size="12"
                :class="open[c.id] ? 'rotated' : ''"
              ></ChevronRight>
              <Server :size="15" class="object-server"></Server>
              <span>{{ c.name }}</span>
            </button>
            <button v-if="scope" class="explorer-scope-count" :aria-label="'Choose databases on ' + c.name" @click="openPicker($event, c, 'databases')">{{ chosenDatabases(c).length }} of {{ databases[c.id]?.length ?? '…' }}</button>
            <button
              class="icon-button peek"
              :title="'Edit ' + c.name"
              @click="
                () => {
                  const _onEdit = onEdit!;
                  return _onEdit(c);
                }
              "
            >
              <Settings2 :size="13"></Settings2>
            </button>
          </div>
          <template v-if="open[c.id]">
            <div class="explorer-children">
              <template
                v-for="database in databaseNodes(c)"
                :key="database.key"
              >
                <div class="explorer-database">
                  <div
                    @contextmenu.stop.prevent="showNodeMenu($event, database.connection, 'database')"
                    @keydown="nodeMenuKey($event, database.connection, 'database')"
                    :class="[
                      'explorer-node-row',
                      {
                        selected:
                          selected && contextKey(selected) === database.key,
                      },
                    ]"
                  >
                    <button
                      class="explorer-node"
                      :aria-label="
                        'Database ' +
                        database.connection.database +
                        ' on ' +
                        c.name
                      "
                      :aria-expanded="!!open[database.key]"
                      @click="toggleDatabase(database.connection)"
                    >
                      <ChevronRight
                        :size="12"
                        :class="{ rotated: open[database.key] }"
                      />
                      <Database :size="14" class="object-database" />
                      <span>{{ database.connection.database }}</span>
                    </button>
                    <button v-if="scope" class="explorer-scope-count" :aria-label="'Choose schemas in ' + database.connection.database" @click="openPicker($event, database.connection, 'schemas')">{{ chosenSchemas(database.connection).length }} of {{ schemas?.[database.key]?.length ?? '…' }}</button>
                    <button
                      class="icon-button peek"
                      :title="'New query in ' + database.connection.database"
                      @click="onOpen(database.connection)"
                    >
                      <Plus :size="13" />
                    </button>
                  </div>
                  <div v-if="open[database.key]" class="explorer-children">
                    <p
                      v-if="pending[database.key]"
                      class="explorer-inline-state"
                      role="status"
                    >
                      Loading…
                    </p>
                    <p
                      v-if="errors[database.key]"
                      class="explorer-inline-state"
                    >
                      Could not load database.
                      <button @click="load(database.connection, true)">
                        Retry
                      </button>
                    </p>
                    <p
                      v-if="
                        !pending[database.key] &&
                        !errors[database.key] &&
                        database.loaded &&
                        !database.schemas.length
                      "
                      class="explorer-inline-state"
                    >
                      {{
                        term
                          ? 'No matching tables or views.'
                          : 'No tables or views.'
                      }}
                    </p>
                    <details
                      v-for="schema in database.schemas"
                      :key="schema.key"
                      :open="!!term || !!open[schema.key]"
                    >
                      <summary @click.prevent="!term && toggle(schema.key)"
                        @contextmenu.stop.prevent="showNodeMenu($event, database.connection, 'schema', schema.name)"
                        @keydown="nodeMenuKey($event, database.connection, 'schema', schema.name)">
                        <ChevronRight :size="12" />
                        <Network :size="14" class="object-schema" />
                        <strong>{{ schema.name }}</strong>
                        <span>{{ schema.count }}</span>
                      </summary>
                      <details
                        v-for="group in schema.groups"
                        :key="group.key"
                        class="explorer-object-group"
                        :open="!!term || !!open[group.key]"
                      >
                        <summary @click.prevent="!term && toggle(group.key)">
                          <ChevronRight :size="12" />
                          <Folder :size="14" class="object-folder" />
                          <strong>{{ group.name }}</strong>
                          <span>{{ group.tables.length }}</span>
                        </summary>
                        <div v-for="node in group.tables" :key="node.key">
                          <button v-if="isRoutine(node.table.kind)" class="explorer-routine"
                            :title="'Open ' + node.table.kind.toLowerCase() + ' definition'"
                            :aria-label="'Open routine ' + node.table.schema + '.' + node.table.name"
                            :disabled="openingRoutines.has(routineKey(database.connection, node.table))"
                            :aria-busy="openingRoutines.has(routineKey(database.connection, node.table))"
                            @click="openRoutine(database.connection, node.table)"><FileCode2 :size="14" /><span>{{ node.table.name }}</span></button>
                          <div v-else
                            class="table-row"
                            @contextmenu.prevent="
                              showTableMenu(
                                $event,
                                database.connection,
                                node.table,
                              )
                            "
                            @keydown="
                              tableMenuKey(
                                $event,
                                database.connection,
                                node.table,
                              )
                            "
                          >
                            <button
                              :data-editor-reveal="
                                reveal &&
                                contextKey(reveal.connection) ===
                                  database.key &&
                                tableKey(reveal.table) === node.key
                                  ? 'true'
                                  : undefined
                              "
                              :aria-label="
                                'Expand columns for ' +
                                node.table.schema +
                                '.' +
                                node.table.name
                              "
                              :aria-expanded="!!open[node.expansionKey]"
                              @click="
                                toggleTable(
                                  database.connection,
                                  node.table,
                                  node.expansionKey,
                                )
                              "
                              @dblclick="
                                onOpen(database.connection, node.table)
                              "
                              title="Expand table metadata; double-click to open query"
                            >
                              <ChevronRight
                                :size="12"
                                :class="{ rotated: open[node.expansionKey] }"
                              />
                              <Table2 :size="14" class="object-table" />
                              <span>{{ node.table.name }}</span>
                            </button>
                            <button
                              class="icon-button peek"
                              title="Open SELECT query"
                              @click="onOpen(database.connection, node.table)"
                            >
                              <FileCode2 :size="13" />
                            </button>
                          </div>
                          <TableMetadataFolders
                            v-if="!isRoutine(node.table.kind) && open[node.expansionKey]"
                            :columns="columns[database.key]?.[node.key] ?? []"
                            :metadata="objects[database.key]?.[node.key]"
                            @retry="onColumns(database.connection, node.table)"
                          />
                        </div>
                      </details>
                    </details>
                  </div>
                </div>
              </template>
            </div>
          </template>
        </div>
      </template>
      <template v-if="!connections.length">
        <div class="explorer-empty">
          <Database :size="28"></Database>
          <p>Your databases live here.</p>
          <small>
            Add a connection to explore schemas, tables, and columns.
          </small>
          <button class="text-button" @click="onNew">
            <Plus :size="14"></Plus>
            Add connection
          </button>
        </div>
      </template>
    </div>
    <ExplorerScopePicker v-if="picker" :key="picker.level + contextKey(picker.c)"
      :label="picker.level === 'databases' ? 'Databases on ' + picker.c.name : 'Schemas in ' + picker.c.database"
      :names="picker.level === 'databases' ? availableDatabases(picker.c) : availableSchemas(picker.c)"
      :selected="picker.level === 'databases' ? chosenDatabases(picker.c) : chosenSchemas(picker.c)"
      :all="scope?.[picker.level][picker.level === 'databases' ? picker.c.id : contextKey(picker.c)] === null"
      :origin="picker.origin" @apply="applyScope" @close="picker = null" />
    <template v-if="message">
      <p class="explorer-inline-state" role="status">{{ message }}</p>
    </template>
    <ContextMenu v-if="nodeMenu" :position="nodeMenu.position"
      :label="nodeMenu.level === 'server' ? 'Server actions for ' + nodeMenu.c.name : nodeMenu.level === 'schema' ? 'Schema actions for ' + nodeMenu.schema : 'Database actions for ' + nodeMenu.c.database"
      :actions="nodeMenuActions" @close="nodeMenu = null" />
    <template v-if="tableMenu">
      <ContextMenu
        :position="tableMenu.position"
        :label="'Table actions for ' + tableMenu.table.name"
        @close="() => setTableMenu(null)"
        :actions="
          ((_onOpen2, _tableMenu, _pending3, _onColumns3) => [
            {
              label: 'Open query',
              icon: FileCode2,
              action: () => _onOpen2(_tableMenu.c, _tableMenu.table),
            },
            {
              label: 'Copy qualified name',
              action: () => {
                const { c, table } = _tableMenu;
                void navigator.clipboard
                  .writeText(
                    `${quoteIdentifier(table.schema, c.engine)}.${quoteIdentifier(table.name, c.engine)}`,
                  )
                  .then(() => setMessage('Table name copied.'))
                  .catch(() => setMessage('Could not access the clipboard.'));
              },
            },
            {
              label: 'Refresh metadata',
              separator: true,
              icon: RefreshCw,
              disabled: !!_pending3[contextKey(_tableMenu.c)],
              action: () => {
                const { c, table } = _tableMenu;
                void _onColumns3(c, table, true);
              },
            },
          ])(onOpen, tableMenu, pending, onColumns)
        "
      ></ContextMenu>
    </template>
  </aside>
</template>

<style scoped>
.explorer-scope-count { flex-shrink: 0; padding: 1px 4px; margin-right: 4px; font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 3px; background: transparent; white-space: nowrap; }
.explorer-scope-count:hover { color: var(--accent); border-color: var(--accent); }
.explorer-routine { width: 100%; justify-content: flex-start; text-align: left; display: flex; align-items: center; gap: 6px; padding: 4px 12px 4px 30px; }
</style>
