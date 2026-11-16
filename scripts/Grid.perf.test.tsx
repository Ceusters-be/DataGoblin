import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
// @vitest-environment jsdom
import { it, vi } from 'vitest';
import { render, cleanup, fireEvent } from '../src/testUtils';
import ResultsGrid from '../src/ResultsGrid.vue';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
it.skipIf(process.env.DATAGOBLIN_GRID_PERF !== '1')('measures default page mount and cell selection', async () => {
  const data = { columns: Array.from({length:20}, (_,i)=>`column${i}`), rows: Array.from({length:500},(_,r)=>Array.from({length:20},(_,c)=>`value ${r}:${c}`)), affected:null };
  mkdirSync('performance-results', { recursive: true });
  const samples = [];
  for(let i=0;i<5;i++) {
    const start=performance.now(); const {container}=await render(<ResultsGrid data={data} onExport={vi.fn()}/>);
    const mountMs=performance.now()-start; const cells=container.querySelectorAll('td[data-row]');
    const selectStart=performance.now(); await fireEvent.click(cells[10]); const selectMs=performance.now()-selectStart;
    samples.push({mountMs,selectMs,cells:cells.length}); cleanup();
  }
  writeFileSync(process.env.DATAGOBLIN_GRID_REPORT ?? 'performance-results/grid.json', JSON.stringify(samples, null, 2));
},30000);
