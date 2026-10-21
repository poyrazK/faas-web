import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourcePreview } from './new-app-previews';
import type { AppSource } from './new-app-source';

const ALL: AppSource[] = ['git', 'template', 'empty', 'container', 'worker', 'import'];
const css = readFileSync(resolve('src/components/dashboard/new-app-bento.css'), 'utf8');

describe('SourcePreview', () => {
  it.each(ALL)('draws a %s scene that assistive technology skips', (id) => {
    const { container } = render(<SourcePreview id={id} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveAttribute('data-preview', id);
    expect(root.childElementCount).toBeGreaterThan(0);
  });

  it('shows a real-looking deploy rail for Git', () => {
    const { container } = render(<SourcePreview id="git" />);
    expect(container.querySelectorAll('.nab-seg')).toHaveLength(4);
    expect(container.textContent).toContain('storefront.gregale.app');
  });
});

describe('new-app-bento.css', () => {
  it('uses tokens only', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\bdark\b/);
  });

  it('plays previews on hover, focus and selection, and never under reduced motion', () => {
    expect(css).toMatch(/\.nab-cell:hover/);
    expect(css).toMatch(/\.nab-cell:focus-visible/);
    expect(css).toMatch(/\.nab-cell\[aria-pressed='true'\]/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  });
});
