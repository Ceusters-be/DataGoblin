// Zone-less database values use the user's local wall clock. Zoned values include an offset.
export function nowForColumn(type: string, now = new Date()): string {
  const normalized = type.toLowerCase().replace(/\(\d+\)/g, '').trim();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(),3)}`;
  if (normalized === 'date') return date;
  if (normalized === 'time') return time;
  if (normalized === 'time without time zone') return time;
  if (normalized === 'time with time zone') {
    const offset = -now.getTimezoneOffset();
    return `${time}${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset)/60))}:${pad(Math.abs(offset)%60)}`;
  }
  if (normalized === 'datetimeoffset' || normalized === 'timestamp with time zone') return now.toISOString();
  if (normalized === 'smalldatetime') return `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
  return `${date}T${time}`;
}
