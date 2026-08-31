import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiquidField, LIQUID_PRESETS } from './liquid-field';

/**
 * jsdom has no WebGL, so these tests cover the part that must hold without
 * it: the field is decorative, and it degrades to a painted gradient rather
 * than a blank or an error.
 */
describe('LiquidField', () => {
  it('is hidden from assistive tech and still paints something without WebGL', () => {
    const { container } = render(<LiquidField params={LIQUID_PRESETS.gregale} />);
    const host = container.querySelector('[data-beam-field]');
    expect(host).not.toBeNull();
    expect(host).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-fallback]')).not.toBeNull();
  });

  it('runs the site preset: mint palette on the reference shape', () => {
    const p = LIQUID_PRESETS.gregale;
    expect(p.colors).toEqual(['#f3fbf7', '#00ce91', '#00b7d6', '#b2bdb8']);
    expect(p.scale).toBe(0.39);
    expect(p.speed).toBe(0.8);
    expect(p.turbAmp).toBe(0.65);
    expect(p.turbFreq).toBe(0.98);
    expect(p.turbIter).toBe(4);
    expect(p.waveFreq).toBe(1.6);
    expect(p.seed).toBe(942);
    expect(p.dither).toBe(0.08);
  });
});
