import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResidencyField } from './residency-field';

/**
 * jsdom has no WebGL, so `useShaderCanvas` reports unsupported and the field
 * draws nothing. That is the contract worth pinning here: what the panel must
 * never do is substitute a shape for the picture it could not draw, because the
 * figures live in text beside it and a stand-in bar would imply a capacity the
 * API cannot confirm.
 */
describe('ResidencyField', () => {
  const instances = [
    { id: 'a1', ram_mb: 512 },
    { id: 'b2', ram_mb: 256 },
  ];

  it('draws nothing rather than a stand-in when WebGL is unavailable', () => {
    const { container } = render(<ResidencyField instances={instances} />);
    expect(container.querySelector('canvas')).toBeNull();
    // No progress bar, meter, or any other shape standing in for the field.
    expect(container.querySelector('[role="progressbar"], meter, progress')).toBeNull();
  });

  it('is decorative: the reading it portrays is written out beside it', () => {
    const { container } = render(<ResidencyField instances={instances} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    // Nothing inside is exposed to assistive tech, so it can never become the
    // only place a figure appears.
    expect(screen.queryByText(/512|256|MB/)).toBeNull();
  });

  it('survives an empty fleet — scale-to-zero is the normal case', () => {
    expect(() => render(<ResidencyField instances={[]} />)).not.toThrow();
  });

  it('tolerates a fleet past the cell cap without throwing', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `i${i}`, ram_mb: 128 }));
    expect(() => render(<ResidencyField instances={many} />)).not.toThrow();
  });
});
