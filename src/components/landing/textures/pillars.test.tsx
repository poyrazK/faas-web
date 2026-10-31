import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Pillars } from './pillars';

describe('Pillars', () => {
  it('renders its resting field as a decorative SVG, one group per row', () => {
    const { container } = render(<Pillars static />);
    const root = container.querySelector('[data-texture="pillars"]')!;
    const svg = root.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelectorAll('g')).toHaveLength(16);
    expect(svg.querySelectorAll('path')).toHaveLength(32);
  });

  it('takes its ink and field from tokens', () => {
    const { container } = render(
      <Pillars
        static
        tokens={{ '--texture-ink': 'var(--brand)', '--texture-field': 'var(--card)' }}
      />
    );
    const root = container.querySelector<HTMLElement>('[data-texture="pillars"]')!;
    expect(root.style.getPropertyValue('--texture-ink')).toBe('var(--brand)');
    expect(root.style.getPropertyValue('--texture-field')).toBe('var(--card)');
  });

  it('mounts and tears down its pointer engine cleanly', () => {
    const { container, unmount } = render(
      <div style={{ height: 200 }}>
        <Pillars />
      </div>
    );
    expect(container.querySelector('[data-texture="pillars"] svg')).not.toBeNull();
    expect(() => unmount()).not.toThrow();
  });
});
