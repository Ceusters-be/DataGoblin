# DataGrip UI reference for DataGoblin

Inspected live on Windows, 12 November 2026. This document records the installed application's visible UI and the menus opened during the walkthrough. It is not a claim that every DataGrip feature was tested. No SQL was executed, result values edited, connection settings changed, or settings applied. Tree expansion, selection, and focus changed during inspection. The Files panel was hidden again and the inspected schema collapsed at the end.

## 1. The target experience

The reference is **Islands Light**, confirmed in Appearance settings. **Compact mode is off**. The dense appearance therefore comes primarily from the layout, small controls, and information hierarchy rather than the compact-mode preference.

DataGoblin should feel like a focused database workbench: quiet surrounding chrome, a navigable object tree, a dominant editor, a separate full-width output area, and contextual actions. Keep the DataGoblin identity and its deliberately smaller SQL Server/PostgreSQL scope. Reproduce interaction patterns and visual proportions using our own components and artwork.

Evidence labels used below:

- **Observed:** directly visible in the live application or a menu/settings screen opened during this walkthrough.
- **Proposed:** a DataGoblin implementation decision informed by those observations.
- **Not verified:** behavior that would require another walkthrough or execution test.

## 2. Workspace structure and visual proportions

**Observed**

- One shallow application header spans the window. It contains the application mark, hamburger menu, project selector, Version Control menu, tool-window toggles, and global controls.
- Three principal work areas were visible initially: left Database Explorer, center editor, and bottom Database Output.
- Opening Files adds a fourth island on the right and reduces the center editor's width. Output remains full width below all three upper islands.
- Rounded outer corners belong to the islands. Internal editor and grid surfaces use straight edges and subtle separators.
- Narrow background gutters distinguish panels; there are no oversized resize handles or native textarea resize corners.
- The editor tab strip sits inside the editor island. Its execution toolbar occupies a separate row directly beneath it.
- Output has its own title/tab strip, then its own action toolbar, then column headers and data.
- A bottom status bar shows breadcrumbs on the left and editor context on the right, including position, CRLF, UTF-8, and four-space indentation.
- The active statement has a subtle background and success indicator. Its last execution duration is displayed inline near the SQL, and also beside the output's console context.

**Approximate visual measurements**, not extracted application design tokens; affected by window/display scaling:

| Element | Observed approximate size | Proposed DataGoblin target |
|---|---:|---:|
| Outer gutter | 5–8 px | 6–8 px |
| Island radius | 10–12 px | 10 px |
| Editor execution toolbar | 34–36 px | 32 px |
| Tree row | 24 px | 24–26 px |
| Grid row | 27 px | 26–28 px |
| Main small icons | 14–16 px | 14–16 px |
| Tool-window title strip | Around 40 px | 34–38 px |
| Menu row | 24–27 px | 26–28 px |

Do not mistake the captured blue pointer glow for application styling.

## 3. Database Explorer

**Observed hierarchy**

Connection → database → schema → object-type folder → object → metadata folder.

The expanded schema contained Tables, Views, and Routines, with muted counts beside their labels. The expanded table contained Columns, Keys, Foreign Keys, Indexes, and Defaults, also with counts. Database Objects and Server Objects appear at the appropriate parent levels. Virtual views have a separate node.

Several databases are visible simultaneously beneath one server. Small badges beside databases show a selected/available count such as “1 of 22”; the exact selection workflow was not inspected. This is materially different from presenting one database dropdown above a disconnected schema list.

Rows have small chevrons, an object-specific outline icon, a name, and optional muted metadata. The selected row uses a low-radius blue highlight. Long names can extend beyond the visible pane; both horizontal and vertical scrollbars are available. Tree controls are compact and aligned consistently rather than being cards with large padding.

The explorer has a title row and a compact toolbar containing add, data-source/connection controls, refresh, console/data actions, and DDL. Some icon meanings were not confirmed by tooltip and should not be inferred solely from their glyphs.

