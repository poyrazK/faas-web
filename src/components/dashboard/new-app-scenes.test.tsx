import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceGlyph, SourceScene } from './new-app-scenes';
import type { AppSource } from './new-app-source';

const ALL: AppSource[] = ['git', 'template', 'empty', 'container', 'worker', 'import'];
const css = readFileSync(resolve('src/components/dashboard/new-app-scenes.css'), 'utf8');
const tokens = readFileSync(resolve('src/index.css'), 'utf8');

/** Every colour an SVG paints with, from fill and stroke. */
function paints(root: Element) {
  return [...root.querySelectorAll('*')].flatMap((el) =>
    ['fill', 'stroke'].map((a) => el.getAttribute(a)).filter((v): v is string => Boolean(v))
  );
}

describe('SourceScene', () => {
  it.each(ALL)('gives %s one vector scene that assistive technology skips', (id) => {
    const { container } = render(<SourceScene id={id} active={false} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveAttribute('data-preview', id);
    expect(root.querySelectorAll('svg')).toHaveLength(1);
    expect(root.querySelector('canvas')).toBeNull();
  });

  it('plays only while active', () => {
    const { container, rerender } = render(<SourceScene id="git" active={false} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveAttribute('data-active');
    rerender(<SourceScene id="git" active />);
    expect(root).toHaveAttribute('data-active');
  });

  // The reel's palette lives in tokens; a scene names a token, never a colour.
  it('paints with the art tokens only', () => {
    ALL.forEach((id) => {
      const { container, unmount } = render(<SourceScene id={id} active={false} />);
      const used = paints(container);
      expect(used.length).toBeGreaterThan(0);
      used.forEach((p) => expect(p).toMatch(/^(none|var\(--art-[a-z]+\)|url\(#[\w-]+\))$/));
      unmount();
    });
  });

  it('draws a different scene for every source', () => {
    const markup = ALL.map(
      (id) => render(<SourceScene id={id} active={false} />).container.innerHTML
    );
    expect(new Set(markup).size).toBe(6);
  });
});

describe('SourceGlyph', () => {
  it.each(ALL)('gives %s a small pixel glyph in one art colour', (id) => {
    const { container } = render(<SourceGlyph id={id} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThanOrEqual(3);
    expect(new Set(paints(svg)).size).toBe(1);
  });
});

describe('new-app-scenes.css', () => {
  it('names no colour of its own', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  // A scene at rest shows its composed frame: animations exist only under
  // [data-active], so leaving a cell snaps back instead of freezing mid-move.
  it('animates only an active scene, and never under reduced motion', () => {
    const animated = [...css.matchAll(/([^{}]+)\{[^}]*animation-name:/g)].map((m) => m[1].trim());
    expect(animated.length).toBeGreaterThan(5);
    animated.forEach((selector) => expect(selector).toContain('[data-active]'));
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe('art tokens', () => {
  // One palette for both polarities, like Foil: the preview is a dark screen
  // set into the card either way.
  it('are declared once for both polarities', () => {
    const block = /:root,\s*\.console\s*\{([^}]*--art-ground[^}]*)\}/.exec(tokens)?.[1] ?? '';
    for (const name of [
      'ground',
      'guide',
      'mute',
      'light',
      'magenta',
      'cyan',
      'orange',
      'yellow',
      'lime',
      'blue',
      'pink',
    ])
      expect(block).toMatch(new RegExp(`--art-${name}: #[0-9a-f]{6};`));
  });
});
