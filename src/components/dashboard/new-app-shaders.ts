import { GLSL_PRELUDE } from '@/components/landing/shaders/use-shader-canvas';
import type { AppSource } from './new-app-source';

/**
 * The New app source scenes: one generative picture per way of creating an
 * app, in the landing's language (chunky pixels, ordered Bayer dither, a
 * stepped ramp). Colours arrive as uniforms read from the console's tokens,
 * so both polarities work and no colour is written here.
 */
const HEAD = `${GLSL_PRELUDE}
uniform vec3 u_brand;
uniform vec3 u_bg;
uniform vec3 u_fg;

const float PIX = 2.0;     // render pixels per dither cell (chunky at 0.5 scale)
const float LEVELS = 5.0;  // stepped, not smooth

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Card -> brand -> bright core, quantised by the dither so it steps.
vec3 shade(float v) {
  vec2 cell = floor(gl_FragCoord.xy / PIX);
  float d = bayer8(mod(cell, 8.0)) - 0.5;
  float q = clamp(floor(v * LEVELS + d + 0.5) / LEVELS, 0.0, 1.0);
  vec3 core = mix(u_brand, u_fg, 0.55);
  vec3 c = mix(u_bg, u_brand, smoothstep(0.0, 0.7, q));
  return mix(c, core, smoothstep(0.75, 1.0, q));
}

vec2 uv0() {
  // Sample at the dither cell's centre so every cell is one flat pixel.
  vec2 p = (floor(gl_FragCoord.xy / PIX) + 0.5) * PIX;
  return p / u_res;
}
`;

const tail = (body: string) => `${HEAD}
void main() {
  vec2 uv = uv0();
  float aspect = u_res.x / max(u_res.y, 1.0);
  float t = u_time;
  float v = 0.0;
${body}
  // Opaque, written premultiplied like every shader here (see premultiplied.test.ts).
  float alpha = 1.0;
  gl_FragColor = vec4(shade(clamp(v, 0.0, 1.0)) * alpha, alpha);
}
`;

/** Git: streams drift in from the left and converge into one bright beam. */
const GIT = tail(`
  vec2 focus = vec2(0.62, 0.5);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float y0 = 0.08 + fi * 0.168;
    float k = clamp(uv.x / focus.x, 0.0, 1.0);
    float y = mix(y0, focus.y, k * k * (3.0 - 2.0 * k));
    float w = mix(0.012, 0.004, k);
    float line = exp(-pow((uv.y - y) / w, 2.0)) * step(uv.x, focus.x);
    float dash = smoothstep(0.55, 1.0, fract(uv.x * 5.0 - t * 0.6 - fi * 0.17));
    v += line * (0.25 + 0.75 * dash);
  }
  float beam = exp(-pow((uv.y - focus.y) / (0.02 + (uv.x - focus.x) * 0.05), 2.0)) * step(focus.x, uv.x);
  v += beam * (0.8 + 0.2 * sin(t * 3.0 - uv.x * 20.0));
  v += exp(-length((uv - focus) * vec2(aspect, 1.0)) * 18.0) * 0.9;
`);

/** Template: blocks fall and settle into a grid, row by row. */
const TEMPLATE = tail(`
  vec2 g = vec2(6.0, 4.0);
  vec2 p = uv * g;
  vec2 c = floor(p);
  float idx = c.y * g.x + c.x;
  float cycle = mod(t, 6.0);
  float land = (g.y - 1.0 - c.y) * 0.45 + c.x * 0.07;
  float k = clamp((cycle - land) * 1.6, 0.0, 1.0);
  float drop = (1.0 - k) * (1.0 - k) * 1.5;
  vec2 q = fract(vec2(p.x, p.y - drop));
  float inCell = step(0.12, q.x) * step(q.x, 0.88) * step(0.12, q.y) * step(q.y, 0.88);
  float fromHere = step(c.y, floor(p.y - drop) + 0.5) * step(floor(p.y - drop) - 0.5, c.y);
  v = inCell * fromHere * (0.45 + 0.4 * k + 0.15 * hash(c + 3.0));
  v = max(v, 0.08 * noise(uv * 30.0));
`);

/** Empty: a soft field of grain that breathes. */
const EMPTY = tail(`
  float breath = 0.5 + 0.5 * sin(t * 0.9);
  float n = noise(uv * vec2(aspect, 1.0) * 14.0 + vec2(t * 0.08, -t * 0.05));
  float r = length((uv - 0.5) * vec2(aspect, 1.0));
  v = n * (0.25 + 0.45 * breath) * smoothstep(0.75, 0.05, r);
`);

/** Container: translucent planes stack upward with depth. */
const CONTAINER = tail(`
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float lift = fi * 0.14 + 0.03 * sin(t * 1.2 + fi);
    vec2 p = uv - vec2(0.5, 0.22 + lift);
    p.x *= 1.0 + p.y * 0.6;
    float rect = step(abs(p.x), 0.28 - fi * 0.02) * step(abs(p.y), 0.045);
    float edge = rect * (1.0 - step(abs(p.x), 0.26 - fi * 0.02) * step(abs(p.y), 0.03));
    v = max(v, rect * (0.22 + fi * 0.08) + edge * 0.55);
  }
`);

/** Worker: a pulse travels a line and never stops; a trail follows. */
const WORKER = tail(`
  float pos = fract(t * 0.22);
  float dx = uv.x - pos;
  float spike = exp(-pow(dx * 40.0, 2.0)) * 0.22 - exp(-pow((dx - 0.025) * 40.0, 2.0)) * 0.12;
  float y = 0.5 + spike;
  float line = exp(-pow((uv.y - y) / 0.008, 2.0));
  float trail = smoothstep(-0.6, 0.0, dx) * step(dx, 0.02);
  v = line * (0.18 + 0.82 * trail);
  v += exp(-length(vec2(dx * aspect, uv.y - y)) * 30.0) * 0.8;
`);

/** Import: one stream enters from the top and splits into three. */
const IMPORT = tail(`
  float split = 0.55;
  float stem = exp(-pow((uv.x - 0.5) / 0.006, 2.0)) * step(split, uv.y);
  float k = clamp((split - uv.y) / split, 0.0, 1.0);
  float e = k * k * (3.0 - 2.0 * k);
  float branches = 0.0;
  for (int i = 0; i < 3; i++) {
    float target = 0.2 + float(i) * 0.3;
    float x = mix(0.5, target, e);
    branches += exp(-pow((uv.x - x) / 0.006, 2.0)) * step(uv.y, split);
  }
  float flow = smoothstep(0.5, 1.0, fract(uv.y * 6.0 + t * 0.7));
  v = (stem + branches) * (0.3 + 0.7 * flow);
  v += exp(-length((uv - vec2(0.5, split)) * vec2(aspect, 1.0)) * 24.0) * 0.7;
`);

export const SOURCE_FRAGS: Record<AppSource, string> = {
  git: GIT,
  template: TEMPLATE,
  empty: EMPTY,
  container: CONTAINER,
  worker: WORKER,
  import: IMPORT,
};
