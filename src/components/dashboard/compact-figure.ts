/** A count at a glance: 87, 934K, 1.25M. The exact figure belongs in a title. */
export function compactFigure(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 })
    .format(value)
    .toUpperCase();
}