**Table context menu opened and read**

New; Modify Table; Copy/Paste; Edit Data; Refresh; Join Across Data Sources; Rename; Set Color; Quick Documentation; Compare Schema Structure With; Navigation; Find Usages; Introspection Level; SQL Scripts; Object Actions; Tools; Import/Export; Diagrams; Diagnostics; Drop.

Observed shortcuts include Modify Table Ctrl+F6, Edit Data F4, Refresh Ctrl+F5, Rename Shift+F6, Quick Documentation Ctrl+Q, Compare Ctrl+D, Find Usages Alt+F7, and Drop Delete. These actions were read, not invoked.

**Proposed**

Make the explorer a single coherent connection/database/schema tree. Start with Tables and Views; add metadata folders when supported. Preserve lazy metadata loading. Keep table/schema search available without dedicating excessive vertical space to controls. Treat explorer selection and the active query's execution context as separate state: browsing another object should not silently retarget an existing query. Keep the query database selector authoritative for execution.

For DataGoblin's initial context menu, prioritize Open Query, Copy Qualified Name, Refresh, View Columns/Keys, and connection settings. Do not add nonfunctional DataGrip menu items just to resemble the screenshot.

## 4. Editor tabs and execution toolbar

**Observed**

Tabs are short, inset, rounded rectangles with a leading type icon, compact label/context, and a small close icon. The active tab uses a restrained tint/outline. Large unused space in the tab row remains quiet.

The execution toolbar is a single horizontal strip. Run is a green outline triangle; other actions are small icons separated into groups. History is a clock icon. Transaction mode appears as the compact text dropdown “Tx: Auto”. A stop square and a “Playground” dropdown appear in the same strip. Database selection sits at the far right, with a small database icon, name, and chevron. Some execution icons were visible but their exact actions were not verified.

**Tab context menu opened and read**

Close (Ctrl+F4), Close Other Tabs, Close All Tabs, Add to Agent Context, Copy Path/Reference, Split Right, Split Down, Pin Tab, Open Tab in New Window (Shift+F4), Configure Editor Tabs, Reopen Closed Tab, Shorten Tab Titles (checked), Duplicate, Bookmarks, Override File Type, Export Data to File, Open In, Local History, Rename File.

**Proposed**

Preserve the user's chosen DataGoblin order: Run → separator → Cancel → History. Add tooltips with shortcuts and visible keyboard focus. Keep execution context concise. Add tab context actions for Close, Close Others, Close All, Pin, Rename, Duplicate, and Reopen Closed Tab before implementing detachable windows or editor splits. Closing the final query must retain DataGoblin's empty state.

## 5. Database selector

**Observed by opening the dropdown**

- Anchored directly below the toolbar's database control.
- Narrow custom popup with rounded corners and a soft shadow.
- Current database uses a blue selection background.
- Introspected databases appear first.
- A divider and muted “Non-Introspected” section precede the remaining databases.
- Items are single-line rows with consistent padding.
- Escape dismisses without changing the selected database.
- The observed popup has no permanently visible search field.

**Proposed**

Keep DataGoblin's searchable custom select for long lists. Match the compact trigger and row treatment; group loaded metadata separately from other available databases where useful. Clamp the popup to the viewport and allow scrolling. Avoid changing server from this control. Search, active keyboard item, and selected value must remain distinct states.

## 6. Query history

**Observed by clicking the clock**

A separate centered Query History window opens. Its title names the connection. The left side contains compact execution entries; the right side previews SQL with syntax highlighting and line numbers. Bottom actions are Paste and Close. In the inspected history, only one entry was available. Escape closed the window without inserting SQL.

The visible title and single entry do not establish whether DataGrip history is scoped per connection or per console internally.

**Proposed**

