import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UsageDailyBars } from './usage-daily';

/**
 * One day, one bar per app: the tallest is the biggest app, and every bar
 * names its app and its number for anyone who cannot read the height.
 */
describe('UsageDailyBars', () => {
  it('draws one bar per app, tallest for the biggest, with the totals in the accessible name', () => {
    render(
      <UsageDailyBars
        rows={[
          { label: 'hello', gb_hours: 1 },
          { label: 'image-resize', gb_hours: 4 },
        ]}
      />
    );
    const bars = screen.getAllByRole('img');
    expect(bars).toHaveLength(2);
    expect(bars[1]).toHaveAccessibleName('image-resize: 4.00 GB-hours');
    expect(bars[1].style.height).toBe('100%');
    expect(bars[0].style.height).toBe('25%');
  });
});
