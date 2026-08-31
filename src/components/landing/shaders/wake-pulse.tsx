import { useEffect, useRef } from 'react';
import { GLSL_PRELUDE, useShaderCanvas } from './use-shader-canvas';

/**
 * The how-it-works figure: the life of one request as a slatted area curve —
 * flat at zero while the app sleeps, a sharp rise at wake, a rippling plateau
 * while the handler runs, and a decay back to the baseline when it parks.
 *
 * Drawn in the same material as the pricing figure (`stepped-bars.tsx`): the
 * mint ramp, louvre slats, film grain, a travelling sheen, a rim light along
 * the curve, and a pointer lamp. One extra element is specific to this
 * section: a bright dot that rides the curve on a loop — the request itself.
 *
 * The entrance draws the curve left to right (`u_grow`), so the story plays
 * in its own order: sleeping, waking, running, parked.
 *
 * Falls back to a CSS-clipped gradient block when WebGL is unavailable.
 */

const FRAG = `${GLSL_PRELUDE}

uniform float u_grow;    // 0 -> 1 entrance, reveals the curve left to right
uniform float u_noise;   // grain amount
uniform float u_sheen;   // travelling highlight strength
uniform float u_slats;   // slat count per unit height
uniform float u_light;   // pointer light strength

const float BASE = 0.07;   // the sleeping baseline
const float PEAK = 0.80;   // the running plateau

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

// The mint ramp, pale -> deep, kept light: it tops out at mint-9 rather
// than mint-11 so the mound reads as lit glass beside the hero's field.
vec3 ramp(float x) {
  vec3 c0 = vec3(0.945, 0.988, 0.965);   // mint-2
  vec3 c1 = vec3(0.655, 0.945, 0.827);   // mint-5
  vec3 c2 = vec3(0.298, 0.875, 0.686);   // mint-7
  vec3 c3 = vec3(0.000, 0.643, 0.396);   // mint-9
  vec3 col = mix(c0, c1, smoothstep(0.00, 0.40, x));
  col = mix(col, c2, smoothstep(0.36, 0.74, x));
  col = mix(col, c3, smoothstep(0.70, 1.00, x));
  return col;
}

// The lifecycle: sleeping -> waking -> running -> parked.
float curve(float x) {
  float rise = smoothstep(0.26, 0.34, x);          // the wake
  float fall = 1.0 - smoothstep(0.70, 0.86, x);    // the park
  float run  = rise * fall;
  // A slight overshoot at wake, then a gentle activity ripple while running.
  float overshoot = exp(-pow((x - 0.365) * 22.0, 2.0)) * 0.07;
  float ripple = sin(x * 34.0 + u_time * 0.9) * 0.018 * run;
  return BASE + run * (PEAK - BASE) + overshoot * run + ripple;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_res;

  // Entrance: the curve exists only left of the reveal front.
  float grow = 1.0 - pow(1.0 - u_grow, 3.0);       // ease-out cubic
  float front = grow * 1.08;
  float revealed = smoothstep(front, front - 0.05, uv.x);

  float y = curve(uv.x);
  float inArea = step(uv.y, y) * revealed;

  // Colour: deeper mint where the curve runs high, darker toward the base —
  // the same two-axis ramp read as the pricing bars.
  float lift = (y - BASE) / (PEAK - BASE);
  float vert = 1.0 - uv.y / max(y, 0.001);         // 0 at the curve, 1 at the base
  float t = clamp(0.12 + lift * 0.52 + vert * 0.30, 0.0, 1.0);
  vec3 col = ramp(t);

  // Louvre slats: a lit top edge and a shadowed seat on a repeating band.
  float band = fract(uv.y * u_slats);
  float lit  = smoothstep(0.55, 0.95, band);
  float seam = smoothstep(0.10, 0.0, band) * 0.5;
  col *= 1.0 - 0.16 * seam;
  col += lit * 0.14;

  // Travelling sheen, drifting across the whole figure.
  float sweep = fract(u_time * 0.06);
  float sd = uv.x * 0.8 + uv.y * 0.35 - sweep * 2.3 + 0.55;
  float sheen = exp(-sd * sd * 42.0) * u_sheen;
  col += sheen * vec3(0.9, 1.0, 0.96);

  // Rim light along the curve itself, leading the reveal.
  float rim = smoothstep(0.010, 0.0, abs(uv.y - y)) * revealed;
  col += rim * 0.40;

  // The request: a bright dot riding the curve on a loop, with a soft tail.
  float p = fract(u_time * 0.10);
  vec2 aspect = vec2(u_res.x / u_res.y, 1.0);
  float dd = length((uv - vec2(p, curve(p))) * aspect);
  float dot_ = exp(-dd * dd * 900.0) * 1.4 + exp(-dd * dd * 90.0) * 0.25;
  // The tail only trails the dot, along the curve.
  float behind = p - uv.x;
  float tail = (behind > 0.0 ? exp(-behind * 26.0) : 0.0)
             * smoothstep(0.015, 0.0, abs(uv.y - y)) * 0.5;
  col += (dot_ + tail) * vec3(0.85, 1.0, 0.94) * grow;

  // Pointer lamp.
  float pd = distance(frag, u_pointer) / max(min(u_res.x, u_res.y), 1.0);
  col += exp(-pd * pd * 7.0) * u_light * (0.10 + lit * 0.22);

  // Film grain, animated, both signs.
  float g = hash21(frag + fract(u_time) * 61.7) - 0.5;
  col += g * u_noise;

  // A breath of glow above the curve.
  float halo = smoothstep(0.10, 0.0, uv.y - y) * step(y, uv.y) * revealed;
  vec3 haloCol = ramp(clamp(0.12 + lift * 0.52, 0.0, 1.0));
  float alpha = inArea + halo * 0.16 + (dot_ * 0.6) * grow * (1.0 - inArea);

  gl_FragColor = vec4(mix(haloCol, col, max(inArea, dot_)) * alpha, alpha); // premultiplied
}
`;