Adopt the master/detail presentation if the existing DataGoblin history becomes crowded, but retain the user's explicit requirement: history per query only. Show database, timestamp, duration, and error/success in the entry list. Restore/Paste should not execute SQL automatically. Keep the preview read-only.

## 7. Database Output and results grid

**Observed**

- Output occupies an independent full-width bottom island.
- The header includes an Output tab and a named result tab using database/schema/table context.
- A console name and execution duration appear at the header's right, next to small window controls.
- A second toolbar groups grid, data, transaction, DDL, and other actions on the left; SQL, CSV/export, view, and settings controls are on the right.
- Column headers are a subtly darker band, with metadata/key icons before names and funnel/sort indicators toward the right edge.
- Primary and foreign key columns have distinct icon treatments.
- Row numbers occupy a narrow muted gutter.
- Numeric values are right-aligned; ordinary strings are left-aligned.
- A selected cell has a stronger blue fill, while the surrounding row has a much weaker highlight.
- Cell borders are thin and low contrast. No strong alternating stripe pattern was visible.
- NULL is displayed as muted italic `<null>`, distinguishable from an empty string.
- The data font is monospace. Horizontal scrolling belongs to the grid, not the whole workspace.

**Result-cell context menu opened and read**

Edit (Enter), Show Record View (Ctrl+Shift+Enter), Open in Value Editor (Shift+Enter), Show Aggregate View, Revert Selected, Set Highlighting Language, Change Display Type, Edit as SQL Expression, Set SQL Expression, Copy (Ctrl+C), Change Data Extractor (CSV), Copy Aggregation Result (SUM) (Ctrl+Shift+C), Paste (Ctrl+V), Add Row (Alt+Insert), Delete Row (Ctrl+Y), Clone Row (Ctrl+D), Go To, Full-Text Search, Export Table to Clipboard, Set Local Filter, Local Filter By Cell Value, Quick Documentation (Ctrl+Q).

The **Go To submenu** contains Navigation Bar (Alt+Home), Database Explorer (Alt+Shift+B), DDL (Ctrl+Alt+B), Row (Ctrl+G), Related Rows (F4), Open URL, and Open File URL. Related Rows was observed as a command, not invoked; navigation behavior was not tested.

**Grid settings menu opened and read**

Show Value Editor (Shift+Enter), Show Aggregate View, Paste Format, Reset View, View Query, Copy Query to Console, Copy Query to Clipboard, Open Data Views Settings.

**Proposed**

Keep DataGoblin read-only result behavior unless editing is separately designed. Prioritize an actual cell/row context menu, named result tabs, Copy Cell/Row, Open Value Viewer, Local Filter by This Value, Related Records, and View SQL. Keep query execution separate from grid selection. Do not attach destructive commands to familiar shortcuts without explicitly supporting and explaining their behavior.

## 8. Paging and row counts

**Observed by opening the floating pager**

The control floats near the bottom center of the result grid, above the horizontal scrollbar. The existing result has fewer than a full page, so it displays a row total rather than a full page range. Opening the readout shows:

Count Rows; Page Size heading; 10; 100; 250; 500 Default (checked); 1,000; All; Custom; Set as Default.

The menu opens upward when close to the bottom of the window. No size/count action was chosen.

Data Editor and Viewer settings confirmed a 500-row page limit and pagination position “Grid bottom (floating)”.

**Proposed**

Retain DataGoblin's bounded fetching and separate count query. Copy the floating placement and small readout rather than adding a large footer bar. Keep unknown total (`501+`) distinct from an exact total. All must be an explicit load action. A visual match must never regress into fetching every row merely to populate a count.

## 9. Local filter popover

**Observed by clicking a header funnel**

The popover title is “Local Filter For 'column'”. It contains an initially focused search input, a select-all checkbox with Value/Count headings, individual value checkboxes with counts, and bottom help text: “Select a checkbox to filter rows”. NULL is a listed value. The list takes the available vertical space. There is no prominent Apply button in the inspected local filter. The popup stays on screen even though its anchor is in the lower half of the window; it can extend upward beyond the header. Escape closes it.

