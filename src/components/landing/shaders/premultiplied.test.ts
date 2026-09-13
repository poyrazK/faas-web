import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every shader writes premultiplied alpha.
 *
 * `useShaderCanvas` creates its context without passing `premultipliedAlpha`,
 * so WebGL's default — true — applies: the compositor treats the fragment's RGB
 * as already multiplied by its alpha. A shader that returns straight alpha
 * therefore paints its colour at full strength *even where alpha is zero*, and
 * the failure does not look like a transparency bug. It looks like a solid
 * slab of the shader's brightest colour with the intended shapes punched
 * through it in whatever the darker end of the ramp is, which is a confusing
 * enough symptom to send someone hunting through the wrong maths for a while.
 *
 * It shipped exactly once, in the residency field. This is the guard.
 */

const SHADER_DIRS = [
  'src/components/landing/shaders',
  'src/components/landing',
  'src/components/dashboard',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return [];
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

const sources = SHADER_DIRS.flatMap((dir) => walk(resolve(dir)))
  .map((file) => ({ file, text: readFileSync(file, 'utf8') }))
  .filter(({ text }) => text.includes('gl_FragColor'));

/** `vec4(<anything> * x, x)` — the rgb term multiplied by the same identifier
 *  the alpha term uses. */
const PREMULTIPLIED = /gl_FragColor\s*=\s*vec4\([^;]*\*\s*([A-Za-z_]\w*)\s*,\s*\1\s*\)/;

describe('shader alpha convention', () => {
  it('finds the shaders', () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it.each(sources.map(({ file, text }) => [file.split('/').pop(), text]))(
    '%s premultiplies its output',
    (_name, text) => {
      const writes = (text as string)
        .split('\n')
        .filter((line) => line.includes('gl_FragColor') && line.includes('vec4'));
      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) {
        expect(write).toMatch(PREMULTIPLIED);
      }
    }
  );
});