export interface WakePulseConfig {
  /** Grain amount. 0 disables; 0.05 is a fine film grain. */
  noise?: number;
  /** Travelling highlight strength. 0 disables the sweep. */
  sheen?: number;
  /** Louvre slats per unit height — the figure's horizontal banding. */
  slats?: number;
  /** Pointer-lamp strength. */
  light?: number;
}

const DEFAULTS: Required<WakePulseConfig> = {
  noise: 0.045,
  sheen: 0.28,
  slats: 26,
  light: 0.9,
};

/** The same silhouette in CSS for machines without WebGL. */
function PulseFallback() {
  return (
    <div
      className="h-full w-full"
      style={{
        backgroundImage: [
          'repeating-linear-gradient(to top, transparent 0 10px, rgba(255, 255, 255, 0.35) 10px 14px)',
          'linear-gradient(to right, var(--mint-3), var(--mint-6) 45%, var(--mint-8) 65%, var(--mint-4))',
        ].join(', '),
        clipPath:
          'polygon(0% 93%, 26% 93%, 34% 22%, 37% 17%, 45% 21%, 60% 20%, 70% 22%, 86% 93%, 100% 93%, 100% 100%, 0% 100%)',
      }}
    />
  );
}

export function WakePulse({ className = '', ...config }: { className?: string } & WakePulseConfig) {
  const { noise, sheen, slats, light } = { ...DEFAULTS, ...config };

  const targetRef = useRef({ noise, sheen, slats, light });
  useEffect(() => {
    targetRef.current = { noise, sheen, slats, light };
  }, [noise, sheen, slats, light]);

  // Entrance: grow eases toward 1 once the figure has been seen. Under
  // reduced motion the hook draws a single frame, so grow starts finished.
  const growRef = useRef(0);
  const seenRef = useRef(false);

  const currentRef = useRef({ ...DEFAULTS });

  const { hostRef, canvasRef, supported } = useShaderCanvas({
    frag: FRAG,
    label: 'wake-pulse',
    renderScale: 1,
    uniformNames: ['u_grow', 'u_noise', 'u_sheen', 'u_slats', 'u_light'],
    onFrame: (gl, u) => {
      if (seenRef.current) growRef.current += (1 - growRef.current) * 0.045;
      const c = currentRef.current;
      const t = targetRef.current;
      c.noise += (t.noise - c.noise) * 0.08;
      c.sheen += (t.sheen - c.sheen) * 0.08;
      c.slats += (t.slats - c.slats) * 0.08;
      c.light += (t.light - c.light) * 0.08;
      gl.uniform1f(u.u_grow, growRef.current);
      gl.uniform1f(u.u_noise, c.noise);
      gl.uniform1f(u.u_sheen, c.sheen);
      gl.uniform1f(u.u_slats, c.slats);
      gl.uniform1f(u.u_light, c.light);
    },
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      growRef.current = 1;
      seenRef.current = true;
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        seenRef.current = true;
        io.disconnect();
      }
    });
    io.observe(host);
    return () => io.disconnect();
  }, [hostRef]);

  if (!supported) {
    return (
      <div aria-hidden className={className}>
        <PulseFallback />
      </div>
    );
  }

  return (
    <div ref={hostRef} aria-hidden className={className}>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
