# Hosting figures: design

**Status:** approved in conversation on 2026-10-30, section by section, awaiting review of this written spec.
**Branch:** `feat/landing-pillars` (on top of c3690b1, which put the Pillars texture on Scale to zero). One PR for the whole Hosting group.

## Why

"Explore the pieces of your backend" (`src/components/landing/feature-explorer.tsx`) shows one illustration per feature. Scale to zero now has Pillars: a wordless field that reacts to the pointer, where the pointer plays a request and the instances around it wake. The other seven Hosting features still show labelled schematics that animate once and ignore the pointer. Next to Pillars they read as a different family.

This change gives every Hosting feature a bespoke figure made in-house. Each figure acts out its own feature's mechanism, so all eight Hosting features read as one family.

## Decisions

1. **Wordless fields.** No text inside any figure. The caption under the figure carries the meaning.
2. **Smooth motion, like Pillars.** Eased, spring-settled motion. Nothing snaps between discrete states.
3. **React springs through motion values.** Built with `motion/react` (13.1), where the pointer drives `MotionValue`s and every animated attribute is derived with `useTransform` on `motion.*` SVG elements. A pointer move updates the DOM without a React render.
4. **Same look as Pillars.** Brand mint ink (`var(--brand)`) on the panel background (`var(--background)`), hairline strokes, flat SVG, 200px tall. No glow, no dither, no new colour tokens, no new dependencies.
5. **Honest.** Figures are illustrative. None shows numbers, timings or names that could pass for live data.
6. **Unchanged:** Scale to zero keeps Pillars. Connected work keeps its current diagrams (`flow`, `orbit`). The vendored `textures/pillars.tsx` is not edited.

## 1. The shared frame: `src/components/landing/figures/figure-frame.tsx`

```ts
export const VIEW_W = 420;
export const VIEW_H = 200;

export type FigureState = {
  px: MotionValue<number>; // pointer x in figure coordinates, spring-smoothed, 0..420
  py: MotionValue<number>; // pointer y in figure coordinates, spring-smoothed, 0..200
  active: MotionValue<number>; // 0 at rest, 1 while acted on, spring-settled
  reduced: boolean;
};

export function FigureFrame(props: { name: string; children: ReactNode }): JSX.Element;
export function useFigure(): FigureState;
```

- **Markup.** `FigureFrame` renders a `div` with `data-figure={name}`, `position: relative`, `width: 100%`, `height: 200px`. Inside is an `svg` with `viewBox="0 0 420 200"`, `preserveAspectRatio="xMidYMid meet"`, `aria-hidden="true"`, `focusable="false"`, `fill="none"`, `stroke="var(--brand)"`, `stroke-width="1"`. Children are SVG elements, and they read state through `useFigure()` (a React context).
- **Coordinates.** For a frame of width `w` and height `h`, the scale is `s = min(w / 420, h / 200)`, with offsets `ox = (w - 420s) / 2` and `oy = (h - 200s) / 2`. The raw pointer is `x = (clientX - left - ox) / s` and `y = (clientY - top - oy) / s`, clamped to `0..420` and `0..200`. The bounding rect is re-measured on `pointerenter` and at most every 250 ms during moves, as Pillars does.
- **Springs.** Raw `x`, `y` and the `target` (0 or 1) are `useMotionValue`s. `px` and `py` are `useSpring(raw, { stiffness: 300, damping: 30 })`. `active` is `useSpring(target, { stiffness: 400, damping: 40 })`.
- **Rest values.** Before any pointer, raw `x = 210`, `y = 100`, `target = 0`.
- **Pointer.**
  - `pointermove` sets `x`, `y` and `target = 1`. `pointerleave` and `pointercancel` set `target = 0`.
  - On a coarse-pointer device, events with `pointerType === 'touch'` are ignored; the drift handles touch.
- **Focus.** `focusin` on the closest `[tabindex]` ancestor (the feature detail panel) sets `x = 210`, `y = 100`, `target = 1`. `focusout` sets `target = 0`.
- **Touch drift.** When `matchMedia('(hover: none), (pointer: coarse)')` matches and the frame is in view (`useInView(ref, { amount: 0.2 })`), a `useAnimationFrame` loop sets `target = 1` and moves `x`, `y` along Pillars' path:
  - The constants are `w = 2π / 4.5`, a clock advanced at `1.5 × dt`, and a random phase `φ` per mount.
  - `x = 210 + 210 · (0.76 sin(w·t + φ) + 0.2 sin(1.93·w·t + 1.2 + φ))`
  - `y = 100 + 100 · (0.72 sin(0.75·w·t + 0.8 + φ) + 0.2 sin(1.37·w·t + 2.1 + φ))`
  - The loop stops, setting `target = 0`, when the frame leaves view.
