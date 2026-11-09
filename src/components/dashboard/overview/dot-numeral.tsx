import { cn } from '@/lib/utils';

/**
 * A 5×7 dot-matrix face for the Overview's headline number. Unlit dots stay
 * faintly visible, so the figure reads as a lit panel rather than loose dots.
 * Screen readers get the plain number through `label`.
 */
export const GLYPHS: Record<string, readonly string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  ',': ['00', '00', '00', '00', '00', '01', '10'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  '—': ['000', '000', '000', '111', '000', '000', '000'],
};

/** The compact figure the panel shows: 934K, 1.2M, 87. */
export function compactFigure(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 })
    .format(value)
    .toUpperCase();
}

export function DotNumeral({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const glyphs = [...text].filter((ch) => GLYPHS[ch]);
  return (
    <span role="img" aria-label={label} className={cn('dot-numeral', className)}>
      {glyphs.map((ch, i) => {
        const rows = GLYPHS[ch];
        return (
          <span
            // Keyed by position so a changing figure cross-fades its dots
            // instead of remounting the glyph.
            key={i}
            aria-hidden
            className="dot-numeral__glyph"
            style={{ gridTemplateColumns: `repeat(${rows[0].length}, var(--dot))` }}
          >
            {rows.flatMap((row, r) =>
              [...row].map((bit, c) => (
                <span
                  key={`${r}-${c}`}
                  className="dot-numeral__dot"
                  data-on={bit === '1' || undefined}
                />
              ))
            )}
          </span>
        );
      })}
    </span>
  );
}
