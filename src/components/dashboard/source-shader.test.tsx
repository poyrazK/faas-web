import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readColorToken, SourceShader } from './source-shader';
import { SOURCE_FRAGS } from './new-app-shaders';
import type { AppSource } from './new-app-source';

const ALL: AppSource[] = ['git', 'template', 'empty', 'container', 'worker', 'import'];

describe('readColorToken', () => {
  const el = document.createElement('div');
  const read = (v: string) => {
    el.style.setProperty('--t', v);
    document.body.append(el);
    const out = readColorToken('--t', el);
    el.remove();
    return out.map((n) => Math.round(n * 255));
  };
  it('reads hex in every form the tokens use', () => {
    expect(read('#51deaa')).toEqual([0x51, 0xde, 0xaa]);
    expect(read('#51deaa26')).toEqual([0x51, 0xde, 0xaa]);
    expect(read('#fff')).toEqual([255, 255, 255]);
  });
  it('reads rgb() and falls back to black for anything else', () => {
    expect(read('rgb(36, 36, 36)')).toEqual([36, 36, 36]);
    expect(read('banana')).toEqual([0, 0, 0]);
  });
});

describe('SourceShader', () => {
  it.each(ALL)(
    'gives %s a scene that assistive technology skips, falling back without WebGL',
    (id) => {
      const { container } = render(<SourceShader id={id} active={false} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveAttribute('aria-hidden', 'true');
      expect(root).toHaveAttribute('data-preview', id);
      // jsdom has no WebGL: the CSS fallback stands in.
      expect(root.querySelector('.nab-fallback')).not.toBeNull();
    }
  );

  it('has a distinct fragment shader for every source, on the shared prelude and dither', () => {
    const frags = ALL.map((id) => SOURCE_FRAGS[id]);
    expect(new Set(frags).size).toBe(6);
    frags.forEach((f) => {
      expect(f).toMatch(/uniform vec3 u_brand;/);
      expect(f).toMatch(/bayer8\(/);
      expect(f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    });
  });
});
