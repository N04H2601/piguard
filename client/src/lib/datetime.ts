export function formatLocalDateTime(value: unknown, fallback = 'Never'): string {
  if (value === null || value === undefined || value === '') return fallback;

  if (typeof value === 'number') {
    return new Date(value).toLocaleString();
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) return fallback;

  if (/^\d+$/.test(trimmed)) {
    return new Date(Number(trimmed)).toLocaleString();
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toLocaleString();
}
