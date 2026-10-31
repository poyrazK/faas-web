# New app v2 (stations, layouts, shaders) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the New app wizard into four stations (Sources → Setup → Configure → Review) shown by either of two layouts, Track or Fold, chosen with a dev-only switch, and replace the diagram previews with six generative shader scenes.

**Architecture:**

- **Station logic:** which station is current is a pure function, `stationFor()`, of the URL search. The wizard keeps all its state and validation and only decides what to render per station.
- **Layouts:** both are presentational components around the current station (`NewAppStage`, `NewAppStrip`).
- **Scenes:** the shaders reuse the landing's `useShaderCanvas`. It gains a backward-compatible `active` option and a `redraw()`, so a cell holds a still frame until hovered and repaints when the theme changes.

**Tech Stack:** React 19, TanStack Router, `motion/react`, WebGL 1 fragment shaders, Tailwind 4 tokens and CSS container queries, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-21-new-app-stations-design.md` (v1 spec: `docs/superpowers/specs/2026-10-20-new-app-bento-design.md`)

## Global Constraints

- **Tokens only.** No literal hex in `.tsx` or `.css`, and no `dark:`. Shader colours are read from `--brand`, `--card` and `--foreground` at runtime, never written as literals.
- **Both polarities.** The console is dark (`html.console`); onboarding is light.
- **Cell contract.** Cells keep `name="source-<id>"`, `form={formId}`, `aria-pressed`, their names and descriptions, and the three labelled groups.
- **Dev only.** The layout switch renders only when `import.meta.env.DEV`. Production uses Track.
- **WebGL budget.** At most 6 WebGL contexts per page; Fold's strip uses CSS swatches.
- **Motion.** Scenes animate only while their cell is hovered, focused or selected. Reduced motion means one still frame and no slides.
- **Existing tests.** `new-app-wizard.test.tsx` and `src/routes/-dashboard.new-app.test.tsx` stay green. A test whose assertion depends on Setup's fields being on the first screen may change to reach them on the Setup station; each such change gets a ledger ruling with the old and new assertion.
- **Lint and formatting.** Lint stays at 4 warnings. Do not reformat untouched files.
- **Out of bounds.** `GitHubConnectForm returnTo` stays `/dashboard/apps/new?source=git`. First-deployment recovery is untouched.

## Review Focus

1. **The GitHub round-trip.** Returning to `?source=git&github=connected` must land on Git's Setup with the repository picker, not on Sources. Pinned in Task 1 (`stationFor` with a named source) and in the Task 8 browser pass.
2. **Browser Back and Forward across stations.** Back from Setup must reach Sources without bouncing into Setup again. Pinned in Task 1 (`step: 'source'`) and in Task 7 by the existing route test "restores the selected source from a bookmark and browser Back/Forward".
3. **Shader failure.** A compile error must never leave a blank cell: the fallback gradient shows, and a console warning names the scene. Pinned in Task 3 (fallback in jsdom) and in Task 8 (the browser fails on any "shader compile failed" warning).
4. **Theme change while a scene is still.** The still frame must repaint in the new colours. Pinned in Task 2 (`redraw()` draws when not running).
5. **Keyboard at the sliver and the strip.** Each is a real button with a name. Pinned in Task 5 (names, and clicking goes back or switches).

---

### Task 1: `stationFor()` and the step markers

**Files:**

- Create: `src/components/dashboard/new-app-station.ts`
- Modify: `src/components/dashboard/new-app-source.ts`, where the `NewAppSearch.step` type and `validateNewAppSearch` live
- Test: `src/components/dashboard/new-app-station.test.ts`

**Interfaces:**

- Produces:
  - `type Station = 'sources' | 'setup' | 'configure' | 'review'`
  - `function hasSetup(source?: AppSource): boolean`, true for git, template, container, worker and import
  - `function stationFor(i: { step?: NewAppSearch['step']; source?: AppSource; named: boolean; sourceValid: boolean; nameValid: boolean }): Station`
  - `function stepForStation(station: Station, step?: NewAppSearch['step']): NewAppSearch['step']`, the URL value the wizard normalises to
  - `NewAppSearch.step` becomes `'source' | 'setup' | 'configure' | 'review'`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/dashboard/new-app-station.test.ts
import { describe, expect, it } from 'vitest';
import { hasSetup, stationFor, stepForStation } from './new-app-station';
import { validateNewAppSearch } from './new-app-source';

const at = (i: Partial<Parameters<typeof stationFor>[0]>) =>
  stationFor({ named: false, sourceValid: false, nameValid: false, ...i });

describe('stationFor', () => {
  it('opens on Sources with nothing chosen, or with a source only inferred', () => {
    expect(at({})).toBe('sources');
    expect(at({ source: 'git', named: false, sourceValid: true })).toBe('sources');
  });

  it('lands a source named in the URL on its Setup (GitHub return, template links)', () => {
    expect(at({ source: 'git', named: true })).toBe('setup');
    expect(at({ source: 'template', named: true })).toBe('setup');
    expect(at({ source: 'import', named: true })).toBe('setup');
  });

  it('keeps a named Empty on Sources, since it has no Setup', () => {
    expect(at({ source: 'empty', named: true, sourceValid: true })).toBe('sources');
  });

  it('honours the explicit markers', () => {
    expect(at({ source: 'git', named: true, step: 'source' })).toBe('sources');
    expect(at({ source: 'template', named: true, step: 'setup' })).toBe('setup');
    expect(at({ source: 'empty', named: true, step: 'setup', sourceValid: true })).toBe(
      'configure'
    );
  });

  it('reaches Configure and Review only when what they need is valid', () => {
    expect(at({ source: 'git', named: true, step: 'configure', sourceValid: true })).toBe(
      'configure'
    );
    expect(at({ source: 'git', named: true, step: 'configure' })).toBe('setup');
    expect(at({ source: 'empty', named: true, step: 'configure' })).toBe('sources');
    expect(
      at({ source: 'git', named: true, step: 'review', sourceValid: true, nameValid: true })
    ).toBe('review');
    expect(at({ source: 'git', named: true, step: 'review', sourceValid: true })).toBe('configure');
  });
});

describe('stepForStation', () => {
  it('writes back the marker the URL needs to come back to the same station', () => {
    expect(stepForStation('review', 'review')).toBe('review');
    expect(stepForStation('configure', 'review')).toBe('configure');
    expect(stepForStation('setup', 'setup')).toBe('setup');
    expect(stepForStation('setup', 'configure')).toBeUndefined();
    expect(stepForStation('sources', 'source')).toBe('source');
    expect(stepForStation('sources', undefined)).toBeUndefined();
  });
});

describe('the step markers in the URL', () => {
  it('accepts source and setup', () => {
    expect(validateNewAppSearch({ step: 'setup' }).step).toBe('setup');
    expect(validateNewAppSearch({ step: 'source' }).step).toBe('source');
    expect(validateNewAppSearch({ step: 'nope' }).step).toBeUndefined();
  });

  it('knows which sources have a Setup', () => {
    expect(
      ['git', 'template', 'empty', 'container', 'worker', 'import'].map((s) => hasSetup(s as never))
    ).toEqual([true, true, false, true, true, true]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/dashboard/new-app-station.test.ts`