- **Reduced motion.** When `useReducedMotion()` is true, the frame attaches no listeners and runs no drift, so `active` stays 0 and every figure shows its resting frame. `reduced` is exposed for figures that need it.
- **Element budget.** A figure animates at most 60 SVG elements.

Every figure is written so that **`active = 0` is its resting frame**: pointer-driven state is always multiplied by `active`, so leaving the figure settles it back to rest.

Helpers used by the figures below: `clamp01(v) = min(1, max(0, v))` and `lerp(a, b, t) = a + (b - a) t`.

## 2. The figures

All coordinates are in the 420×200 frame. "Ink" means the frame's `var(--brand)` stroke or fill. Each figure is one file in `src/components/landing/figures/`, exports one component, and renders inside `FigureFrame` with the name given.

### Source deploys: `source-deploys.tsx`, `data-figure="source-deploys"`

Loose pieces become one image, then a snapshot, then live.

- **Progress.** `p = active · clamp01((px − 40) / 300)`.
- **Bars.** 12 rects, each 64 × 5, `rx = 2`, ink stroke, ink fill with `fill-opacity = 0.25 + 0.75p`.
  - Bar `i` moves from its rest position to `(230, 46 + 9i)` by `lerp(rest, stack, p)`.
  - The rest positions are, in order: (28,34) (96,52) (52,74) (118,88) (34,104) (84,118) (130,40) (60,134) (104,150) (24,160) (142,124) (72,96).
- **Snapshot frame.** A rect at x 218, y 34, 88 × 128, `rx = 6`, `pathLength = 1`, `stroke-dasharray = 1`, `stroke-dashoffset = 1 − clamp01((p − 0.66) / 0.34)`.
- **Live dot.** A circle at (336, 98), r 6, ink fill, scaled by `clamp01((p − 0.85) / 0.15)` with its centre as the transform origin.
- **Total:** 14 elements.
- **Rest:** 12 scattered faint bars and no frame.

### Isolated compute: `isolated-compute.tsx`, `data-figure="isolated-compute"`

One cell reacts, and its neighbours stay perfectly still.

- **Grid.** 6 columns × 3 rows of cells, 56 × 48, `rx = 8`, gap 10, origin (17, 18).
- **Cells.** Cell `(c, r)` sits at `x = 17 + 66c`, `y = 18 + 58r`. Each holds a 12 × 12 inner square, `rx = 2`, ink fill, centred.
- **Hit test.** The hovered cell is the one whose rect contains `(px, py)`. With none, nothing is hovered. Each cell computes its weight `k = active · (hovered ? 1 : 0)`.
- **Hovered cell.** The inner square's size goes from 12 to 30 by `lerp(12, 30, k)`, staying centred. The cell's `stroke-width` goes from 1 to 2.5 by `lerp(1, 2.5, k)`.
- **Other cells.** Unchanged. The stillness is the point.
- **Total:** 36 elements.
- **Rest:** an even grid.

### Custom domains: `custom-domains.tsx`, `data-figure="custom-domains"`

A path completes and locks.

- **Hostname.** 4 dashes on y 100: x 24–32, 38–46, 52–60, 66–74, `stroke-width = 2`.
- **Guide.** A line from (84, 100) to (344, 100), `stroke-dasharray = "2 6"`, `stroke-opacity = 0.5`.
- **Fill.** The same line, solid, `pathLength = 1`, `stroke-dasharray = 1`, `stroke-dashoffset = 1 − f`, where `f = active · clamp01((px − 84) / 260)`.
- **Rings.** Three circles at (150, 100), (214, 100) and (278, 100), filled with the background colour. Their base radius is 14, and each grows to `14 + 6 · active · max(0, 1 − |px − cx| / 48)`.
- **App node.** A rect at x 344, y 82, 52 × 36, `rx = 6`, ink fill.
- **Padlock.** The body is a rect at x 360, y 62, 20 × 14, `rx = 2`, ink fill. The shackle path is `M 364 62 V 56 A 6 6 0 0 1 376 56 V 62`, `stroke-width = 2`, translated in y by `−6 · (1 − clamp01((f − 0.9) / 0.1))`. It is lifted, meaning open, until the fill reaches the app.
- **Total:** 12 elements.
- **Rest:** a dotted path, plain rings, and an open lock.

