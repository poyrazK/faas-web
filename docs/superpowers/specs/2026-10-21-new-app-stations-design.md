# New app wizard v2: stations, two layouts, shader scenes

**Status:** approved in conversation on 2026-10-21; awaiting review of this written spec.
**Branch:** `feat/new-app-bento`, building on v1 (`docs/superpowers/specs/2026-10-20-new-app-bento-design.md`, head 63a0910).

## Why

v1 put the rail and the bento in place, but Bahadir's walkthrough (2026-10-21) showed two problems:

1. **Choosing a source sends you down the page.**
   - Template's catalog, Git's repository fields and Import all appear below the six-cell grid, so the person scrolls to act. The final review measured the common Git path's Repository field 1.5 to 2.5 screens down.
   - Container and Worker throw the person onto a separate screen in the old style.
2. **The illustrations are plain.** They are flat diagrams; he wants generative, "startup vibey" scenes made with custom shaders.

The v1 final review adds three measured layout defects, folded in below:

- the template catalog scrolls sideways when squeezed beside the rail;
- the bento's breakpoints ignore the 240px console sidebar, so cells clip between 1024 and 1280px;
- the rail is unlabelled and can be taller than the screen.

## Design

### 1. Stations

The wizard is four stations, in order: **Sources → Setup → Configure → Review**.

| Source            | Setup station                                                       | Then                  |
| ----------------- | ------------------------------------------------------------------- | --------------------- |
| Git repository    | Repository picker and ref, the scan hint, the GitHub connect notice | Configure → Review    |
| Template          | The template catalog, full width                                    | Configure → Review    |
| Empty app         | none (it needs no setup)                                            | Configure → Review    |
| Container image   | The image form (`ImageDeployForm kind="http"`)                      | the form's own submit |
| Long-lived worker | The image form (`ImageDeployForm kind="worker"`)                    | the form's own submit |
| Import            | The project import (`ProjectImport`)                                | its own apply         |

**Which station is current** is a pure function, `stationFor()`, of the URL search and the inferred source. `NewAppSearch.step` gains `'source'` and `'setup'`, and `validateNewAppSearch` accepts both.

| `step` in the URL                                                               | Station                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------- |
| `review`, with the source and name valid                                        | Review                                            |
| `review` or `configure`, with the source valid                                  | Configure                                         |
| `review` or `configure`, source not valid yet                                   | that source's Setup, or Sources if it has none    |
| `setup`                                                                         | that source's Setup. Empty has none, so Configure |
| `source`                                                                        | Sources (the source stays selected)               |
| none, source **named in the URL** (`?source=` or `?template=`) that has a Setup | that Setup                                        |
| none, otherwise (no source, Empty, or a source only _inferred_)                 | Sources                                           |

- **Named sources land on Setup.** This covers the GitHub round-trip (`?source=git`) and template-gallery links (`?template=hello-node`).
- **Inferred sources stay on Sources.** When Git is preselected because GitHub is connected, the person still sees the choices with Git highlighted, and Continue moves on. A bookmarked `?source=empty` also stays on Sources, with Empty selected.
- **Picking a cell moves forward.** It sets `{ source, step: 'setup' }`, or `{ source: 'empty', step: 'configure' }` for Empty. Continue on Sources does the same for the selected source.
- **Back from Setup** sets `step: 'source'`, so it does not bounce back into Setup. Back from Configure clears `step`, which lands on the Setup (named source) or on Sources.
- **Validation is per station.** Sources checks only that a source is chosen. Setup checks the source's own fields (Git's repository and ref, the GitHub connection, a picked template), as today's source step does.

**The rail.** It shows three numbered steps: 01 Source, 02 Configure, 03 Review.

- While on Setup, step 01 shows the chosen source's name under it ("01 Source · Template").
- For Container, Worker and Import, whose own forms finish the flow, the rail shows only 01.
- The rail gets `aria-label="New app progress"`. It scrolls itself (`max-height: calc(100vh - 6rem); overflow-y: auto`) when taller than the screen.
- The `h1` moves out of the rail's landmark, into the page's header row.

### 2. Two layouts, chosen with a dev-only switch

Both layouts render the same stations; only placement and motion differ.

**Track**

- Only the current station is rendered.
- On its left sits a 3.5rem sliver for the previous station: a labelled button ("← Sources", "← Setup", "← Configure", with `aria-label="Back to <station>"`). It renders the station's name only, not the station's content, so the page never holds two sets of fields.
- Moving forward slides the current station out to the left and the next one in from the right (`motion`, 420ms on `--motion-ease`). Back does the reverse.
- Each station scrolls vertically within the page; nothing scrolls sideways.
- With reduced motion, stations swap without sliding.

**Fold**

- Leaving Sources animates the bento into a vertical strip of the six sources down the left of the content (`motion` layout animation, 420ms). Each cell becomes a 3rem row: a static colour swatch, the name, and the selected state.
- The strip stays switchable: picking another source goes to its Setup.
- The station content sits beside the strip, and the strip persists through Configure and Review.
- With reduced motion, the fold happens without animation.

**The switch**

- A small fixed pill, bottom-left, reads "Layout: Track · Fold".
- It renders only when `import.meta.env.DEV` is true, so production builds drop it.
- The choice is stored in local storage under `gregale.dev.newAppLayout`, read inside try/catch.
- Production uses Track until Bahadir chooses; the chosen layout then becomes the only one, and the other is deleted in a follow-up.

