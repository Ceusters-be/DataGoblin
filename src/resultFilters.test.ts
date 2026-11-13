import { expect, it } from 'vitest';
import { matchesFilter } from './resultFilters';

it('compares large integers without rounding and handles text operators', () => {
  expect(matchesFilter('9007199254740993', { operator: 'greater', value: '9007199254740992' })).toBe(true);
  expect(matchesFilter('9007199254740992', { operator: 'greater', value: '9007199254740993' })).toBe(false);
  expect(matchesFilter('Hello WORLD', { operator: 'startsWith', value: 'hello' })).toBe(true);
  expect(matchesFilter('Hello WORLD', { operator: 'endsWith', value: 'world' })).toBe(true);
  expect(matchesFilter('NULL', { operator: 'isNull', value: '' })).toBe(false);
  expect(matchesFilter(null, { operator: 'notEquals', value: '' })).toBe(false);
  expect(matchesFilter('', { operator: 'isEmpty', value: '' })).toBe(true);
});
