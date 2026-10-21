import { useEffect, useRef } from 'react';
import { useShaderCanvas } from '@/components/landing/shaders/use-shader-canvas';
import type { AppSource } from './new-app-source';
import { SOURCE_FRAGS } from './new-app-shaders';

type Rgb = [number, number, number];

/** A colour token as 0–1 floats, for a shader uniform. */
export function readColorToken(name: string, el: Element = document.documentElement): Rgb {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(raw);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((n) => Number(n) / 255) as Rgb;
  return [0, 0, 0];
}

const TOKENS = { u_brand: '--brand', u_bg: '--card', u_fg: '--foreground' } as const;

/**
 * One source's generative scene. It holds a still frame until `active`
 * (its cell hovered, focused or selected), reads its colours from the
 * console's tokens, and repaints when the polarity changes. Without WebGL,
 * a CSS gradient in the same tokens stands in.
 */
export function SourceShader({ id, active }: { id: AppSource; active: boolean }) {
  const colors = useRef<Record<keyof typeof TOKENS, Rgb>>({
    u_brand: [0, 0, 0],
    u_bg: [0, 0, 0],
    u_fg: [0, 0, 0],
  });
  const { hostRef, canvasRef, supported, redraw } = useShaderCanvas({
    frag: SOURCE_FRAGS[id],
    label: `new-app-${id}`,
    renderScale: 0.5,
    uniformNames: Object.keys(TOKENS),
    active,
    stillAt: 2.4,
    onFrame: (gl, u) => {
      for (const key of Object.keys(TOKENS) as (keyof typeof TOKENS)[])
        gl.uniform3fv(u[key], colors.current[key]);
    },
  });

  useEffect(() => {
    const host = hostRef.current;
    const read = () => {
      const el = host ?? document.documentElement;
      for (const key of Object.keys(TOKENS) as (keyof typeof TOKENS)[])
        colors.current[key] = readColorToken(TOKENS[key], el);
      redraw();
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, [hostRef, redraw]);

  return (
    <div aria-hidden="true" className="nab-preview" data-preview={id}>
      {supported ? (
        <div ref={hostRef} className="absolute inset-0">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      ) : (
        <span className="nab-fallback" data-source={id} />
      )}
    </div>
  );
}
