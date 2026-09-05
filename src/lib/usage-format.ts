export function formatUsageNumber(value: number | undefined, digits = 2): string {
  if (value == null) return '—';
  if (value !== 0 && Math.abs(value) < 0.01) {
    return value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatUsageBytes(bytes: number | undefined): string {
  if (bytes == null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;
  const unit = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  const maximumFractionDigits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toLocaleString(undefined, { maximumFractionDigits })} ${units[unit]}`;
}
