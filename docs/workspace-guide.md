# DataGoblin workspace guide

[Back to the project overview](../README.md) · [Release guide](releases.md)

A lightweight desktop SQL workbench for **PostgreSQL** and **Microsoft SQL Server**.
Built with Tauri 2, Rust, Nuxt 4, Vue 3, TypeScript, and CodeMirror 6.

## Run locally

Install Node.js (22.12+ or a supported newer LTS), Rust stable, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.
Windows needs the Visual Studio C++ build tools and WebView2. macOS needs Xcode command-line
tools. Linux needs WebKitGTK 4.1, GTK 3, OpenSSL, libdbus development packages, and an active
Secret Service provider (for example GNOME Keyring) to remember passwords.

```sh
npm ci
npm run desktop
```

`npm run dev` runs Nuxt at http://localhost:1420; database and filesystem features require the desktop app.

The frontend is native Vue 3, mounted by `app/app.vue`. Screens in `src/` are `.vue`
single-file components using `<script setup lang="ts">` and `<template>`. Shared logic
and composables live in `.ts` modules; the SQL editor is `src/Editor.vue`. JSX remains
only in test fixtures. There is no React runtime. Nuxt runs with `ssr: false` because the workbench uses Tauri IPC and
local browser APIs. `npm run build` checks TypeScript and generates `.output/public`,
which Tauri embeds in the desktop executable; no Node server is needed at runtime.

## First connection

1. Click **+** in Explorer.
2. Choose PostgreSQL or SQL Server and enter a host, port, initial database, and username/password.
3. Leave TLS enabled for encrypted connections. Only enable “Trust self-signed certificate” for a server you trust. Local PostgreSQL installations without TLS need TLS unchecked.
4. Test the connection, then add it.
5. Click the count beside a server to select databases, then the count beside a database to select schemas. Expand a table to load column metadata. SQL Server defaults to `master` and `dbo`; PostgreSQL uses the configured database and `public`. Selections are remembered locally per connection/database. Selected schemas group Tables, Views and Routines with counts. Enter or clicking outside the picker applies changes; Escape cancels.
6. Use the small query icon beside a table to open a bounded SELECT query, or write your own SQL.

## Implemented

- Saved server profiles and database switching, schema/table/view explorer, column types and nullability.
- PostgreSQL and SQL Server password authentication; TLS with certificate verification enabled by default.
- Per-tab database selection, syntax highlighting, keyword/table completion, and column completion for expanded tables.
- Ctrl/Cmd+Alt+L formats the selection or entire query using the active SQL dialect.
- `sel` then Tab expands `select * from …;`.
- Ctrl/Cmd+Enter runs the selected text or current semicolon-delimited statement.
- **Run all** executes the full tab. Multiple returned result sets can be selected.
- Query cancellation by closing the operation's connection, 120-second timeout, paged query results backed by a temporary disk cache.
- Automatic SQL-file saving, a saved-query library grouped by server/database, configurable storage, and local recovery drafts.
- Native dialogs to import/export SQL files.
- Results with text selection/copy, NULL indicators, and CSV export of displayed rows.
- Edit source-table values directly in supported JOIN results, with shared drafts for repeated source rows and one transaction across all source tables.
- Ctrl/Cmd+S saves, Ctrl/Cmd+/ comments, Ctrl/Cmd+F finds, Ctrl+Space completes.

Single-table `SELECT * FROM table WHERE ...` results support editing when the table has a supported primary key. The original scalar predicate is retained for refresh, sorting, counts and filter-value choices. Subqueries, batches and additional clauses are not inferred as editable by this parser.

## Editing JOIN results

Run a `SELECT *` over two or more different base tables using `JOIN` or `INNER JOIN`:

```sql
SELECT *
FROM Agreement a
INNER JOIN AgreementPartyRole apr
    ON a.AgreementId = apr.AgreementId;
```

