export type FilterOperator = 'in' | 'contains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'greater' | 'less' | 'isNull' | 'notNull' | 'isEmpty';
export interface ColumnFilter { operator: FilterOperator; value: string; values?: (string | null)[] }

export function compareValues(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (/^[+-]?\d+$/.test(a) && /^[+-]?\d+$/.test(b)) return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
  if (a.trim() && b.trim() && Number.isFinite(Number(a)) && Number.isFinite(Number(b))) return Number(a) - Number(b);
  return a.localeCompare(b, undefined, { numeric: true });
}

export function matchesFilter(value: string | null, filter: ColumnFilter): boolean {
  if (filter.operator === 'in') return (filter.values ?? []).includes(value);
  if (filter.operator === 'isNull') return value === null;
  if (filter.operator === 'notNull') return value !== null;
  if (filter.operator === 'isEmpty') return value === '';
  if (value === null) return false;
  const text = value.toLocaleLowerCase(), operand = filter.value.toLocaleLowerCase();
  switch (filter.operator) {
    case 'contains': return text.includes(operand);
    case 'equals': return text === operand;
    case 'notEquals': return text !== operand;
    case 'startsWith': return text.startsWith(operand);
    case 'endsWith': return text.endsWith(operand);
    case 'greater': return compareValues(value, filter.value) > 0;
    case 'less': return compareValues(value, filter.value) < 0;
  }
}