Expected: FAIL with `Failed to resolve import "./new-app-station"`.

- [ ] **Step 3: Implement**

```ts
// src/components/dashboard/new-app-station.ts
import type { AppSource, NewAppSearch } from './new-app-source';

export type Station = 'sources' | 'setup' | 'configure' | 'review';

const WITH_SETUP: readonly AppSource[] = ['git', 'template', 'container', 'worker', 'import'];

/** Empty needs no setup; every other source has a page of its own. */
export function hasSetup(source?: AppSource): boolean {
  return source !== undefined && WITH_SETUP.includes(source);
}

/**
 * Where the wizard is, from the URL. A source named in the URL (a GitHub
 * return, a template link) lands on its Setup; one only inferred (Git,
 * preselected because GitHub is connected) leaves the person on Sources to
 * see the choices. Configure and Review are reachable only once what they
 * need is valid, so a reloaded URL falls back to the earliest unfinished
 * station rather than exposing an invalid one.
 */
export function stationFor(i: {
  step?: NewAppSearch['step'];
  source?: AppSource;
  named: boolean;
  sourceValid: boolean;
  nameValid: boolean;
}): Station {
  const fallback: Station = hasSetup(i.source) ? 'setup' : 'sources';
  if (i.step === 'review' || i.step === 'configure') {
    if (!i.sourceValid) return fallback;
    return i.step === 'review' && i.nameValid ? 'review' : 'configure';
  }
  if (i.step === 'setup')
    return hasSetup(i.source) ? 'setup' : i.sourceValid ? 'configure' : 'sources';
  if (i.step === 'source') return 'sources';
  return i.named && hasSetup(i.source) ? 'setup' : 'sources';
}

/** The `step` the URL should carry to come back to `station`. */
export function stepForStation(
  station: Station,
  step?: NewAppSearch['step']
): NewAppSearch['step'] {
  if (station === 'review') return 'review';
  if (station === 'configure') return 'configure';
  if (station === 'setup') return step === 'setup' ? 'setup' : undefined;
  return step === 'source' ? 'source' : undefined;
}
```

In `src/components/dashboard/new-app-source.ts`, widen the step type and the validator:

```ts
  step?: 'source' | 'setup' | 'configure' | 'review';
```

```ts
    step:
      search.step === 'source' ||
      search.step === 'setup' ||
      search.step === 'configure' ||
      search.step === 'review'
        ? search.step
        : undefined,
```

These replace the existing `step?: 'configure' | 'review';` line and the existing `step: search.step === 'configure' || search.step === 'review' ? search.step : undefined,` line.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/components/dashboard/new-app-station.test.ts src/components/dashboard/new-app-source.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/dashboard/new-app-station.ts src/components/dashboard/new-app-station.test.ts src/components/dashboard/new-app-source.ts
git add src/components/dashboard/new-app-station.ts src/components/dashboard/new-app-station.test.ts src/components/dashboard/new-app-source.ts
git commit -m "feat(new-app): one function decides the current station from the URL"
```

---

### Task 2: `useShaderCanvas` learns `active` and `redraw()`

**Files:**

- Modify: `src/components/landing/shaders/use-shader-canvas.ts`
- Test: `src/components/landing/shaders/use-shader-canvas.test.tsx`

**Interfaces:**

- Produces: the option `active?: boolean` (default `true`) and `stillAt?: number` (seconds of the still frame, default `0`). The hook returns `{ hostRef, canvasRef, supported, redraw }`, where `redraw(): void` draws one frame if the loop is not running.

- [ ] **Step 1: Write the failing test.** It uses a fake WebGL context, so the hook's real loop runs.

```tsx
// src/components/landing/shaders/use-shader-canvas.test.tsx
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShaderCanvas } from './use-shader-canvas';

let draws = 0;
let rafs: FrameRequestCallback[] = [];

function fakeGl() {
  const fn = () => () => undefined;
  const special: Record<string, unknown> = {
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    isContextLost: () => false,
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    drawArrays: () => {
      draws += 1;
    },
  };
  return new Proxy({}, { get: (_, k: string) => (k in special ? special[k] : fn()) });
}

