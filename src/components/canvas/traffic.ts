/**
 * Request count → edge motion. A log scale on requests per hour, because a
 * linear one makes every small app look dead next to one busy one. Zero or
 * unknown traffic gets nothing: motion on the canvas is evidence, never
 * decoration.
 */
export function particles(requests24h: number | undefined) {
  const perHour =
    requests24h && Number.isFinite(requests24h) && requests24h > 0 ? requests24h / 24 : 0;
  if (perHour === 0) return { count: 0, durationS: 0, strokeWidth: 1 };
  const count = Math.min(4, Math.max(1, Math.ceil(Math.log10(perHour + 1))));
  return { count, durationS: 2.8 - count * 0.35, strokeWidth: 1 + count * 0.5 };
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** An edge's hover label: its real count, or nothing at all. */
export function edgeLabel(requests24h: number | undefined): string | undefined {
  if (requests24h === undefined || !Number.isFinite(requests24h)) return undefined;
  return `${compact.format(requests24h).toLowerCase()} req / 24h`;
}