### Logs & traces: `logs-traces.tsx`, `data-figure="logs-traces"`

A cursor reads one request.

- **Spans.** 7 rects, 14 high, `rx = 3`, ink stroke, at (x, y, width): (24, 24, 300) (48, 46, 180) (72, 68, 96) (132, 90, 120) (160, 112, 60) (232, 134, 84) (256, 156, 40).
- **Cursor.** A line at `x = clamp(px, 24, 324)` from y 16 to y 184, `stroke-opacity = active`.
- **Crossing.** Span `i` is crossed when `x_i ≤ cursor ≤ x_i + width_i`. Its `fill-opacity` is `0.12 + 0.88 · active · crossed`.
- **Ticks.** 7 lines at x 352 → 392, at `y = 31 + 22i`, one per span, `stroke-width = 2`. Tick `i` has `stroke-opacity = active · crossed_i`, and is drawn from its left end with `pathLength = 1` and `stroke-dashoffset = 1 − active · crossed_i`.
- **Total:** 15 elements.
- **Rest:** a faint waterfall, with no cursor and no ticks.

### Secrets & config: `secrets-config.tsx`, `data-figure="secrets-config"`

Values stay sealed. Nothing reveals.

- **Rows.** 6 rows, with centres at `yc = 30 + 28r`.
- **Each row has three parts.**
  - A key bar: a rect at x 40, `y = yc − 4`, 60 × 8, `rx = 2`, ink fill, `fill-opacity = 0.6`.
  - 8 dots: circles r 4 at `x = 132 + 26d`, ink fill.
  - A sealed block: a rect at x 191, `y = yc − 7`, 64 × 14, `rx = 4`, ink fill.
- **Hit.** The row's weight is `m = active · max(0, 1 − |py − yc| / 14)`.
- **Movement.** Dot `d` moves to `x = lerp(132 + 26d, 223, m)`, with `fill-opacity = 1 − 0.9m`. The sealed block has `fill-opacity = m`.
- **Total:** 60 elements.
- **Rest:** six rows of key bars and dots.

### PR previews: `pr-previews.tsx`, `data-figure="pr-previews"`

A branch forks and merges.

- **Main line.** From (24, 140) to (396, 140).
- **Commits.** 9 circles r 4 at `x = 44 + 42k`, y 140, ink fill.
- **Branch.** It starts at the commit nearest `px`, `cx = 44 + 42 · round(clamp((px − 44) / 42, 0, 8))`, and its height is `h = 70 · active`. It forks right, to `nx = cx + 40`, unless that would push the node past the frame (`cx > 300`), in which case it forks left, to `nx = cx − 40`.
  - Path: `M cx 140 C cx (140 − 0.6h) nx (140 − h) nx (140 − h)`.
- **Preview node.** A rect 44 × 30, `rx = 5`, centred on x `nx`, with its bottom at `140 − h`, and `stroke-opacity = active`. Inside, a circle r 3 at its centre, ink fill, `fill-opacity = active`.
- **Total:** 13 elements.
- **Rest:** a straight line of commits. As `active` settles, the branch lowers into the line, which is the merge.

### Object storage: `object-storage.tsx`, `data-figure="object-storage"`

Objects leave the runtime for a closed bucket.

- **App frame.** A rect at x 24, y 56, 96 × 88, `rx = 8`.
- **Bucket.** The path `M 280 40 V 168 Q 280 176 288 176 H 384 Q 392 176 392 168 V 40`, open at the top, closed by a lid: a rect at x 272, y 32, 128 × 6, `rx = 2`, ink fill. The lid never opens.
- **Objects.** 24 squares, 10 × 10, `rx = 2`, ink fill.
  - Square `i` rests at `(36 + 13 · (i mod 6), 68 + 16 · ⌊i / 6⌋)`, inside the app frame.
  - Its slot in the bucket is `(290 + 12 · (i mod 8), 160 − 12 · ⌊i / 8⌋)`, filling bottom-up.
  - With `f = active · clamp01((px − 24) / 360)`, square `i` travels by `q_i = clamp01(24f − i)` to `lerp(rest_i, slot_i, q_i)`.
- **Total:** 27 elements.
- **Rest:** a filled app frame and an empty, closed bucket.

## 3. Fitting them in

