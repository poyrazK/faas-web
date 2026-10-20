# New app wizard as a bento: design

**Status:** approved in conversation on 2026-10-20; awaiting review of this written spec.
**Branch:** `feat/new-app-bento`, off `main` at 7376e5f. Worktree `.worktrees/faas-web-new-app-bento`.

## Why

The New app wizard (`/dashboard/apps/new`, and `/onboarding` for a first app) is a list of six identical rows, each an icon and a sentence, followed by a form. It works, and it reads like a settings page. Creating an app is the console's front door, and the page should show what each path is rather than describe it.

Two references set the direction (unrelated products; the idea, not the look):

- A portfolio with a sticky left column holding the heading and context, and a grid of rich, rounded cells scrolling on the right. The preview is the content.
- A "how it works" row: cells on a hairline grid with corner marks, each with a small UI preview that animates through states, then an index, a title and a description. Lots of air.

## Scope

- **In:** the whole wizard, all three steps (Source, Configure, Review) and the onboarding variant.
- **Out, unchanged:** the completion screen after Create, the first-deployment recovery screen (#171), Import's own step (`ProjectImport`), and the template catalog's cards. The completion screen gets its own pass once this lands.

## Design

### Page frame

- Above 1024px: `grid grid-cols-[17.5rem_1fr] gap-8`, within the template catalog's width (`max-w-5xl`). The console shell caps content at 1100px.
- Below 1024px: one column; the rail sits above the content and is not sticky.
- The step content keeps today's enter and exit motion (`AnimatePresence`, 250ms, none under reduced motion).

### The rail (`new-app-rail.tsx`)

Sticky under the top bar (`sticky top-<topbar>`), left column.

1. "← All apps" link. Hidden in onboarding.
2. Title (`h1`): "New app", or "Deploy your first app" in onboarding. One line of description under it, today's copy.
3. The steps, vertical: `01 Source`, `02 Configure`, `03 Review`. States: done (mint check), current (mint index, foreground text), upcoming (muted). Same `<ol aria-label="App creation steps">` and `aria-current="step"` as today. Not shown for Import, as today.
4. The summary: a `<dl>` of rows from `summaryRows()` (below), under a small "What you'll get" eyebrow. Rows appear only once known.

### `summaryRows(state)` (`new-app-summary.ts`)

A pure function. Input: the wizard's current values (source, repo, ref, template name, name, type, runtime, visibility, memory, scale-to-zero, predicted URL, workspace). Output: `{ key, label, value, mono?: boolean }[]`, in this order:

| Row           | Shown when                             | Value                                                                                                |
| ------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Source        | always                                 | the source's name                                                                                    |
| Repository    | source is `git` and repo set           | `repo@ref`                                                                                           |
| Template      | source is `template` and one is picked | template name                                                                                        |
| Name          | name non-empty                         | name, mono                                                                                           |
| Workspace     | an org workspace is selected           | its label                                                                                            |
| Type          | step ≥ configure                       | Function / App                                                                                       |
| Runtime       | type is function, step ≥ configure     | runtime label                                                                                        |
| Memory        | step ≥ configure                       | `128 MB`                                                                                             |
| Scale to zero | step ≥ configure                       | "Parks when idle" / "One instance kept resident"                                                     |
| Visibility    | step ≥ configure                       | "Public edge" / "Internal service only"                                                              |
| First deploy  | step ≥ review                          | `repo@ref, right after create` or "Later, from the CLI"                                              |
| Public URL    | step ≥ review                          | predicted URL, mono; "Assigned on create" when unknown; "None (internal service only)" when internal |

Nothing is guessed: no row shows a default the person has not reached yet. Both the rail and the Review step render this list, so they cannot drift.

### The bento (`new-app-bento.tsx`, `new-app-bento.css`)

A hairline grid, 3 columns.

- **Lines:** the grid container's background is `var(--border)`, cells have `gap: 1px` and `background: var(--card)`, so there is one line between cells and none doubled. The outer edge has the same 1px line.
- **Corner marks:** 5px squares of `var(--border-secondary)` at every intersection, drawn by the grid container's and cells' pseudo-elements. The selected cell's four marks turn `var(--brand)`.
- **Placement at ≥1024px:**

| Cell                 | Column | Row |
| -------------------- | ------ | --- |
| 01 Git repository    | 1–2    | 1–2 |
| 02 Template          | 3      | 1   |
| 03 Empty app         | 3      | 2   |
| 04 Container image   | 1      | 3   |
| 05 Long-lived worker | 2–3    | 3   |
| 06 Import            | 1–3    | 4   |

- At 640–1024px: 2 columns; Git spans both in row 1, the rest flow one per cell, Import spanning both. Below 640px: one column.
- **A cell** is a `<button type="button" aria-pressed>` named by its title (`aria-labelledby`) and described by its line (`aria-describedby`), exactly as today. Inside, top to bottom: the preview inset (rounded `var(--console-surface-radius)`, `bg-muted`-ish via `color-mix` of `--foreground` into `--card`, fixed aspect, `aria-hidden`), then the eyebrow (its group's name), the index (`01`, mono, muted), the title, the line of copy.
- **Groups:** the three groups (`From code`, `From an image`, `Bring an existing project`) stay as `role="group"` elements labelled by a visually hidden heading, rendered with `display: contents`, so the grid stays flat and the a11y tree keeps the grouping. Each cell's eyebrow repeats its group name.
- **States:** hover warms the border to `--border-secondary` and plays the preview loop; selected shows a 1.5px `--brand` ring inside the cell, mint corner marks, and plays the preview once; keyboard focus shows the same ring (`focus-visible`). The resting cell is quiet: no glow, no lift.
- **Onboarding:** the Git cell alone, spanning the full grid width, same markup.

Git is the hero because it is the one path that deploys from the console, and the one most people arrive with.

### Previews (`new-app-previews.tsx`)

Six small components, inline SVG plus CSS, on tokens only. Each has a resting frame and a loop.

| Cell              | Resting                                                                          | Loop                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git repository    | Repo chip `acme/storefront`, branch chip `main`, a four-segment rail, a URL pill | Segments fill queued → building → deploying → live; the URL pill turns mint                                                                        |
| Template          | A four-line file tree; runtime chips Node, Python, Go                            | Lines type in, top to bottom                                                                                                                       |
| Empty app         | A dashed empty box with a `$` prompt                                             | `gregale deploy` types; the cursor blinks                                                                                                          |
| Container image   | `sha256:7f3a…` and three layer bars                                              | Layers stack from the bottom                                                                                                                       |
| Long-lived worker | A heartbeat line; a globe with a slash (no HTTP)                                 | The line pulses                                                                                                                                    |
| Import            | One manifest card fanning into three service nodes                               | The dashed edges draw, with a dashed-line march defined in `new-app-bento.css` (the canvas branch has a similar keyframe, but it is not on `main`) |

Mechanics: keyframes in `new-app-bento.css` with `animation-play-state: paused` at rest; the cell's `:hover` and `:focus-visible` set `running`; `[aria-pressed="true"]` runs one iteration. `@media (prefers-reduced-motion: reduce)` removes the animations, leaving the resting frame. No timers and no JavaScript per frame.

### Below the grid

Unchanged in behaviour, restyled as one cell-styled panel titled by the chosen source: the repository and ref fields, the GitHub connect notice, the scan hint, and the template catalog when Template is chosen. Continue stays bottom-right.

### Configure

Today's fields and behaviour inside one cell-styled panel: name, type, runtime, visibility, the resource settings disclosure, Back and Review. Nothing functional changes. The rail summary updates as fields change.

### Review

`summaryRows()` rendered as a 2-column grid of cells, with Name and Public URL together as the hero cell (columns 1–2), then the plan or quota note and the Deploy or Create button, with today's blocked reason and disabled rules.

## Constraints

- Tokens only: no literal hex, no `dark:`. Both polarities, since onboarding is light.
- Edits to `new-app-wizard.tsx` are limited to four spots: the frame, the header and step rail (replaced by the rail), the source cards (replaced by the bento), and Review's table (replaced by the summary grid). Seven open PRs touch this file; the new work lives in new files.
- Existing wizard tests stay green unchanged, including card names, `aria-pressed`, "Git first", groups, GitHub return, scan hint and recovery.
- `conventions.test.ts` covers the new files.

## Testing

- **Unit, test-first:**
  - `summaryRows`: order; rows absent until known; "Later, from the CLI" for non-Git; "None (internal service only)"; "Assigned on create".
  - Bento: six cells in order with indexes and eyebrows; Git spans; cells keep `aria-pressed` and names; previews `aria-hidden`; onboarding renders Git alone.
  - Rail: steps carry `aria-current`; the summary shows only known rows.
  - Reduced motion: the preview has no running animation (the CSS rule is pinned by a test on the stylesheet text).
- **Gates:** `npm run check`, `npm run build`.
- **Browser, on the mock:** both themes at 1440 and 1024, and 390px; Source, Configure, Review, onboarding, and Template; hover and selected states; `npm run tour` with no new failures.

## Follow-ups, not in this PR

- The completion screen in the same language.
- Template catalog cards as preview cells.