**On small screens** (the content column under 40rem): Fold's strip collapses to a horizontal row of swatches above the station, and Track keeps its sliver.

### 3. Shader scenes

Six fragment shaders, one per source, replace v1's diagram previews:

| Source            | Scene                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Git repository    | Thin streams drift in from the edges and converge into one bright beam. |
| Template          | Square blocks fall and settle into a grid, row by row.                  |
| Empty app         | A soft field of grain that breathes, brightening and dimming slowly.    |
| Container image   | Translucent rectangular planes stack upward with depth.                 |
| Long-lived worker | A pulse travels a line and never stops; a faint trail follows it.       |
| Import            | One stream enters from the top and splits into three.                   |

**Language**

- They are built on the landing's `useShaderCanvas` and `GLSL_PRELUDE`.
- Colour is quantised with the ordered Bayer dither, so each scene steps rather than blends, like the hero, pricing and how-it-works shaders.
- Colours come from tokens, not literals: at mount, the component reads `--brand`, `--card` and `--foreground` from computed style and passes them as `u_brand`, `u_bg` and `u_fg`. It re-reads them when the `html` element's class changes (polarity), using a `MutationObserver`. Light and dark both work.

**Motion**

The scene holds a still frame until its cell is hovered, focused or selected, then animates. This matches v1's "alive on hover".

- `useShaderCanvas` gains an optional `active?: boolean`, defaulting to `true`, so every existing caller is unchanged.
- When `active` is false, the hook draws one frame and stops its loop.
- Reduced motion always shows the single still frame (existing behaviour).

**Budget**

- Only the bento's six cells mount WebGL canvases, so a page holds at most six contexts.
- Fold's strip uses static swatches (CSS gradients from the same tokens), never WebGL.
- `renderScale` is 0.5.
- The hook already pauses offscreen and when the tab is hidden.

**Fallback.** If WebGL or compilation fails, the cell shows a CSS gradient in the same tokens. This is the existing `supported` flag.

**Accessibility.** Each canvas is `aria-hidden`; the cell's name and description carry the meaning, as in v1.

### 4. Folded-in review fixes

- **Container queries.** The bento wrapper gets `container-type: inline-size`. It shows 3 columns at `@container (min-width: 46rem)` and 2 at `(min-width: 30rem)`, replacing viewport breakpoints. The eyebrow row gets a gap.
- **Catalog width.** The template catalog lives in its own full-width Setup station, so it never shares a row with the rail.
- **Review heading.** Review gets its heading back: an `h2` reading "Review".
- **Onboarding** shows the Git cell without "01" or the eyebrow.

## Constraints

- The constraints from the v1 spec hold:
  - tokens only, no `dark:`;
  - both polarities;
  - cells keep `name="source-<id>"`, `form`, `aria-pressed`, and their names and descriptions;
  - the three labelled groups stay;
  - lint stays at 4 warnings;
  - do not reformat untouched files.
- The existing tests in `new-app-wizard.test.tsx` and `src/routes/-dashboard.new-app.test.tsx` stay green, with one exception. A test whose assertion depends on the setup fields appearing _below_ the grid on the same screen may change to reach them on the Setup station. Each such change is recorded as a ruling, with the old and new assertion.
- GitHub return paths keep working: `returnTo` stays `/dashboard/apps/new?source=git`, which now lands on Git's Setup.
- First-deployment recovery (#171) is untouched.

## Testing

**Unit, test-first:**

- `stationFor()`:
  - every row of the station rules;
  - `?template=` lands on Setup;
  - an inferred Git stays on Sources;
  - Empty skips Setup;
  - an invalid `step: 'review'` falls back to Configure.
- `validateNewAppSearch` accepts `setup`.
- Track:
  - only the current station's content is in the document;
  - the sliver is labelled and goes back;
  - reduced motion sets no transition.
- Fold: the strip lists six sources with the selection pressed, and picking one goes to its Setup.
- Dev switch:
  - absent when `import.meta.env.DEV` is false (stubbed with `vi.stubEnv`);
  - present and persisted when true.
- Shaders:
  - each scene renders a canvas, `aria-hidden`;
  - with no WebGL (jsdom), it renders the fallback;
  - `active` false draws one frame. This is tested on the hook with a stubbed context.
- Container queries: the stylesheet declares `container-type` and no `min-width` media queries for the grid.

**Browser, on the mock:**

- Both layouts.
- Widths: 1024 with the sidebar expanded, 1280, 1440 and 390.
- Both polarities, using onboarding for light.
- Checks:
  - no sideways scroll;
  - picking each source lands on its Setup with no vertical hunt (the Setup's first control within the first viewport);
  - the number of WebGL contexts on the page is 6 or fewer;
  - hover animates a scene;
  - reduced motion shows still frames;
  - the GitHub return lands on Git's Setup.
- `npm run check`, `npm run build`, and the tour with no new failures.

## Out of scope

- The completion screen after Create, and the recovery screen.
- The template catalog's cards themselves (they move to a full-width station; their design is unchanged).
- Choosing between Track and Fold. Bahadir chooses in the browser; deleting the other layout is a follow-up.
