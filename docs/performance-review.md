# Performance review — 2026-11-16

## Changes implemented

The default 500-row result page previously mounted every cell. The grid now uses
its existing virtual window above 100 rows, including the normal 250/500/1000-row
presets. Unedited rows also reuse their value arrays rather than cloning every
cell and looking up nonexistent edits. Sorting and filtering still operate on the
entire loaded page; export includes all matching loaded rows.

Cached result reads now use a buffered reader and reuse the decoding buffer.
Contiguous rows no longer issue an individual seek and file read for every row.
Indexed seeks remain for gaps between result sets. Regression tests cover large
rows, interleaved sets, backward reads, and appending after buffered reads.

## Measurements before the Nuxt migration

Local Windows development machine, with other applications and database containers
running. These are diagnostic samples, not production latency guarantees.

| Measurement | Before | After |
| --- | ---: | ---: |
| Mounted data cells, 500 rows × 20 columns, initial 600px viewport | 10,000 | 900 |
| Grid mount, jsdom median of 5 samples | 1,320 ms | 71 ms |
| Cell selection, jsdom median of 5 samples | 798 ms | 47 ms |
| Cached 500-row read, Rust debug median of 20 samples | 2.226 ms | 1.001 ms |
| Cached 10,000-row read, Rust debug median of 20 samples | 45.256 ms | 19.817 ms |

The grid samples were separate before/after runs, so CPU contention, warmup, and
garbage collection can affect the timing difference. jsdom does not measure browser
layout, paint, frame rate, or Tauri startup. The deterministic reduction in mounted
cells is the strongest result. Cache comparisons alternate the previous unbuffered
implementation and the new implementation, discard the first pair, and verify
identical rows. Cache timing excludes IPC and database execution.

## Database baseline

The existing live suite passed for PostgreSQL 17 and SQL Server 2022, each with one
million indexed rows and 192-byte payloads. This baseline used the original cache
implementation, before the optimization. Reports are in the ignored local directory
`performance-results/20261116-110232/`.

| Check | PostgreSQL | SQL Server |
| --- | ---: | ---: |
| First 500 rows, median of 3 | 191 ms | 60 ms |
| Next 500 rows, median of 3 | 49 ms | 48 ms |
| Cached previous page, median of 3 | 18 ms | 9 ms |
| Forward jump to row 100,001, one sample | 6.34 s | 15.48 s |
| Load All until cache limit, one sample | 38.23 s | 119.82 s |

Counts, filters, typed sorting, distinct-value queries, NULL handling, cancellation,
and the cache limit passed. These local debug-driver results include database and
container costs and should not be compared directly with isolated cache timings.

## Remaining opportunities

1. **Deep forward jumps:** the stream consumes every intermediate row. Consider
   keyset pagination for table browsing with a stable unique ordering. Preserve
   stream behavior for arbitrary SQL and explicitly address consistency when data
   changes before adopting a different paging strategy.
2. **Large All loads:** the 128-MiB file limit does not bound decoded memory or IPC
   payload size. `result_session::State::fetch` also rereads first-page data into
   result metadata on every request and duplicates requested rows for finite first
   pages. Leaner response metadata and streaming exports deserve a separate API
   change and measurement.
3. **Startup:** the production JavaScript bundle is approximately 1.11 MB minified
   (344 KB gzip). SQL formatting is imported eagerly. Loading optional features on
   demand may help startup, but actual WebView startup/parse measurements should
   guide that change.
4. **Very wide tables:** only rows are virtualized. Horizontal virtualization may
   help hundreds of columns; profile representative tables before adding complexity.

The frontend timing samples above were taken before the subsequent native Nuxt/Vue
migration. They document the virtualization improvement, not Vue-versus-React speed.
The benchmark now mounts native Vue components and can be rerun with the command below.

## Validation and reproduction

- 167 frontend tests passed, including virtual scrolling, keyboard focus across the
  mounted window, full export, paging/count errors, and editing tests.
- Production TypeScript build passed; the migrated app also passes Nuxt static generation.
- 29 Rust tests passed; opt-in live/edit/performance tests are skipped by default.
- Both database baseline integration tests passed.
- The opt-in cache comparison passed with identical old/new output.

```powershell
npm test -- --exclude tmp/**
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml result_cache::performance -- --ignored --nocapture
$env:DATAGOBLIN_GRID_PERF = '1'
npx vitest run scripts/Grid.perf.test.tsx
Remove-Item Env:DATAGOBLIN_GRID_PERF
./scripts/validate-performance.ps1
```

The opt-in grid benchmark writes `performance-results/grid.json`. Set
`DATAGOBLIN_GRID_REPORT` to an alternate existing-directory path to preserve another
sample. No saved database connections are used by the live validation script.
