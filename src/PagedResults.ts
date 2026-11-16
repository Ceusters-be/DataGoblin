export function defaultPageSize() {
  try {
    const saved = Number(localStorage.getItem('datagoblin.pageSize') ?? 500);
    return Number.isInteger(saved) && saved >= 0 && saved <= 10000 ? saved : 500;
  } catch {
    return 500;
  }
}
