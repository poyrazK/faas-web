import { Profiler, type ComponentType } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SourceDeploysFigure } from './source-deploys';
import { IsolatedComputeFigure } from './isolated-compute';
import { CustomDomainsFigure } from './custom-domains';

const FIGURES: [string, ComponentType][] = [
  ['source-deploys', SourceDeploysFigure],
  ['isolated-compute', IsolatedComputeFigure],
  ['custom-domains', CustomDomainsFigure],
];

function frameOf(container: HTMLElement, name: string) {
  return container.querySelector<HTMLElement>(`[data-figure="${name}"]`)!;
}

describe('Hosting figures', () => {
  it.each(FIGURES)('%s is a wordless, decorative field within budget', (name, Figure) => {
    const { container } = render(<Figure />);
    const svg = frameOf(container, name).querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelectorAll('text')).toHaveLength(0);
    const shapes = svg.querySelectorAll('rect, circle, path, line').length;
    expect(shapes).toBeGreaterThan(0);
    expect(shapes).toBeLessThanOrEqual(60);
  });

  it.each(FIGURES)('%s moves under the pointer without a React commit', async (name, Figure) => {
    let commits = 0;
    const { container } = render(
      <Profiler id={name} onRender={() => (commits += 1)}>
        <Figure />
      </Profiler>
    );
    const frame = frameOf(container, name);
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 504,
      height: 200,
      right: 504,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    await act(async () => {});
    const before = commits;
    fireEvent.pointerEnter(frame, { clientX: 60, clientY: 60 });
    for (let i = 0; i < 50; i++)
      fireEvent.pointerMove(frame, { clientX: 60 + 8 * i, clientY: 60 + i });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(commits).toBe(before);
  });

  it('source deploys rests as scattered bars with no live dot', () => {
    const { container } = render(<SourceDeploysFigure />);
    const bars = container.querySelectorAll('[data-part="bar"]');
    expect(bars).toHaveLength(12);
    expect(bars[0]).toHaveAttribute('x', '28');
    expect(bars[0]).toHaveAttribute('y', '34');
    expect(container.querySelector('[data-part="dot"]')).toHaveAttribute('r', '0');
    expect(container.querySelector('[data-part="frame"]')).toHaveAttribute('d', 'M 218 34');
  });

  it('isolated compute rests as an even grid', () => {
    const { container } = render(<IsolatedComputeFigure />);
    expect(container.querySelectorAll('[data-part="cell"]')).toHaveLength(18);
    const cores = container.querySelectorAll('[data-part="core"]');
    expect(cores).toHaveLength(18);
    // motion writes animated lengths with a px unit, which SVG reads as user units.
    for (const core of cores) expect(parseFloat(core.getAttribute('width')!)).toBe(12);
  });

  it('custom domains rests with an empty fill and plain rings', () => {
    const { container } = render(<CustomDomainsFigure />);
    expect(container.querySelector('[data-part="fill"]')).toHaveAttribute('x2', '84');
    const rings = container.querySelectorAll('[data-part="ring"]');
    expect(rings).toHaveLength(3);
    for (const ring of rings) expect(ring).toHaveAttribute('r', '14');
  });
});