- **The diagram picker.** `FeatureDiagram` in `feature-explorer.tsx` maps the Hosting diagram kinds to the figures. The `Diagram` type becomes:

  ```ts
  'deploy' |
    'compute' |
    'pillars' |
    'domain' |
    'trace' |
    'secrets' |
    'previews' |
    'objects' |
    'flow' |
    'orbit';
  ```

  - `deploy` → `SourceDeploysFigure`
  - `compute` → `IsolatedComputeFigure`
  - `domain` → `CustomDomainsFigure`
  - `trace` → `LogsTracesFigure`
  - `secrets` → `SecretsConfigFigure`
  - `previews` → `PrPreviewsFigure`
  - `objects` → `ObjectStorageFigure`
  - `pillars` → Pillars, unchanged.
  - `flow` and `orbit` stay, unchanged.

- **Removed.** `src/components/landing/hosting-diagrams.tsx`; `DeploymentDiagram` from `feature-explorer.tsx`; every `.hosting-*` and `.deployment-*` rule and their keyframes in `feature-explorer.css`. The `.feature-diagram` and `.feature-node` rules stay for Connected work.
- **Captions.**

  | Feature          | Caption                                                       |
  | ---------------- | ------------------------------------------------------------- |
  | Source deploys   | An illustrated path from commit to running app. _(kept)_      |
  | Isolated compute | Your app. Its own runtime boundary. _(kept)_                  |
  | Scale to zero    | Instances wake where requests land, then park again. _(kept)_ |
  | Custom domains   | Your domain, routed to your app over TLS.                     |
  | Logs & traces    | Illustrative spans, not measured request timings. _(kept)_    |
  | Secrets & config | Values sealed, never shown back.                              |
  | PR previews      | A separate preview, before the merge. _(kept)_                |
  | Object storage   | Private buckets, outside your app's runtime.                  |

  "Values sealed, never shown back" is accurate: the API never returns a secret's value.

## Testing

All tests are written first and watched failing.

- **`figure-frame.test.tsx`:**
  - A `pointermove` maps client coordinates to figure coordinates under `meet` scaling, including the letterbox offset, and clamps outside values.
  - `target` becomes 1 on move and 0 on leave. Assert on the raw motion values a test consumer reads through `useFigure()`, not on spring frames.
  - `focusin` on the `[tabindex]` ancestor centres the pointer.
  - Under reduced motion, no listener reacts and `target` stays 0.
  - On a coarse pointer, touch-type events are ignored, and the drift runs only while in view (`IntersectionObserver` mocked).
- **No re-renders.** A `React.Profiler` around a figure records its commits. Firing 50 `pointermove` events must add **zero** commits after mount.
- **Each figure** (one test file per figure, or a shared table test):
  - It renders inside a `[data-figure="<name>"]` frame with an `aria-hidden` SVG.
  - It has no `text` elements.
  - Its animated element count is at most 60.
  - Its resting frame is right:
    - Source deploys: bar 0 at (28, 34).
    - Isolated compute: every inner square 12 wide.
    - Custom domains: fill dashoffset 1, shackle lifted.
    - Logs & traces: no ticks visible.
    - Secrets & config: no sealed block visible.
    - PR previews: branch height 0.
    - Object storage: every square at its rest position.
- **`feature-explorer.test.tsx`:**
  - Every Hosting feature shows its `data-figure` and its caption.
  - Scale to zero still shows Pillars.
  - Connected work still shows its `flow` and `orbit` diagrams.
  - The existing assertion that Isolated compute shows `svg.hosting-diagram` becomes `[data-figure="isolated-compute"]`.
- **Gate:**
  - `tsc` exits 0.
  - Lint has 0 errors and no more than the existing 4 warnings.
  - Prettier is clean.
  - `npx vitest run --maxWorkers=8` exits 0 with no "Errors" line.
  - `npm run build` succeeds.
- **Browser performance check.** Use Playwright with CDP CPU throttling at 4× against `npm run dev`:
  - Select each Hosting feature in turn and sweep the pointer across its figure for 2 seconds.
  - Record `PerformanceObserver('longtask')` entries.
  - The target is zero long tasks over 50 ms. Any that appear are reported with the figure that caused them.
- **Visual check.** Take screenshots of each figure at rest and mid-sweep at 1366×900 and 390×844, and compare them against this spec's descriptions.

## Not in this change

- Connected work figures (Service connections, Background jobs, Workflows, Release coordination).
- Any change to Pillars or its vendored file.
- New colour tokens, new dependencies, sound, or haptics.
- Figures elsewhere on the site or in the console.
