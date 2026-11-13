// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryOutput, appendLog, resultEvents, sqlEvent, timestamp } from './QueryOutput';
afterEach(cleanup);
it('formats local timestamps with milliseconds and aligns multiline SQL', () => {
  expect(timestamp(new Date(2026,10,13,11,25,39,628).getTime())).toBe('2026-11-13 11:25:39:628');
  expect(sqlEvent('db','select *\nfrom items').text).toBe('db> select *\n    from items');
});
it('appends output, bounds the log and preserves errors until a new execution', () => {
  let log=appendLog(undefined,'db',[{text:'Failed',kind:'error',at:1}]);
  log=appendLog(log,'db',[{text:'Details',at:2}]); expect(log.failed).toBe(true);
  log=appendLog(log,'db',[sqlEvent('db','SELECT 1')]); expect(log.failed).toBe(false); expect(log.entries[0].text).toBe('Failed');
  log=appendLog(log,'db',Array.from({length:2001},(_,i)=>({text:String(i)}))); expect(log.entries).toHaveLength(2000); expect(log.entries[0].text).toBe('1');
});
it('reports fetched page rows rather than total rows and does not invent affected counts', () => {
  const event=resultEvents({sets:[{columns:['id'],rows:[['1'],['2']],totalRows:10000,hasMore:true,affected:null}],elapsedMs:42,truncated:false})[0];
  expect(event.text).toBe('2 rows retrieved starting from 1 (more rows available) in 42 ms');
  expect(resultEvents({sets:[],elapsedMs:9,truncated:false})[0].text).toBe('Completed in 9 ms');
  expect(resultEvents({sets:[{columns:[],rows:[],affected:1}],elapsedMs:18,truncated:false})[0].text).toBe('1 row affected in 18 ms');
});
it('renders timestamps, SQL, bound parameters and errors as selectable text', () => {
  const log=appendLog(undefined,'db',[sqlEvent('db','UPDATE t SET value=$1',["x'\ny"]),{kind:'error',text:'Constraint failed'}]);
  render(<QueryOutput log={log}/>);
  expect(screen.getByRole('log',{name:'Execution log'})).toBeTruthy();
  expect(screen.getByText(/Parameters: 1 =/).textContent).toContain(JSON.stringify("x'\ny"));
  expect(screen.getByText('Constraint failed').closest('.execution-log-entry')?.className).toContain('error');
  expect(document.querySelectorAll('time')).toHaveLength(2);
});