All source tables must have a primary key with supported scalar types. Result columns are
labeled by source alias (`a.Name`, `apr.Role`), including columns with duplicate names.
Double-click a supported non-key cell to edit it. Every loaded occurrence of the same
source row shows the shared draft. Preview pending changes to see the target tables
and parameterized updates, then apply. All updates commit together; a conflicting
change to an edited value or a failed constraint rolls back the entire submission.
The exact original query is refreshed after saving, regardless of subsequent editor changes.

This first version supports updates only, including composite primary keys, `WHERE`
filters and `ORDER BY`. Explicit projections, expressions, aggregates, CTEs, subqueries,
outer joins, self-joins and views remain read-only.
Primary keys, generated columns and unsupported data types cannot be edited. Hover
the **Read-only result** label for an explanation when a result cannot be mapped safely.

`scripts/validate-join-edits.ps1` verifies source routing, repeated-row deduplication,
transaction rollback and concurrent-change detection against disposable PostgreSQL
and SQL Server containers. It does not read saved application connections.

## Credential storage

Connection profiles are stored in `connections.json` in Tauri's application configuration
directory for `dev.datagoblin.desktop`. The profile schema contains no password field.
Saved passwords use Windows Credential Manager, macOS Keychain, or Linux Secret Service
through the Rust keyring library, under the service name `DataGoblin`.
Unchecking “Remember password” removes an existing stored credential and retains the entered password
only for the current app session. An unavailable credential store produces an error; passwords
are never silently written to a plain-text fallback.

## Query library

Queries with content autosave after 600 ms of inactivity and before closing a tab or the app.
Empty or whitespace-only editors do not create library files or overwrite previously saved content.
Closing the last tab leaves an empty workspace, which stays empty on restart. Use **Create query**,
**Import SQL file**, or the saved-query pane to open an editor; browsing databases does not create tabs.
Ctrl/Cmd+S saves immediately without a file dialog. Rename a query using the name field
in the editor toolbar. Reopen closed queries from **Saved Queries** in the right-hand pane;
their connection and database selection are restored.
Right-click a query (or use its three-dot button / Shift+F10) to **Pin/Unpin**, **Rename**,
or **Delete** it. Pinned queries appear at the top and stay pinned after restart.
Deleting a query closes its editor tab and removes its SQL file and library entry.
A recovery copy is retained under `.datagoblin/trash/` in the same library folder.
Running queries must be stopped before deletion.

New drafts use the lowest available name: **Query1, Query2, Query3…**. Only open tabs and saved
queries reserve numbers; closing an empty tab frees its number, including after restart.
Drafts with content are saved under `Unsaved/` in the active library folder, including
when a custom folder is selected. “Unsaved” means not yet named, not missing from disk.
Renaming a draft moves it to its server/database group. The right pane shows the active
folder, supports searching queries, and keeps unnamed drafts separate from named queries.

The default folder is `queries` inside DataGoblin's platform-specific app-data directory.
Open **Settings → Query storage** to see the full path, choose another folder, or reset
to the default. Changes copy the current managed library, preserve the original files,
and refuse to overwrite different destination queries.

Named files are grouped as `server/database/query.sql`; safe names and ID suffixes prevent
collisions. Queries without a connection go under `Unassigned`. A hidden `.datagoblin`
directory contains query metadata and recovery text. Back up the entire library folder,
including this directory. Renaming a managed query or changing its database relocates its file.
Imported SQL files become library copies; exporting creates a separate SQL file.

Recovery drafts are also saved in the local WebView's storage. SQL text can contain sensitive
literals; neither the query library nor draft storage is a credential vault.

## Current limitations

This is an initial working implementation, not a DataGrip replacement.

- Each execution opens a fresh connection. Session settings, temp tables, and transactions do not
  persist across separate executions. Run dependent statements together in one batch.
- Cancelling, timing out, or reaching the result limit closes the connection. This does not guarantee
  the server immediately stops a command or rolls back previously committed writes. Later statements
  in a batch may not complete. Use explicit SQL limits for large reads.
- The result budget limits retained rows/values, not the driver's peak allocation for a single large value.
- Database, schema and object lists load in 500-row metadata batches, restricted to the selected databases and schemas. Column/key metadata loads on demand and retains the separate 1,000-row per-request limit.
- SQL Server GO separators and advanced procedural statement splitting are not implemented; select the
  complete batch or use Run all. SQL Server affected-row counts are not yet displayed.
