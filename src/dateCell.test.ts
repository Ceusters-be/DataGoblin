import { expect, it } from 'vitest';
import { nowForColumn } from './dateCell';
const now = new Date(2026,10,13,11,25,39,628);
it('formats local date and time values according to their column type', () => {
  expect(nowForColumn('date',now)).toBe('2026-11-13');
  expect(nowForColumn('time(3) without time zone',now)).toBe('11:25:39.628');
  expect(nowForColumn('datetime2',now)).toBe('2026-11-13T11:25:39.628');
  expect(nowForColumn('timestamp(3) without time zone',now)).toBe('2026-11-13T11:25:39.628');
  expect(nowForColumn('smalldatetime',now)).toBe('2026-11-13T11:25:00');
});
it('preserves the current instant for time-zone-aware columns', () => {
  expect(nowForColumn('datetimeoffset',now)).toBe(now.toISOString());
  expect(nowForColumn('timestamp(6) with time zone',now)).toBe(now.toISOString());
  const offset=-now.getTimezoneOffset(), sign=offset>=0?'+':'-';
  const zone=sign+String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')+':'+String(Math.abs(offset)%60).padStart(2,'0');
  expect(nowForColumn('time(3) with time zone',now)).toBe('11:25:39.628'+zone);
});
