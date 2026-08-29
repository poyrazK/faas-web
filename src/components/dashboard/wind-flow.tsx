import { GLSL_PRELUDE, useShaderCanvas } from '@/components/landing/shaders/use-shader-canvas';
import { WindBeams } from '@/components/ui/wind-beams';

/**
 * The gregale as a fluid: soft filaments of mint light streaming from the
 * northeast, drawn by a fragment shader instead of fixed paths.
 *
 * Mechanics: fragment coordinates are projected onto the wind axis, warped
 * by two octaves of curling noise (so filaments bend like air, not lines),
 * and advected along the axis over time at two speeds — a slow broad drift
 * and a faster fine layer. Intensity falls off away from the northeast, and
 * everything is smoothstepped wide, so nothing has an edge.
 *
 * Rides the shared shader plumbing: pauses offscreen and when the tab
 * hides, renders one still frame under reduced motion, and falls back to
 * the static SVG ribbons when WebGL is unavailable. Rendered at 0.4 scale —
 * the upscale is the softness.
 */

const FRAG = `${GLSL_PRELUDE}

uniform float u_intensity;

// Small folds only: mediump-safe (see prelude note).
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv;
  p.x *= u_res.x / max(u_res.y, 1.0);

  // The wind axis: from the top-right, exhaling to the bottom-left.
  vec2 dir = normalize(vec2(-1.0, -0.55));
  vec2 prp = vec2(-dir.y, dir.x);
  float along = dot(p, dir);
  float across = dot(p, prp);

  float t = u_time * 0.05;

  // Two curls bend the flow line before the streaks are read from it —
  // this is what makes filaments waver instead of sliding as a sheet.
  float curlA = fbm(vec2(along * 0.9 - t * 1.4, across * 1.6)) - 0.5;
  float curlB = fbm(vec2(along * 0.45 - t * 0.7 + 7.0, across * 0.9)) - 0.5;
  float bent = across + 0.34 * curlA + 0.55 * curlB;

  // Streaks: long wavelengths along the wind, short across it.
  float fine   = fbm(vec2(along * 1.1  - t * 2.2,        bent * 3.0));
  float broad  = fbm(vec2(along * 0.55 - t * 1.1 + 4.0,  bent * 1.7 + 2.0));
  float streak = smoothstep(0.44, 0.92, fine) * 0.65
               + smoothstep(0.48, 0.95, broad) * 0.55;

  // A faint body of air behind the filaments, so the light has volume.
  float body = fbm(vec2(along * 0.3 - t * 0.5 + 11.0, bent * 0.8)) * 0.16;

  // Strongest toward the northeast, gone by the southwest corner.
  float mask = smoothstep(0.15, 1.55, uv.x + uv.y);

  float a = (streak * 0.5 + body) * mask * u_intensity;

  // Depth in the ramp, two steps lighter than the brand core: fresh air,
  // not deep water. Brand in the body, pale mint in the flow, a near-white
  // highlight only where two streak layers cross.
  vec3 deep = vec3(0.000, 0.808, 0.569);   // brand-fill #00ce91
  vec3 mid  = vec3(0.317, 0.871, 0.667);   // mint-7 #51deaa
  vec3 hi   = vec3(0.625, 0.944, 0.804);   // mint-5 #9ff1cd
  vec3 col = mix(deep, mid, smoothstep(0.0, 0.7, streak));
  col = mix(col, hi, smoothstep(0.75, 1.15, streak));

  // Premultiplied, matching the context's compositing.
  gl_FragColor = vec4(col * a, a);
}
`;

export function WindFlow({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  const { hostRef, canvasRef, supported } = useShaderCanvas({
    frag: FRAG,
    label: 'wind-flow',
    renderScale: 0.4,
    uniformNames: ['u_intensity'],
    onFrame: (gl, u) => gl.uniform1f(u.u_intensity, intensity),
  });

  // No WebGL: the still SVG ribbons carry the same light.
  if (!supported) return <WindBeams className={className} />;

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={`pointer-events-none absolute ${className || 'inset-0'}`}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