- Windows integrated/Entra authentication and SSH tunnels are not implemented.
- Query-library writes are intended for one running DataGoblin instance. Concurrent external editing
  of an open query or cloud-sync conflicts are not merged automatically.
- GitHub Releases provides Windows, macOS and Linux packages. OS code signing and Apple notarization are not configured; installation and update behavior still need verification on each target system.

## Checks and builds

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build
```

Use `npm run tauri -- build --debug --no-bundle` for a faster development executable.
Installers are generated in `src-tauri/target/release/bundle/`.
Build separately on each OS. Updater packages are signed; OS code signing and notarization are not configured. See the [release guide](releases.md).

The CI workflow runs tests and builds the desktop binary on Windows, macOS, and Linux.
Tests cover SQL statement selection/escaping, CSV output, connection/password UI behavior,
autosave, reopening, folder settings, migration conflicts, safe paths, and SQL Server value
serialization. They do not replace live PostgreSQL/SQL Server integration testing.

## Code layout

The results grid supports header sorting (ascending, descending, then original order),
dragging column edges to resize, and double-clicking an edge to fit its contents.
Select a cell or row number and use the copy buttons or Ctrl/Cmd+C; rows copy as
tab-separated text, with NULL represented as `NULL`. Empty strings have a separate
visual label. CSV export follows the displayed sort order and exports NULL as an empty
field. Each header has a filter button and an always-visible sort indicator at the right.
Plain table queries offer a Local / Database filter toggle, defaulting to Local, and database sorting (see below). Other query
shapes use local filters on loaded rows: checkboxes apply immediately, advanced
conditions support text/comparison operators, and filters combine with AND.
Local filters persist across pages; All applies them to the full loaded result.
CSV always exports the displayed page.

For plain SELECT * FROM table queries in the current database, column headers load
primary/foreign-key flags asynchronously from system catalogs. Gold keys denote
primary keys; blue links denote foreign keys; composite/shared keys can show both.
Unsupported query shapes and unavailable metadata are labelled as unavailable rather
than guessed from column names. Metadata lookups have a separate 10-second timeout.

The first page is returned after its rows plus one lookahead row are fetched. A
bounded driver channel pauses result consumption until another page is requested.
The same database stream stays open: paging does not rerun SQL or repeat writes.
Previously fetched rows are cached in an anonymous temporary file for backward
navigation. Totals such as 501+ mean the end has not been reached; Last is enabled
once the total is known. Database execution and small driver/network buffers can
still run ahead; this does not rewrite SQL or guarantee server-side computation stops.

The pager floats at the bottom centre of the grid. Clicking the row range opens an
upward menu with 10/100/250/500/1,000 presets, custom sizes up to 10,000, All, and
Set as default. The initial request uses the saved default (500 initially).
Clicking an unknown total runs a separate scalar COUNT_BIG(*) (SQL Server) or
COUNT(*) (PostgreSQL) on the same server/database, leaving the original result stream
paused and the current page unchanged. This currently supports single, plain
SELECT * FROM table statements, including schema-qualified/quoted names, and their
applied database filters. Other
query shapes report that an explicit COUNT query is needed; they never fall back to
fetching rows. The count is a separate database snapshot and can differ if data changes. All fetches and displays the entire result, subject to the
cache limits below. Large grids render only the visible rows while copy/export/sort
still operate on the full loaded page. Next result set consumes the rest of the
current set to reach the next one in a batch. Row numbering continues across pages.

Each execution cache holds up to 1,000,000 rows or 128 MiB of serialized data. If the
limit is reached, the displayed total has a + suffix and only cached rows are available.
The four most recently used result sessions are retained; older sessions expire with
an explicit message. Cancel, rerunning a query, changing its database, closing its tab,
or exiting the app closes the stream and releases its temporary file. An idle stream
expires after 10 minutes; each fetch has a 120-second timeout. A timeout or server error
leaves previously cached full pages readable, but fetching further needs a new run.
Results are not saved across restarts. Explorer catalog lists use 500-row batches;
individual metadata requests retain the separate 1,000-row / 8-MiB limit. Automated tests exercise backpressure, page boundaries,
result sets, cancellation and UI behavior; live database timing is not benchmarked.

- `src/App.tsx`: desktop workspace and connection management.
- `src/Editor.tsx`: editor, completion, and shortcuts.
- `src/ResultsGrid.tsx`: result filtering/sorting, column resizing, key markers, selection and copying.
- `src-tauri/src/column_keys.rs`: SQL Server/PostgreSQL key catalog lookups.
- `src/PagedResults.tsx`: page navigation, page sizes and defaults.
- `src-tauri/src/result_cache.rs`: temporary result files and indexed page retrieval.
- `src-tauri/src/count_query.rs`: safe table-count SQL construction.
- `src-tauri/src/result_session.rs`: demand-driven streams, fetch requests and session lifecycle.
- `src/sql.ts`: metadata queries, identifier quoting, and statement selection.
- `src-tauri/src/main.rs`: desktop commands, settings, credential store, and cancellation.
- `src-tauri/src/database.rs`: database adapters and bounded result streaming.
- `src/useQueryLibrary.ts`: queued autosave, recovery drafts, and close handling.
- `src-tauri/src/library.rs`: atomic query-file storage and folder migration.


### Database-wide table browsing

Plain `SELECT * FROM table` statements and explorer table previews enable database
filters and sorting. The filter popover defaults to Local, which immediately filters
loaded rows without a server request. Switch to Database for table-wide filtering.
Local and applied database filters are separate; local filters narrow the current
page of database results. A fresh database execution resets local page filters.
Database filter values are bound parameters; columns are validated against
table metadata. Applying a filter or sort closes the previous stream and starts a new
first page without changing the SQL editor. Primary keys provide sorting tie-breakers
when available. View SQL shows the generated statement and bound values.

The Database filter popover queries distinct values and counts across the table,
respecting other column filters. Search is debounced and each response is capped at
100 values. Select multiple values, then Apply selection. Advanced conditions use
native database types and collation. Clicking the total runs a separate scalar count
with the same applied filters; it does not fetch the remaining result rows.

Joins, CTEs, batches, and other query shapes retain local page filters and sorting.
CSV exports the displayed page. A failed database filter leaves the previous rows
visible with their original filter state and closes paging; rerun to recover.
Counts and value lists use separate connections and can change with concurrent writes.
Database filtering is covered by generated-SQL and UI tests; live database performance
and provider-specific complex column types have not been verified.


### Cell value viewer

Double-click a result cell, or focus it and press Enter, to open its full value in a
read-only side panel. JSON values are formatted with syntax highlighting and folding;
Raw text shows the original representation. Search opens the viewer search bar.
Copy value always copies the original cell text, preserving numeric precision and
whitespace. SQL NULL and empty strings have distinct labels. Escape or the close
button returns focus to the cell. Changing the loaded page closes the viewer.


### Query history

The history icon in the query toolbar lists executions for that query, newest first.
History follows the saved query ID across renames and reopening. Only executions
linked to the current query are shown. Search SQL,
server/database names, execution status or error messages. Select an entry to inspect
its SQL and error, then Open in new query to recover it in a new draft with its original
connection and database. Recovery never executes SQL. A removed connection must be
selected again before execution.

History stores SQL text, context, timestamp, request duration and outcome in
`query-history.json` under the platform app-data folder. Atomic writes retain at most
1,000 entries and 16 MiB, pruning oldest entries. Connection credentials and result
rows are not stored; SQL and database error text are stored as written. Oversized
entries and storage errors are reported without changing the query outcome.
History captures the initial editor execution response: paged results explicitly show
First page ready and time to that page. Later paging/cancellation and internal metadata,
filter, or count requests are not additional history entries.


### Foreign-key navigation

For plain table results and database-filtered table results, non-NULL foreign-key
cells show a link button. Choose a relationship to open its referenced record in a new
query tab on the same server/database. Composite keys use all participating columns;
a NULL component reports that no reference exists. Multiple relationships on a column
are listed separately. Navigation reads the original cached row, so local sorting and
filtering do not change its identity. Lookups bind values as parameters and use catalog
metadata for the target table and columns. Target results support paging and further
foreign-key navigation; the source tab stays open. SQL in the new editor can also be
rerun, although arbitrary filtered editor SQL retains the existing metadata limitations.
Missing rows and lookup failures are reported. Live SQL Server/PostgreSQL navigation
has not been verified against a server.


### Live performance validation

Run `./scripts/validate-performance.ps1` with Docker Desktop in Linux container mode.
It creates disposable PostgreSQL 17 and SQL Server 2022 Developer containers on random
localhost ports, seeds one million indexed rows with 192-byte payloads, and exercises
the production Rust drivers, table-query builder, and result sessions. It does not
read saved connections or touch user databases. Containers are removed in `finally`.
The script uses the locally available image tags named in the script; Docker may pull
them if absent. SQL Server Developer accepts its container EULA for this test instance.

Checks cover three first/next/cached-page iterations, forward traversal to row 100,001,
independent counts without draining the stream, parameterized filtering and typed
sorting, distinct-value search/counts, NULL and escaped-literal filters, filtered All,
server-confirmed cancellation of a slow request, and the 128-MiB cache limit for All.
Each engine has a five-minute test timeout; server cancellation must complete within
five seconds. Other timing samples establish a baseline rather than machine-dependent
pass/fail thresholds. JSON reports are saved under `performance-results/<timestamp>`.

These are debug-build backend integration measurements on local containers, not UI
rendering measurements, WAN/TLS benchmarks, or guarantees for production query plans.
Forward jumps consume intermediate rows; they are not database OFFSET queries.
The cache limit bounds serialized temporary-file data, not total process memory.
PostgreSQL cancellation now sends the driver's explicit cancel request; merely closing
the connection did not promptly interrupt `pg_sleep` in the initial live run.


### Appearance and keyboard polish

Settings > Appearance offers Daylight, Midnight, and System (default).
The choice applies immediately and is remembered on the device. System follows OS
light/dark changes. Shared semantic colours cover the workspace, grid, menus, SQL
editor, generated SQL, and JSON viewer. Editor theme switching preserves the document,
selection and undo history. Main text, muted labels, primary actions and syntax colours
use the selected light or dark palette.

The workspace now uses compact editor chrome, consistent controls and focus rings,
shared popover surfaces, quieter empty states, and themed scrollbars. Reduced-motion
preferences disable animations. Modal dialogs support Escape, focus restoration and
Tab containment; in-progress settings/connection operations cannot be dismissed.
Popover menus preserve their existing arrow navigation and restore focus on Escape.

Additional shortcuts: Ctrl/Cmd+, opens settings; Ctrl/Cmd+Shift+H opens query history;
Ctrl/Cmd+Alt+N creates a query; Ctrl/Cmd+Page Up/Down switches query tabs. The shortcuts
dialog lists these alongside existing SQL editor bindings. These workspace shortcuts
are suppressed while a modal dialog is open.


### Resizable workspace islands

The explorer, editor and saved-query library occupy separate rounded panels with
small gutters. Results form a full-width bottom panel. Drag the dividers to change
sidebar widths or the editor/results split; use arrow keys (Shift for larger steps),
Home/End, or double-click to reset a divider. Sizes are saved locally and constrained
on window resize so the editor and results remain usable. With no queries open, the
top panels use the full height. The old browser-native corner resize grip is removed.

### Vim mode

Enable **Settings > Editor > Vim mode** for Vim motions and modal SQL editing.
The preference is remembered and applies to open editors without losing their text
or undo history. The editor displays the current mode. Use `i` to insert, `Esc` for
Normal mode, `w`/`b` for words, `ciw` to change a word, and `u` to undo. SQL completion
and the `sel` snippet work in Insert mode. Run/Save shortcuts remain available;
`:w` saves through the query library. Ctrl+A uses Vim's numeric increment in Vim mode.