No checkbox was toggled, so immediate filtering semantics were not tested. The inspected popup did not show DataGoblin's advanced-condition or Local/Database scope controls.

**Proposed**

Retain DataGoblin's local value filtering and optional database conditions. Use the compact value-list presentation by default; keep advanced/database controls secondary. Search and footer remain fixed while only values scroll. Constrain total height to the viewport. Show local scope explicitly so users know whether counts represent loaded rows or the database.

## 10. Files panel and tool-window behavior

**Observed**

Clicking the folder tool-window icon opens Files as a right island. It has a title with dropdown, several small controls, overflow menu, and hide control. Its tree shows the project root and Scratches and Consoles. Expanding the latter reveals Database Consoles and Extensions.

The overflow menu contains Behavior, Appearance, Sort By, Edit Scopes, Speed Search (Ctrl+F or any symbol), Group Tabs (checked), View Mode, Move To, Resize, Remove from Sidebar, and Help. Submenus were not expanded. Clicking the top folder icon again hides Files and returns space to the editor. No query tab was closed by this action.

**Proposed**

Make Saved Queries a toggleable tool window with remembered width. Add the same show/hide mechanism for Explorer and Results. Hiding a panel must not close queries, cancel executions, or discard results. Expose layout reset in settings. Full docking and floating windows can follow later.

## 11. Preferences confirmed in the installed application

These are observed current values, not universal DataGrip defaults.

| Area | Setting | Observed value |
|---|---|---|
| Appearance | Theme | Islands Light |
| Appearance | Sync with OS | Off |
| Appearance | Editor color scheme | Light, theme default |
| Appearance | Custom UI font | Off; disabled field displays Inter 13 |
| Appearance | Compact mode | Off |
| Appearance | Different tool-window background | Off |
| Appearance | Project colors in main toolbar | On |
| Appearance | Keep popups open for toggle items | On |
| Appearance | Smooth scrolling | On |
| Appearance | Mnemonics in controls/menu; menu icons | On |
| Appearance | Main menu | Hidden under hamburger button |
| Data editor | Limit page size | On, 500 |
| Data editor | Result set prefetch size | 100 |
| Data editor | Filter history size | 10 |
| Data editor | Maximum bytes loaded per value | 204800 |
| Data editor | Preview rows | First 10 |
| Data editor | Pagination position | Grid bottom (floating) |
| Data editor | Quick actions popup for cells | On |
| Data editor | Custom data font | Off; disabled fields show JetBrains Mono, 13, line height 1.2 |
| Data editor | Alternate row colors | Off |
| Explorer | Remember whether filter is on | On |
| Explorer | Database colors | On for explorer, tab headers, toolbars; off for editor backgrounds |
| Query execution | Execute shortcut | Ctrl+Enter |
| Query execution | Caret inside statement | Ask what to execute |
| Query execution | Caret outside statement | Nothing |
| Query execution | Selection | Visible value begins “Exactly as separate stateme…”; clipped |
| Query execution | Open results in new tab | Off |
| Query execution | Review parameters | On |
| Query execution | Show execution time in editor | On |
| Query execution | Warn before potentially unsafe queries | On |

Settings use a search field and category tree on the left, a breadcrumb/title and grouped form on the right, and OK/Cancel/Apply at the bottom. Apply remained disabled; Cancel was used to leave.

## 12. Shared interaction rules to implement

**Proposed specification**

