import { cn } from '@/lib/utils';

/**
 * A mechanical-counter numeral: each digit is a vertical strip of 0–9 that
 * rolls to its value — on first paint it rolls up from zero (CSS
 * `@starting-style`, so there is no state and no effect), and on value
 * changes each digit glides to its new position independently, like an
 * odometer. Separators and decimals sit still between the columns.
 *
 * Digits are keyed by their position from the RIGHT, so when a value grows
 * a digit (999 → 1,000) the ones column stays the ones column and only a
 * new leading digit enters. Tabular numerals keep every column one width.
 *
 * The rolling strips are decorative to AT; the formatted value is read once
 * from a visually hidden span. Reduced motion shows values instantly.
 */
export function Odometer({
  value,
  format = (v) => Math.round(v).toLocaleString(),
  className,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
}) {
  const text = format(value);
  const chars = [...text];
  const last = chars.length - 1;

  return (
    <span className={cn('inline-flex leading-none [font-variant-numeric:tabular-nums]', className)}>
      <span className="sr-only">{text}</span>
      {chars.map((ch, i) => {
        const fromRight = last - i;
        if (!/\d/.test(ch)) {
          return (
            <span key={`s-${fromRight}`} aria-hidden>
              {ch}
            </span>
          );
        }
        return (
          <span key={`d-${fromRight}`} aria-hidden className="odo-col">
            <span
              className="odo-strip"
              style={{ '--odo-digit': Number(ch) } as React.CSSProperties}
            >
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
