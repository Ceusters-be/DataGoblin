import { expect, it } from 'vitest';
import { formatCellJson } from './cellValue';
it('formats JSON without rounding numbers or dropping duplicate keys', () => {
  const input = '{"id":9007199254740993,"id":1.2300,"nested":[true,null,{}]}';
  expect(formatCellJson(input)).toBe('{\n  "id": 9007199254740993,\n  "id": 1.2300,\n  "nested": [\n    true,\n    null,\n    {}\n  ]\n}');
});
it('preserves punctuation and escapes inside strings and rejects malformed JSON', () => {
  const input = JSON.stringify({ text: 'a \"quote\" {,:} \\ and newline\n' });
  expect(JSON.parse(formatCellJson(input)!)).toEqual(JSON.parse(input));
  expect(formatCellJson('{broken')).toBeNull();
  expect(formatCellJson('')).toBeNull();
  expect(formatCellJson('null')).toBe('null');
});