1. One visual language for context menus, selects, popovers, and dropdown menus: shared radius, border, shadow, row sizing, focus color, disabled treatment, and separators.
2. Hover, selected, keyboard-active, disabled, running, and error states must be distinguishable.
3. Menus show shortcuts in a muted right-hand column. Submenu arrows align at the far edge. Optional icons occupy a consistent leading column.
4. Escape dismisses the topmost popup and returns focus to its trigger. Nested popups must not close their parents accidentally.
5. Menus reposition at viewport edges. Long lists scroll internally. Search fields and bottom actions stay visible.
6. Panel layout survives reopening and window resize. Use restrained gutter splitters, not large handles.
7. Explorer browsing must not mutate an active query's connection. Each tab retains its own server and database.
8. Execution actions describe their scope consistently: current statement/selection versus whole query. Never silently change scope depending on which UI invoked the action.
9. Result-level actions remain attached to the result that produced them, even after switching editor tabs.
10. Show real supported functionality only. DataGrip has a much wider feature scope; copying every icon would add confusion and maintenance cost.

## 13. DataGoblin implementation order

The comparison below uses the existing project work from this conversation, not a fresh live walkthrough of DataGoblin in this inspection.

| Priority | Change | Existing foundation | Acceptance criteria |
|---|---|---|---|
| 1 | Unified explorer hierarchy | Compact rows, search, cached schemas | Multiple databases under a server; lazy expansion; browsing does not retarget editor |
| 1 | Toggleable tool windows | Resizable island layout | Explorer/Queries/Results can hide and reopen without losing state; remembered widths |
| 1 | Unified menu components | Custom Select and several specialized popovers | Consistent rows/focus/placement; nested Escape; viewport-safe keyboard operation |
| 1 | Named output tabs and context | Result-set selector and query-scoped results | Clear result identity; output/messages view; switching never shows another query's result |
| 2 | Tab context menu | Pin/rename/delete in saved-query list | Close/Others/All, Pin, Rename, Duplicate, Reopen; empty workspace supported |
| 2 | Result-cell context menu | Copy, local filters, value viewer, FK navigation | Useful actions at the selected cell; keyboard alternatives; no accidental editing |
| 2 | Density and typography pass | Themes, compact toolbar, islands | Consistent 24–28px rows, restrained chrome, readable focus and disabled states |
| 2 | Inline execution feedback | Duration/error in results and history | Duration near executed statement, clear running/cancelled/error feedback |
| 3 | Structured metadata groups | Column/PK/FK metadata | Columns/Keys/Foreign Keys; indexes/views where backend supports them |
| 3 | Preferences organization | Theme/storage settings | Searchable or categorized Appearance, Editor, Results, Queries; no settings sprawl |
| Later | Editor splits / docking / record view | Not established | Separate designs and behavior tests before adding commands |

## 14. Validation checklist for the implementation

- Test mouse and keyboard entry into each popup; arrows, Enter, Escape, Tab, and disabled controls.
- Check nested popovers inside filter menus and at all viewport edges.
- Verify layout with both sidebars open, each sidebar hidden, low window width, and zero queries.
- Verify long server/database/table/query names and a large explorer tree.
- Check all supported DataGoblin themes, including actual dark-theme contrast.
- Check SQL Server and PostgreSQL context switching without losing query contents or executing SQL.
- Reconfirm bounded paging, separate COUNT, cancellation, and explicit All after UI changes.
- Verify that result-context actions use the correct source result and row after sorting/filtering/tab switches.

## 15. Limits and follow-up observations

Not inspected or tested here: actual query execution/cancellation; paging to another page; COUNT SQL strategy; sort behavior; checking filter values; related-record opening; connection editor/authentication; SQL autocomplete and template expansion; transaction changes; editing cells; export execution; editor splits and dragging/resizing; empty workspace; restart persistence; every preference submenu; dark theme. The exact DataGrip version/build was not obtained.

Menu presence is evidence of a visible affordance, not proof of its runtime behavior. Performance settings above must not be interpreted as measured performance. Visual dimensions are estimates, not pixel-perfect specifications.

The strongest next implementation slice is the explorer hierarchy plus independent query context, followed by toggleable panels and common context menus. Those changes address the everyday interaction model that makes DataGrip feel like an editor rather than a collection of forms.
