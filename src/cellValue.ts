// Format tokens without converting numbers or discarding duplicate object keys.
export function formatCellJson(value: string): string | null {
  try { JSON.parse(value); } catch { return null; }
  const tokens = value.match(/"(?:\\.|[^"\\])*"|[^\s{}\[\],:]+|[{}\[\],:]/g) ?? [];
  let depth = 0;
  const output: string[] = [];
  const newline = () => output.push('\n' + '  '.repeat(depth));
  tokens.forEach((token, index) => {
    if (token === '{' || token === '[') {
      output.push(token); depth++;
      if (tokens[index + 1] !== '}' && tokens[index + 1] !== ']') newline();
    } else if (token === '}' || token === ']') {
      depth--;
      if (tokens[index - 1] !== '{' && tokens[index - 1] !== '[') newline();
      output.push(token);
    } else if (token === ',') { output.push(token); newline(); }
    else if (token === ':') output.push(': ');
    else output.push(token);
  });
  return output.join('');
}