beforeEach(() => {
  draws = 0;
  rafs = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeGl() as never);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafs.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Probe({ active, onRedraw }: { active: boolean; onRedraw?: (r: () => void) => void }) {
  const { hostRef, canvasRef, redraw } = useShaderCanvas({
    frag: 'void main(){}',
    label: 't',
    active,
  });
  onRedraw?.(redraw);
  return (
    <div ref={hostRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

describe('useShaderCanvas active', () => {
  it('runs its loop when active, as before', () => {
    render(<Probe active />);
    expect(rafs.length).toBeGreaterThan(0);
  });

  it('draws one still frame and schedules nothing when inactive', () => {
    render(<Probe active={false} />);
    expect(draws).toBe(1);
    expect(rafs).toHaveLength(0);
  });

  it('starts when it becomes active and holds a still frame when it stops', () => {
    const { rerender } = render(<Probe active={false} />);
    rerender(<Probe active />);
    expect(rafs.length).toBeGreaterThan(0);
    const before = draws;
    rerender(<Probe active={false} />);
    expect(draws).toBe(before + 1);
  });

  it('repaints a still frame on redraw (a theme change)', () => {
    let redraw: () => void = () => undefined;
    render(<Probe active={false} onRedraw={(r) => (redraw = r)} />);
    const before = draws;
    redraw();
    expect(draws).toBe(before + 1);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/landing/shaders/use-shader-canvas.test.tsx`
Expected: FAIL. With no `active` support the loop always runs, so "draws one still frame" sees a scheduled frame, and `redraw` is undefined.

- [ ] **Step 3: Implement** in `use-shader-canvas.ts`:

1. In `interface Options`, add:

```ts
  /** Animate only while true; otherwise hold one still frame. Default true. */
  active?: boolean;
  /** The time (seconds) the still frame shows. Default 0. */
  stillAt?: number;
```

2. In the signature, destructure `active = true, stillAt = 0`. After `const onFrameRef …` lines, add:

```ts
const activeRef = useRef(active);
const stillRef = useRef(stillAt);
const syncRef = useRef<() => void>(() => undefined);
const redrawRef = useRef<() => void>(() => undefined);
useEffect(() => {
  activeRef.current = active;
  stillRef.current = stillAt;
  syncRef.current();
}, [active, stillAt]);
```

3. Replace the body of `sync` with:

```ts
const sync = () => {
  if (reduced.matches || !activeRef.current) {
    stop();
    resize();
    draw(reduced.matches ? 0 : stillRef.current * 1000); // one still frame
    return;
  }
  if (onscreen && pageVisible) {
    if (!running) {
      running = true;
      start = performance.now() - 1;
      raf = requestAnimationFrame(tick);
    }
  } else {
    stop();
  }
};
syncRef.current = sync;
redrawRef.current = () => {
  if (!running) draw(stillRef.current * 1000);
};
```

4. In the cleanup, before `stop();`, add `syncRef.current = () => undefined; redrawRef.current = () => undefined;`.
5. Return a stable `redraw`, so callers can list it as an effect dependency. Add `useCallback` to the `react` import, and:

```ts
const redraw = useCallback(() => redrawRef.current(), []);
return { hostRef, canvasRef, supported, redraw };
```

- [ ] **Step 4: Run it and see it pass, with the landing's shaders unchanged**

Run: `npx vitest run src/components/landing && npx tsc --noEmit && npx eslint src/components/landing/shaders`
Expected: all PASS (the 4 new tests plus the existing landing tests), tsc clean, no new lint warnings. If the React Compiler lint flags a ref written during render, move that write into the `useEffect` above, never into render.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/landing/shaders/use-shader-canvas.ts src/components/landing/shaders/use-shader-canvas.test.tsx
git add src/components/landing/shaders/use-shader-canvas.ts src/components/landing/shaders/use-shader-canvas.test.tsx
git commit -m "feat(shaders): hold a still frame until active, and repaint on request"
```

---

### Task 3: Six source scenes and the token colour reader

**Files:**

- Create: `src/components/dashboard/new-app-shaders.ts` (the six fragment shaders)
- Create: `src/components/dashboard/source-shader.tsx` (the component and `readColorToken`)
- Test: `src/components/dashboard/source-shader.test.tsx`

**Interfaces:**

- Consumes: `useShaderCanvas` with `active` and `redraw` (Task 2), and `GLSL_PRELUDE`.
- Produces:
  - `function readColorToken(name: string, el?: Element): [number, number, number]`, which parses `#rgb`, `#rrggbb`, `#rrggbbaa` (alpha ignored) and `rgb()`/`rgba()`. It returns 0–1 floats; unknown input gives `[0, 0, 0]`.
  - `function SourceShader({ id, active }: { id: AppSource; active: boolean }): JSX.Element`, which renders `<div aria-hidden="true" class="nab-preview" data-preview={id}>` with a canvas, or with `<span class="nab-fallback" data-source={id}>` when WebGL is unavailable.
  - `const SOURCE_FRAGS: Record<AppSource, string>`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/source-shader.test.tsx
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
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/dashboard/source-shader.test.tsx`
Expected: FAIL with `Failed to resolve import "./source-shader"`.

- [ ] **Step 3: Implement the shaders.** Every scene computes an intensity `v` from 0 to 1, then `shade(v)` quantises it with the Bayer dither on chunky pixels and maps it from the card colour through the brand colour to a bright core.

```ts
// src/components/dashboard/new-app-shaders.ts
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
  gl_FragColor = vec4(shade(clamp(v, 0.0, 1.0)), 1.0);
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
```

- [ ] **Step 4: Implement the component**

```tsx
// src/components/dashboard/source-shader.tsx
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
```

- [ ] **Step 5: Run it and see it pass**

Run: `npx vitest run src/components/dashboard/source-shader.test.tsx && npx tsc --noEmit`
Expected: PASS (6 + 2 + 2 = 10 tests).

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/components/dashboard/new-app-shaders.ts src/components/dashboard/source-shader.tsx src/components/dashboard/source-shader.test.tsx
git add src/components/dashboard/new-app-shaders.ts src/components/dashboard/source-shader.tsx src/components/dashboard/source-shader.test.tsx
git commit -m "feat(new-app): a generative shader scene for each source"
```

---

### Task 4: The bento on shaders and container queries

**Files:**

- Modify: `src/components/dashboard/new-app-bento.tsx`
- Modify: `src/components/dashboard/new-app-bento.css`
- Delete: `src/components/dashboard/new-app-previews.tsx`, `src/components/dashboard/new-app-previews.test.tsx`
- Create: `src/components/dashboard/new-app-bento-css.test.ts`
- Test: `src/components/dashboard/new-app-bento.test.tsx`

**Interfaces:**

- Consumes: `SourceShader` (Task 3).
- Produces: the same `NewAppBento` props as v1, unchanged. In `single` mode the cell shows no index and no eyebrow.

- [ ] **Step 1: Write the failing tests.** Append inside `describe('NewAppBento', …)` in `new-app-bento.test.tsx`:

```tsx
it('plays only the hovered or focused cell, and the selected one', async () => {
  const { container } = setup({ selected: 'git' });
  const playing = () =>
    [...container.querySelectorAll('[data-preview]')]
      .filter((p) => p.closest('.nab-cell')?.getAttribute('data-active') === 'true')
      .map((p) => p.getAttribute('data-preview'));
  expect(playing()).toEqual(['git']);
  await userEvent.hover(screen.getByRole('button', { name: 'Template' }));
  expect(playing()).toEqual(['git', 'template']);
  await userEvent.unhover(screen.getByRole('button', { name: 'Template' }));
  expect(playing()).toEqual(['git']);
});

it('numbers nothing in onboarding, where there is one cell', () => {
  setup({ single: true, selected: 'git' });
  const git = screen.getByRole('button', { name: 'Git repository' });
  expect(git).not.toHaveTextContent('01');
  expect(git).not.toHaveTextContent('From code');
});
```

and create:

```ts
// src/components/dashboard/new-app-bento-css.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve('src/components/dashboard/new-app-bento.css'), 'utf8');

describe('new-app-bento.css', () => {
  it('uses tokens only', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\bdark\b/);
  });

  // The review measured clipped cells at 1024–1280 with the sidebar open:
  // the grid must respond to its own width, not the window's.
  it('lays the grid out by container queries, not viewport media queries', () => {
    expect(css).toMatch(/container-type: inline-size/);
    expect(css).toMatch(/@container nab \(min-width: 46rem\)/);
    expect(css).toMatch(/@container nab \(min-width: 30rem\)/);
    expect(css).not.toMatch(/@media \(min-width/);
  });

  it('keeps the selection ring for focus and a still fallback for reduced motion', () => {
    expect(css).toMatch(/\.nab-cell:focus-visible/);
    expect(css).toMatch(/\.nab-fallback/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/dashboard/new-app-bento.test.tsx src/components/dashboard/new-app-bento-css.test.ts`
Expected: FAIL. There is no `data-active` yet, onboarding still shows "01", and the CSS has no container queries.

- [ ] **Step 3: Implement the bento.** In `new-app-bento.tsx`:

1. Replace `import { SourcePreview } from './new-app-previews';` with `import { SourceShader } from './source-shader';` and add `import { useState } from 'react';`.
2. Inside the component, before `const cell`, add `const [hot, setHot] = useState<AppSource | null>(null);`.
3. On the `<button>`, add:

```tsx
        data-active={hot === id || selected === id}
        onPointerEnter={() => setHot(id)}
        onPointerLeave={() => setHot((h) => (h === id ? null : h))}
        onFocus={() => setHot(id)}
        onBlur={() => setHot((h) => (h === id ? null : h))}
```

4. Replace `<SourcePreview id={id} />` with `<SourceShader id={id} active={hot === id || selected === id} />`.
5. Wrap the eyebrow `<span className="flex items-center justify-between …">` in `{!single && ( … )}`, and add `gap-3` to its class.
6. Wrap both returned grids in `<div className="nab-wrap">…</div>`.

- [ ] **Step 4: Implement the stylesheet.** In `new-app-bento.css`:

  1. **Container queries.** Delete the two viewport blocks (`@media (min-width: 640px) {…}` and `@media (min-width: 1024px) {…}` for placement) and the hero `@media (min-width: 1024px) {…}` block. Add:

```css
.nab-wrap {
  container: nab / inline-size;
  container-type: inline-size;
}

@container nab (min-width: 30rem) {
  .nab-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .nab-cell[data-source='git'],
  .nab-cell[data-source='import'] {
    grid-column: 1 / -1;
  }
}

@container nab (min-width: 46rem) {
  .nab-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .nab-cell[data-source='git'] {
    grid-column: 1 / 3;
    grid-row: 1 / 3;
  }
  .nab-cell[data-source='template'] {
    grid-column: 3;
    grid-row: 1;
  }
  .nab-cell[data-source='empty'] {
    grid-column: 3;
    grid-row: 2;
  }
  .nab-cell[data-source='container'] {
    grid-column: 1;
    grid-row: 3;
  }
  .nab-cell[data-source='worker'] {
    grid-column: 2 / 4;
    grid-row: 3;
  }
  .nab-cell[data-source='import'] {
    grid-column: 1 / -1;
    grid-row: 4;
  }
  .nab-grid:not([data-single]) .nab-cell[data-source='git'] .nab-preview {
    height: auto;
    min-height: 14rem;
    flex: 1;
  }
}
```

2. **Preview and fallback.** Make `.nab-preview` `position: relative`, and keep its height, border and radius. Add the fallback:

```css
.nab-fallback {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      120% 90% at 30% 70%,
      color-mix(in srgb, var(--brand) 38%, transparent),
      transparent 60%
    ),
    var(--card);
}
.nab-fallback[data-source='template'] {
  background-position: 70% 30%;
}
.nab-fallback[data-source='worker'] {
  background:
    linear-gradient(
      90deg,
      transparent 40%,
      color-mix(in srgb, var(--brand) 45%, transparent),
      transparent 60%
    ),
    var(--card);
}
```

3. **Remove v1's scene CSS.** Delete everything from the `/* --- Scene parts` comment through the last `.nab-cell … .nab-fan path` rule, so the scenes' keyframes and parts go. Keep the `@media (prefers-reduced-motion: reduce)` block, which still stops the cell's transition.

- [ ] **Step 5: Delete v1's previews**

```bash
git rm src/components/dashboard/new-app-previews.tsx src/components/dashboard/new-app-previews.test.tsx
```

- [ ] **Step 6: Run and see them pass**

Run: `npx vitest run src/components/dashboard/new-app-bento.test.tsx src/components/dashboard/new-app-bento-css.test.ts src/components/dashboard/new-app-wizard.test.tsx && npx tsc --noEmit && npx eslint src/components/dashboard/new-app-bento.tsx`
Expected: PASS (9 bento + 3 css + wizard suite), tsc clean, no lint warning.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/components/dashboard/new-app-bento.tsx src/components/dashboard/new-app-bento.css src/components/dashboard/new-app-bento.test.tsx src/components/dashboard/new-app-bento-css.test.ts
git add -A src/components/dashboard/new-app-bento.tsx src/components/dashboard/new-app-bento.css src/components/dashboard/new-app-bento.test.tsx src/components/dashboard/new-app-bento-css.test.ts src/components/dashboard/new-app-previews.tsx src/components/dashboard/new-app-previews.test.tsx
git commit -m "feat(new-app): shader scenes in the bento, laid out by container queries"
```

---

### Task 5: The layouts: Track stage, Fold strip, dev switch

**Files:**

- Create: `src/components/dashboard/new-app-layout.tsx`
- Test: `src/components/dashboard/new-app-layout.test.tsx`

**Interfaces:**

- Consumes: `Station` (Task 1), `SOURCES` (`new-app-sources.ts`), `AppSource`.
- Produces:
  - `type NewAppLayout = 'track' | 'fold'`
  - `function useNewAppLayout(): [NewAppLayout, (l: NewAppLayout) => void]`. It reads local storage `gregale.dev.newAppLayout` only in dev, defaulting to `'track'`.
  - `function DevLayoutSwitch({ layout, onChange }): JSX.Element | null`, which is `null` unless `import.meta.env.DEV`. It is a `role="radiogroup"` with two `role="radio"` options, so it never collides with the wizard's `aria-pressed` buttons.
  - `function NewAppStage({ layout, station, back, strip, children }: { layout: NewAppLayout; station: Station; back?: { label: string; onBack: () => void }; strip?: ReactNode; children: ReactNode }): JSX.Element`
  - `function NewAppStrip({ selected, onSelect }: { selected?: AppSource; onSelect: (id: AppSource) => void }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/new-app-layout.test.tsx
import { render, renderHook, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevLayoutSwitch, NewAppStage, NewAppStrip, useNewAppLayout } from './new-app-layout';

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('useNewAppLayout', () => {
  it('starts on Track, remembers a choice in dev', () => {
    const { result, unmount } = renderHook(() => useNewAppLayout());
    expect(result.current[0]).toBe('track');
    act(() => result.current[1]('fold'));
    expect(result.current[0]).toBe('fold');
    unmount();
    expect(renderHook(() => useNewAppLayout()).result.current[0]).toBe('fold');
  });

  it('ignores a stored choice outside dev', () => {
    localStorage.setItem('gregale.dev.newAppLayout', 'fold');
    vi.stubEnv('DEV', false);
    expect(renderHook(() => useNewAppLayout()).result.current[0]).toBe('track');
  });
});

describe('DevLayoutSwitch', () => {
  it('offers both layouts in dev and reports a choice', async () => {
    const onChange = vi.fn();
    render(<DevLayoutSwitch layout="track" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Track' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Fold' }));
    expect(onChange).toHaveBeenCalledWith('fold');
  });

  it('is absent outside dev', () => {
    vi.stubEnv('DEV', false);
    const { container } = render(<DevLayoutSwitch layout="track" onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('NewAppStage', () => {
  it('Track: shows only the current station and a named way back', async () => {
    const onBack = vi.fn();
    render(
      <NewAppStage layout="track" station="setup" back={{ label: 'Sources', onBack }}>
        <p>setup fields</p>
      </NewAppStage>
    );
    expect(screen.getByText('setup fields')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Sources' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('Track: no way back from the first station', () => {
    render(
      <NewAppStage layout="track" station="sources">
        <p>grid</p>
      </NewAppStage>
    );
    expect(screen.queryByRole('button', { name: /Back to/ })).not.toBeInTheDocument();
  });

  it('Fold: puts the strip beside every station after Sources', () => {
    const { rerender } = render(
      <NewAppStage layout="fold" station="sources" strip={<nav aria-label="strip" />}>
        <p>grid</p>
      </NewAppStage>
    );
    expect(screen.queryByRole('navigation', { name: 'strip' })).not.toBeInTheDocument();
    rerender(
      <NewAppStage layout="fold" station="configure" strip={<nav aria-label="strip" />}>
        <p>configure</p>
      </NewAppStage>
    );
    expect(screen.getByRole('navigation', { name: 'strip' })).toBeInTheDocument();
  });
});

describe('NewAppStrip', () => {
  it('lists the six sources with the selection pressed, and switches', async () => {
    const onSelect = vi.fn();
    render(<NewAppStrip selected="template" onSelect={onSelect} />);
    const nav = screen.getByRole('navigation', { name: 'Sources' });
    const buttons = nav.querySelectorAll('button');
    expect(buttons).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Template' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onSelect).toHaveBeenCalledWith('import');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/dashboard/new-app-layout.test.tsx`
Expected: FAIL with `Failed to resolve import "./new-app-layout"`.

- [ ] **Step 3: Implement**

```tsx
// src/components/dashboard/new-app-layout.tsx
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft } from 'iconoir-react';
import { cn } from '@/lib/utils';
import type { AppSource } from './new-app-source';
import { SOURCES } from './new-app-sources';
import type { Station } from './new-app-station';

export type NewAppLayout = 'track' | 'fold';

const KEY = 'gregale.dev.newAppLayout';
const ORDER: Record<Station, number> = { sources: 0, setup: 1, configure: 2, review: 3 };
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Which layout the wizard uses. Two exist while Bahadir chooses; outside dev
 * builds it is always Track, and the stored choice is never read.
 */
export function useNewAppLayout(): [NewAppLayout, (l: NewAppLayout) => void] {
  const [layout, setLayout] = useState<NewAppLayout>(() => {
    if (!import.meta.env.DEV) return 'track';
    try {
      return localStorage.getItem(KEY) === 'fold' ? 'fold' : 'track';
    } catch {
      return 'track';
    }
  });
  const choose = (next: NewAppLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Without storage the choice lasts this visit.
    }
  };
  return [layout, choose];
}

/** Dev only: flip between the two layouts while comparing them. */
export function DevLayoutSwitch({
  layout,
  onChange,
}: {
  layout: NewAppLayout;
  onChange: (l: NewAppLayout) => void;
}) {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      role="radiogroup"
      aria-label="New app layout (dev only)"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-1 rounded-full border border-border bg-popover p-1 font-mono text-[11px] shadow-elevation-3"
    >
      <span className="px-2 text-muted-foreground">Layout</span>
      {(['track', 'fold'] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={layout === l}
          onClick={() => onChange(l)}
          className={cn(
            'rounded-full px-3 py-1 capitalize transition-colors',
            layout === l ? 'bg-brand text-primary-foreground' : 'text-foreground hover:bg-accent'
          )}
        >
          {l === 'track' ? 'Track' : 'Fold'}
        </button>
      ))}
    </div>
  );
}

/**
 * Where the current station is shown. Track: one station at a time, sliding
 * sideways, with a named sliver to go back. Fold: the sources strip stays
 * beside every station after Sources.
 */
export function NewAppStage({
  layout,
  station,
  back,
  strip,
  children,
}: {
  layout: NewAppLayout;
  station: Station;
  back?: { label: string; onBack: () => void };
  strip?: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [seen, setSeen] = useState(station);
  const [dir, setDir] = useState(1);
  if (seen !== station) {
    setDir(ORDER[station] >= ORDER[seen] ? 1 : -1);
    setSeen(station);
  }
  const slide = reduce
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : {
        initial: { x: `${dir * 8}%`, opacity: 0 },
        animate: { x: '0%', opacity: 1 },
        exit: { x: `${dir * -8}%`, opacity: 0 },
      };

  const body = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={station}
        {...slide}
        transition={{ duration: reduce ? 0 : 0.42, ease: EASE }}
        className="min-w-0"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );

  if (layout === 'fold') {
    const folded = station !== 'sources' && strip;
    return (
      <div
        data-layout="fold"
        className={cn('grid min-w-0 gap-6', folded && '@[40rem]:grid-cols-[12rem_minmax(0,1fr)]')}
      >
        {folded && (
          <motion.div
            initial={reduce ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduce ? 0 : 0.42, ease: EASE }}
          >
            {strip}
          </motion.div>
        )}
        {body}
      </div>
    );
  }

  return (
    <div
      data-layout="track"
      className={cn(
        'grid min-w-0 gap-4 overflow-x-clip',
        back && 'grid-cols-[3.5rem_minmax(0,1fr)]'
      )}
    >
      {back && (
        <button
          type="button"
          onClick={back.onBack}
          aria-label={`Back to ${back.label}`}
          className="group flex min-h-40 flex-col items-center gap-3 border border-border bg-card py-4 text-muted-foreground transition-colors hover:border-border-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ArrowLeft
            aria-hidden
            className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
          />
          <span
            aria-hidden
            className="font-mono text-[10.5px] uppercase tracking-[0.08em] [writing-mode:vertical-rl] rotate-180"
          >
            {back.label}
          </span>
        </button>
      )}
      {body}
    </div>
  );
}

/** Fold's strip: every source, switchable, beside the station. */
export function NewAppStrip({
  selected,
  onSelect,
}: {
  selected?: AppSource;
  onSelect: (id: AppSource) => void;
}) {
  return (
    <nav
      aria-label="Sources"
      className="nab-strip flex flex-col gap-px border border-border bg-border"
    >
      {SOURCES.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={selected === s.id}
          onClick={() => onSelect(s.id)}
          className={cn(
            'flex h-12 items-center gap-3 bg-card px-3 text-left text-[13px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
            selected === s.id && 'shadow-[inset_2px_0_0_var(--brand)]'
          )}
        >
          <span aria-hidden className="nab-swatch h-6 w-6 shrink-0 rounded-md" data-source={s.id} />
          <span className="truncate">{s.name}</span>
        </button>
      ))}
    </nav>
  );
}
```

Add to `new-app-bento.css`:

```css
/* Fold's strip swatches: static, from the same tokens, never WebGL. */
.nab-swatch {
  background:
    radial-gradient(
      120% 120% at 30% 70%,
      color-mix(in srgb, var(--brand) 55%, transparent),
      transparent 70%
    ),
    var(--card);
  border: 1px solid var(--border);
}
```

The Fold grid's `@[40rem]:grid-cols-…` is a Tailwind 4 container variant. It needs a parent with the `@container` class, which Task 7 adds on the wizard's content column. If Tailwind 4 in this repo does not support `@[40rem]:`, rule to `lg:grid-cols-[12rem_minmax(0,1fr)]` and record it in the ledger.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/components/dashboard/new-app-layout.test.tsx && npx tsc --noEmit && npx eslint src/components/dashboard/new-app-layout.tsx`
Expected: PASS (8 tests). The tsc and lint must be clean. Setting state during render is the React-sanctioned "adjust on prop change" pattern; if the React Compiler lint still flags it, switch to a `useRef` of the previous station read in an effect, and record a ruling.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/dashboard/new-app-layout.tsx src/components/dashboard/new-app-layout.test.tsx src/components/dashboard/new-app-bento.css
git add src/components/dashboard/new-app-layout.tsx src/components/dashboard/new-app-layout.test.tsx src/components/dashboard/new-app-bento.css
git commit -m "feat(new-app): two ways to move between stations, and a dev switch to compare them"
```

---

### Task 6: Header out of the rail; rail steps, source label and its own scroll; Review heading

**Files:**

- Modify: `src/components/dashboard/new-app-rail.tsx`
- Test: `src/components/dashboard/new-app-rail.test.tsx`

**Interfaces:**

- Produces:
  - `function NewAppHeader({ title, description, back }: { title: string; description: string; back: boolean }): JSX.Element`, which holds the "← All apps" link, the `h1` and the description.
  - `NewAppRail({ step, rows, stepCount = 3, sourceLabel }: { step?: 0 | 1 | 2; rows: SummaryRow[]; stepCount?: 1 | 3; sourceLabel?: string })`. It loses `title`, `description` and `back`, and renders `<aside aria-label="New app progress">`.
  - `NewAppReviewGrid` gains a visually present `h2` reading "Review" above its grid.

- [ ] **Step 1: Rewrite the rail tests** in `new-app-rail.test.tsx` for the new interface. Replace the first three `NewAppRail` tests with:

```tsx
describe('NewAppHeader', () => {
  it('heads the page and links back to the apps', () => {
    render(<NewAppHeader title="New app" description="Choose a source." back />);
    expect(screen.getByRole('heading', { level: 1, name: 'New app' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All apps/ })).toHaveAttribute('href', '/dashboard/apps');
  });
});

describe('NewAppRail', () => {
  it('is a named landmark that marks the current step and the ones done', () => {
    render(<NewAppRail step={1} rows={[]} />);
    expect(screen.getByRole('complementary', { name: 'New app progress' })).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'App creation steps' })).getAllByRole('listitem');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveAttribute('data-state', 'done');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('names the chosen source under step one, and shows one step for self-contained sources', () => {
    const { rerender } = render(<NewAppRail step={0} rows={[]} sourceLabel="Template" />);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Template');
    rerender(<NewAppRail step={0} rows={[]} stepCount={1} sourceLabel="Container image" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('scrolls itself when taller than the screen', () => {
    render(<NewAppRail step={0} rows={rows} />);
    expect(screen.getByRole('complementary')).toHaveClass('lg:overflow-y-auto');
  });
```

Keep the existing "hides the steps when there is no step", "lists only what is known…" and "wraps long values…" tests, changing their render calls to `<NewAppRail step={…} rows={…} />`. Then add to `describe('NewAppReviewGrid', …)`:

```tsx
it('heads the review', () => {
  render(<NewAppReviewGrid rows={all} />);
  expect(screen.getByRole('heading', { level: 2, name: 'Review' })).toBeInTheDocument();
});
```

Update the import to `import { NewAppHeader, NewAppRail, NewAppReviewGrid } from './new-app-rail';`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/dashboard/new-app-rail.test.tsx`
Expected: FAIL. `NewAppHeader` is not exported, the rail has no `aria-label`, and there is no Review heading.

- [ ] **Step 3: Implement** in `new-app-rail.tsx`:

  1. Add `NewAppHeader`, built from the header markup currently at the top of `NewAppRail`:

```tsx
export function NewAppHeader({
  title,
  description,
  back,
}: {
  title: string;
  description: string;
  back: boolean;
}) {
  return (
    <header className="flex flex-col gap-3 lg:col-span-2">
      {back && (
        <Link
          to="/dashboard/apps"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          All apps
        </Link>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}
```

2. Change `NewAppRail`'s props to `{ step, rows, stepCount = 3, sourceLabel }`. Delete the header `<div className="flex flex-col gap-3">…</div>` from it, and change the `<aside>` opening to:

```tsx
    <aside
      aria-label="New app progress"
      className="flex flex-col gap-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
    >
```

3. Iterate `STEPS.slice(0, stepCount)` instead of `STEPS`. Inside each `<li>`, after `{label}`, add:

```tsx
{
  i === 0 && sourceLabel && (
    <span className="ml-auto truncate text-xs text-muted-foreground">{sourceLabel}</span>
  );
}
```

4. In `NewAppReviewGrid`, wrap the return in a fragment and put `<h2 className="text-base font-medium">Review</h2>` before the `<dl>`.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/components/dashboard/new-app-rail.test.tsx && npx tsc --noEmit`
Expected: the rail tests PASS. tsc reports errors **only** in `new-app-wizard.tsx`, which still passes the old props; Task 7 fixes them.

- [ ] **Step 5: Commit** (the tree typechecks again after Task 7; commit both together if preferred, and note it in the ledger)

```bash
npx prettier --write src/components/dashboard/new-app-rail.tsx src/components/dashboard/new-app-rail.test.tsx
git add src/components/dashboard/new-app-rail.tsx src/components/dashboard/new-app-rail.test.tsx
```

Do not commit yet. Task 7's commit includes these files, so no commit has a broken typecheck.

---

### Task 7: The wizard on stations

**Files:**

- Modify: `src/components/dashboard/new-app-wizard.tsx`
- Modify: `src/routes/dashboard.apps.new.tsx`
- Test: `src/components/dashboard/new-app-wizard.test.tsx`, `src/routes/-dashboard.new-app.test.tsx`

**Interfaces:**

- Consumes:
  - `stationFor`, `stepForStation`, `hasSetup`, `Station` (Task 1);
  - `NewAppStage`, `NewAppStrip`, `useNewAppLayout`, `DevLayoutSwitch`, `NewAppLayout` (Task 5);
  - `NewAppHeader`, the new `NewAppRail` props (Task 6).
- Produces: `NewAppWizardProps.layout?: NewAppLayout`, default `'track'`.

- [ ] **Step 1: Write the failing tests.** Append to `describe('NewAppWizard source picker', …)`:

```tsx
it('moves to the chosen source’s own station, and back to the sources', async () => {
  const user = userEvent.setup();
  render(<NewAppWizard />);
  await user.click(screen.getByRole('button', { name: 'Template' }));
  expect(await screen.findByText(/Pick a starter to prefill your app/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Git repository' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back to Sources' }));
  expect(await screen.findByRole('button', { name: 'Template' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

it('opens a container image inside the wizard, not on another page', async () => {
  const user = userEvent.setup();
  render(<NewAppWizard />);
  await user.click(screen.getByRole('button', { name: 'Container image' }));
  expect(await screen.findByText('HTTP image setup')).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'New app progress' })).toBeInTheDocument();
});

it('goes straight to Configure for an empty app', async () => {
  const user = userEvent.setup();
  render(<NewAppWizard />);
  await user.click(screen.getByRole('button', { name: 'Empty app' }));
  expect(await screen.findByLabelText('App name')).toBeInTheDocument();
});
```

The "Pick a starter" text is the template catalog's intro, rendered by `TemplateCatalog`. If the wizard test file mocks the catalog, use the mocked catalog's text instead and record it in the ledger.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/components/dashboard/new-app-wizard.test.tsx -t "own station|container image inside|straight to Configure"`
Expected: FAIL. Picking a cell doesn't navigate, and Container swaps to the old page with no rail.

- [ ] **Step 3: Compute the station.** In `new-app-wizard.tsx`:

  1. Add the imports:

```ts
import { hasSetup, stationFor, stepForStation, type Station } from './new-app-station';
import { NewAppStage, NewAppStrip, type NewAppLayout } from './new-app-layout';
```

Change `import { NewAppRail, NewAppReviewGrid } from './new-app-rail';` to `import { NewAppHeader, NewAppRail, NewAppReviewGrid } from './new-app-rail';`.

2. Add `layout?: NewAppLayout;` to `NewAppWizardProps` (documented: "Track or Fold; the route passes the dev choice"), and destructure `layout = 'track'` in `CreateAppWizard`.
3. Replace the line `const step = !sourceValid ? 0 : search.step === 'review' && nameValid ? 2 : search.step ? 1 : 0;` and the `normalizedStep` line after it with:

```ts
const station: Station = stationFor({
  step: search.step,
  source,
  named: Boolean(search.source || search.template),
  sourceValid,
  nameValid,
});
const step = station === 'review' ? 2 : station === 'configure' ? 1 : 0;
const normalizedStep = stepForStation(station, search.step);
```

4. Change `setSource` so picking moves forward:

```ts
const setSource = (next: AppSource) => {
  sourceValidation.resetValidation();
  changeSearch({
    ...search,
    source: next,
    template: next === 'template' ? templateSlug : undefined,
    step: hasSetup(next) ? 'setup' : 'configure',
  });
};
```

5. Add, after `setStep`:

```ts
// Back from a source's own page returns to the choices, marked so the URL
// does not bounce straight back into that page.
const toSources = () => {
  sourceValidation.resetValidation();
  changeSearch({ ...search, source, step: 'source' });
};
```

- [ ] **Step 4: Split the source step into Sources and Setup.** In the `form` JSX:

  1. Replace the `step === 0 && (` motion block. Its form, bento, error and capabilities become the Sources station; its Git panel, template part and Continue become the Setup station. All of it is rendered through `NewAppStage` instead of the old `AnimatePresence`. The whole content column becomes:

```tsx
<div className="@container flex min-w-0 flex-col gap-6">
  <NewAppStage
    layout={layout}
    station={station}
    back={
      layout === 'track' && station !== 'sources' && !onboarding
        ? station === 'setup' || (station === 'configure' && !hasSetup(source))
          ? { label: 'Sources', onBack: toSources }
          : station === 'configure'
            ? { label: 'Setup', onBack: () => setStep(0) }
            : { label: 'Configure', onBack: () => setStep(1) }
        : undefined
    }
    strip={
      layout === 'fold' && !onboarding ? (
        <NewAppStrip selected={source} onSelect={setSource} />
      ) : undefined
    }
  >
    {station === 'sources' && renderSources()}
    {station === 'setup' && renderSetup()}
    {station === 'configure' && renderConfigure()}
    {station === 'review' && renderReview()}
  </NewAppStage>
</div>
```

2. Turn each old step body into a function declared before `const form`, with its **content unchanged** except as listed.

**`renderSources()`** returns, in a `<div className="flex flex-col gap-4">`:

- the `<form id={`${uid}-source-form`} …>`, whose `onSubmit` validates only that a source is chosen:

```tsx
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    sourceValidation.validate(
                      { 'source-git': source ? undefined : sourceErrors['source-git'] },
                      event.currentTarget
                    )
                  )
                    changeSearch({
                      ...search,
                      source,
                      step: hasSetup(source) ? 'setup' : 'configure',
                    });
                }}
```

- `<NewAppBento …/>` (unchanged props);
- the `{sourceLevelError && <FieldError …/>}` line;
- `{!onboarding && <NewAppCapabilities />}`;
- the Continue button block, unchanged.

**`renderSetup()`** returns, in a `<div className="flex flex-col gap-4">`:

- in onboarding, the single cell as the station's header: `{onboarding && <NewAppBento uid={uid} formId={`${uid}-source-form`} selected="git" onSelect={setSource} single />}`;
- for `container` or `worker`: `<ImageDeployForm kind={source === 'worker' ? 'worker' : 'http'} />`, and nothing else;
- for `import`: nothing (ProjectImport stays where it is mounted today; see 4.4);
- otherwise:
  - a `<form id={`${uid}-source-form`} noValidate aria-label="Set up the source" onSubmit={…}>`. Its `onSubmit` body is the old one: `event.preventDefault(); if (sourceValidation.validate(sourceErrors, event.currentTarget)) setStep(1);`.
  - `{sourceLevelError && <FieldError id={`${uid}-source-error`}>{sourceLevelError}</FieldError>}`
  - the Git connect notice and fields block, and the template block, moved unchanged;
  - the Continue button block, unchanged.

**`renderConfigure()`** and **`renderReview()`** are the existing `step === 1` and `step === 2` motion bodies. Take each `motion.form` or `motion.div` and keep its tag, but drop its `initial`, `animate`, `exit` and `transition` props, since `NewAppStage` animates now. The `motion.form` becomes a plain `<form>` with the same `onSubmit`, `noValidate` and `className`.

3. Replace the old `<NewAppRail …/>` and the header lines with:

```tsx
      <NewAppHeader
        title={onboarding ? 'Deploy your first app' : 'New app'}
        description={
          onboarding
            ? 'Choose a Git repository, configure its runtime, and watch the real build go live.'
            : template
              ? `Starting from the ${template.name} template — source, runtime, and memory are prefilled; the scaffold arrives once the app exists.`
              : 'Choose a source to create your app.'
        }
        back={!onboarding}
      />
      <NewAppRail
        step={step as 0 | 1 | 2}
        rows={station === 'review' ? [] : rows}
        stepCount={source === 'container' || source === 'worker' || source === 'import' ? 1 : 3}
        sourceLabel={station !== 'sources' && source ? sourceName(source) : undefined}
      />
```

Add `import { sourceName } from './new-app-sources';`.

4. In the final `return`, change the ternary so `containerForm` is no longer used. The image form is now Setup's. The return becomes `{deploying ? renderCompletion() : form}`; delete the `containerForm` constant. Keep the ProjectImport mount, but change its condition to `hidden={deploying || source !== 'import' || station !== 'setup'}`, and move it inside `form`'s content column, right after `</NewAppStage>`, so it sits in the station's place.
5. Delete the now-unused `AnimatePresence`, `motion`, `EASE` and `reduce` uses if tsc or lint reports them unused.

- [ ] **Step 5: Route wiring.** In `src/routes/dashboard.apps.new.tsx`:

```tsx
import { DevLayoutSwitch, useNewAppLayout } from '@/components/dashboard/new-app-layout';
```

```tsx
function NewAppPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [layout, setLayout] = useNewAppLayout();
  return (
    <>
      <NewAppWizard
        layout={layout}
        search={search}
        onSearchChange={(next, options) => void navigate({ search: next, ...options })}
      />
      <DevLayoutSwitch layout={layout} onChange={setLayout} />
    </>
  );
}
```

- [ ] **Step 6: Run the wizard and route tests**

Run:

```bash
npx vitest run src/components/dashboard/new-app-wizard.test.tsx src/routes/-dashboard.new-app.test.tsx > .superpowers/sdd/2026-10-21-new-app-stations/t7.log 2>&1; echo $?; grep -E "×|Tests " .superpowers/sdd/2026-10-21-new-app-stations/t7.log
```

Expected: the 3 new tests pass. Existing tests that relied on the inferred Git's fields being on the first screen fail; the likely set is "preselects Git when GitHub is connected", "fills the rail's summary…" and "starts on Git when GitHub is connected…". For each failure:

1. Read the failing assertion.
2. If it expects Setup content on Sources, change only its navigation step: click `Continue` (or the cell) before the assertion.
3. Record `Task 7: Ruling: <test name> — old: <assertion>, new: <assertion> — Setup is its own station (spec §1)`.
4. Any other failure is a wizard bug. Fix the wizard, not the test.

- [ ] **Step 7: The whole check**

Run: `npx tsc --noEmit && npx vitest run --maxWorkers=8 src/components/dashboard src/routes src/components/landing src/lib/conventions.test.ts && npm run lint`
Expected: tsc clean; Vitest exit 0 with no "Errors" line; lint 0 errors and 4 warnings.

- [ ] **Step 8: Commit** (includes Task 6's files)

```bash
npx prettier --write src/components/dashboard/new-app-wizard.tsx src/components/dashboard/new-app-wizard.test.tsx src/routes/dashboard.apps.new.tsx src/routes/-dashboard.new-app.test.tsx src/components/dashboard/new-app-rail.tsx src/components/dashboard/new-app-rail.test.tsx
git add src/components/dashboard/new-app-wizard.tsx src/components/dashboard/new-app-wizard.test.tsx src/routes/dashboard.apps.new.tsx src/routes/-dashboard.new-app.test.tsx src/components/dashboard/new-app-rail.tsx src/components/dashboard/new-app-rail.test.tsx
git commit -m "feat(new-app): the wizard as stations — sources, the source's own page, configure, review"
```

---

### Task 8: Browser pass, both layouts

**Files:**

- Modify: only what this pass finds. Each fix gets a failing test first where expressible.
- Scratch (not committed): `pw/stations-check.mjs` in the session scratchpad.

- [ ] **Step 1: Start the mock and write the check.** Keep the server running from the worktree (`npm run dev:mock -- --port 3010 --strictPort`). The script needs to:
  - Sign in through local storage, as in v1's `bento-check.mjs`.
  - For layout in `['track', 'fold']`: set `localStorage['gregale.dev.newAppLayout']`.
  - For each width in 1024, 1280, 1440 and 390, with the sidebar expanded (the default):
    1. Load `/dashboard/apps/new`. Assert `scrollWidth <= innerWidth`, and that the bento has 3, 2 or 1 columns matching its own width (≥ 46rem, ≥ 30rem, else 1).
    2. For each source in git, template, container, worker and import: click its cell. Assert the URL has `step=setup`, and that the Setup's first control is inside the first viewport (`getBoundingClientRect().top < innerHeight`). Assert no sideways scroll. Go back with "Back to Sources" (Track) or the strip (Fold).
    3. Click Empty and assert "App name" is visible.
  - **WebGL budget:** on Sources, count `canvas` elements with a WebGL context (`document.querySelectorAll('.nab-preview canvas').length`) and assert ≤ 6. Hover one cell; assert its canvas pixels change between two screenshots 400ms apart (`page.screenshot({ clip })` buffers differ).
  - **Shader failures:** collect `page.on('console')` messages, and fail if any contains `shader compile failed` or `link failed`.
  - **Reduced motion:** `page.emulateMedia({ reducedMotion: 'reduce' })`; hover a cell; assert two clips 400ms apart are identical.
  - **GitHub return:** load `/dashboard/apps/new?source=git&github=connected` and assert the Repository picker is visible.
  - **Light polarity:** load `/onboarding` and assert the Setup shows the Git cell and the Repository picker.
  - Screenshot every state into the scratchpad.

- [ ] **Step 2: Run it, read every screenshot, fix.** For each visual or behavioural defect:
  1. Write the smallest failing unit test that can express it.
  2. Fix it.
  3. Re-run the script.

  Record each as a ledger ruling. Judge each screenshot against the spec's intent: the scene reads as its source, nothing clips, Track's slide and Fold's strip look intentional, and the light and dark tokens both read.

- [ ] **Step 3: Gates**

```bash
npm run check
npm run build
```

Then run the tour from a scratch copy against the mock, as in v1. Expected: check and build pass with lint at 4 warnings. The tour's only problem is the known unmocked buckets path.

- [ ] **Step 4: Commit fixes, if any**

```bash
git add -A src
git commit -m "fix(new-app): polish from the stations browser pass" -m "<one line per fix>"
```
