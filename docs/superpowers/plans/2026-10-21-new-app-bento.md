# New app bento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the New app wizard (`/dashboard/apps/new` and `/onboarding`) as a sticky left rail plus a bento grid of source cells with hover-animated previews, and carry the same language through Configure and Review.

**Architecture:** Four new, self-contained units:

- `summaryRows()`, a pure function feeding both the rail and Review;
- the source previews and their CSS;
- the bento grid;
- the rail.

The 1,362-line `new-app-wizard.tsx` changes in a few surgical places only: the frame, the header, the source cards, the Configure panel and the Review table. Seven open PRs touch that file, so everything else lives in new files. No new state: the wizard's existing values flow in as props.

**Tech Stack:** React 19, TanStack Router (`Link`), Tailwind 4 with the console's tokens in `src/index.css`, plain CSS keyframes in a component stylesheet, Vitest with React Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-20-new-app-bento-design.md`

## Global Constraints

- Tokens only: no literal hex anywhere in the new `.tsx` or `.css`, and no `dark:` variants. Colours come from `var(--card)`, `var(--border)`, `var(--border-secondary)`, `var(--brand)`, `var(--foreground)`, `var(--muted-foreground)` and `color-mix()` over them.
- Both polarities must work: the console route is dark (`html.console`), and `/onboarding` is light.
- Motion: previews are still at rest and play only on `:hover`, `:focus-visible`, and once on selection (`[aria-pressed='true']`). Under `@media (prefers-reduced-motion: reduce)`, no animation runs.
- Cells stay `<button type="button">` with:
  - `name="source-<id>"` and `form={formId}`, because the focus-first-error code finds them through `form.elements`;
  - `aria-pressed`;
  - `aria-labelledby` set to the title's id `${uid}-${id}-name`;
  - `aria-describedby` set to `${uid}-${id}-desc`, plus the source error id when shown.
- The three source groups stay `role="group"`, labelled "From code", "From an image" and "Bring an existing project".
- The existing tests in `src/components/dashboard/new-app-wizard.test.tsx` stay green **unchanged**.
- `npm run lint` stays at 4 warnings, 0 errors.
- Do not reformat files you did not otherwise change.

## Review Focus

1. **Text appearing twice.** The rail's summary repeats values (memory, scale to zero, name, URL) that Review also shows, and existing tests look these up by exact text. The rail must hide its summary on Review. Pinned in Task 4's rail test and by the unchanged wizard tests in Task 5.
2. **Narrow screens.** At 390px the bento must be one column, the rail must not be sticky, and nothing may scroll sideways. Pinned in Task 6's browser check, which asserts `document.documentElement.scrollWidth <= innerWidth`.
3. **Keyboard users.** Tab must reach every cell in source order (Git → Template → Empty → Container → Worker → Import) despite the grid placement, and focus must show the same ring as selection. Pinned in Task 3: the test checks DOM order, and the CSS gives `:focus-visible` the ring.
4. **No source chosen yet** (GitHub not connected). No cell is pressed, the rail shows no "Source" row, and the summary heading does not appear over an empty list. Pinned in Task 1 (`summaryRows` with no source returns `[]`) and Task 4 (an empty `rows` hides the summary).
5. **Long values.** A 40-character app name, a long `owner/repo@ref` or a long URL must wrap inside the rail and Review cells, not overflow. Pinned in Task 4 and Task 5 by a `break-words` class on every `dd`, which the tests assert.

---

### Task 1: `summaryRows()` and the shared source list

**Files:**

- Create: `src/components/dashboard/new-app-sources.ts`
- Create: `src/components/dashboard/new-app-summary.ts`
- Test: `src/components/dashboard/new-app-summary.test.ts`

**Interfaces:**

- Produces (`new-app-sources.ts`):
  - `interface SourceOption { id: AppSource; name: string; desc: string }`
  - `const SOURCES: readonly SourceOption[]`, the six entries with today's exact copy, in today's order.
  - `const SOURCE_GROUPS: readonly { title: string; sources: readonly AppSource[] }[]`
  - `function sourceName(id?: AppSource): string`
- Produces (`new-app-summary.ts`):
  - `interface SummaryRow { key: string; label: string; value: string; mono?: boolean }`
  - `interface SummaryInput { step: 0 | 1 | 2; source?: AppSource; repo: string; ref: string; templateName?: string; name: string; workspaceLabel: string; workspaceIsOrg: boolean; appType: 'function' | 'app'; runtimeLabel?: string; memoryMb: number; scaleToZero: boolean; visibility: 'public' | 'internal'; predictedUrl?: string }`
  - `function summaryRows(input: SummaryInput): SummaryRow[]`

Deviation from the spec table, on purpose: today's Review always lists the workspace (including "Personal"), so `workspace` shows from step 2 always, and earlier only for an org.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/dashboard/new-app-summary.test.ts
import { describe, expect, it } from 'vitest';
import { summaryRows, type SummaryInput } from './new-app-summary';
import { SOURCES, SOURCE_GROUPS, sourceName } from './new-app-sources';

const base: SummaryInput = {
  step: 0,
  source: 'git',
  repo: '',
  ref: 'main',
  name: '',
  workspaceLabel: 'Personal',
  workspaceIsOrg: false,
  appType: 'function',
  runtimeLabel: 'Node 22',
  memoryMb: 128,
  scaleToZero: true,
  visibility: 'public',
};
const keys = (input: Partial<SummaryInput>) => summaryRows({ ...base, ...input }).map((r) => r.key);
const value = (input: Partial<SummaryInput>, key: string) =>
  summaryRows({ ...base, ...input }).find((r) => r.key === key)?.value;

describe('summaryRows', () => {
  it('shows nothing before a source is chosen', () => {
    expect(summaryRows({ ...base, source: undefined })).toEqual([]);
  });

  it('adds only what is known on the source step', () => {
    expect(keys({})).toEqual(['source']);
    expect(keys({ repo: 'acme/storefront' })).toEqual(['source', 'repository']);
    expect(value({ repo: ' acme/storefront ', ref: ' ' }, 'repository')).toBe(
      'acme/storefront@main'
    );
    expect(keys({ repo: 'acme/storefront', name: 'storefront' })).toEqual([
      'source',
      'repository',
      'name',
    ]);
  });

  it('names a picked template, and nothing for a template not picked yet', () => {
    expect(keys({ source: 'template' })).toEqual(['source']);
    expect(value({ source: 'template', templateName: 'hello-node' }, 'template')).toBe(
      'hello-node'
    );
  });

  it('lists an org workspace early and the personal one only on review', () => {
    expect(keys({ workspaceIsOrg: true, workspaceLabel: 'acme' })).toContain('workspace');
    expect(keys({ step: 1 })).not.toContain('workspace');
    expect(value({ step: 2 }, 'workspace')).toBe('Personal');
  });

  it('adds configuration from the configure step, runtime only for functions', () => {
    expect(keys({ step: 1, name: 'api' })).toEqual([
      'source',
      'name',
      'type',
      'runtime',
      'memory',
      'scale',
      'visibility',
    ]);
    expect(keys({ step: 1, appType: 'app' })).not.toContain('runtime');
    expect(value({ step: 1, scaleToZero: false }, 'scale')).toBe('One instance kept resident');
    expect(value({ step: 1, memoryMb: 256 }, 'memory')).toBe('256 MB');
    expect(value({ step: 1, visibility: 'internal' }, 'visibility')).toBe('Internal service only');
  });

  it('says how the first deploy happens and what the URL is, on review', () => {
    expect(value({ step: 2, repo: 'acme/storefront' }, 'first-deploy')).toBe(
      'acme/storefront@main, right after create'
    );
    expect(value({ step: 2, source: 'empty' }, 'first-deploy')).toBe('Later, from the CLI');
    expect(value({ step: 2 }, 'url')).toBe('Assigned on create');
    expect(value({ step: 2, predictedUrl: 'https://api.gregale.app' }, 'url')).toBe(
      'https://api.gregale.app'
    );
    expect(value({ step: 2, visibility: 'internal', predictedUrl: 'x' }, 'url')).toBe(
      'None (internal service only)'
    );
  });
});

describe('the shared source list', () => {
  it('keeps the six sources, grouped with Git first', () => {
    expect(SOURCES.map((s) => s.id)).toEqual([
      'git',
      'template',
      'empty',
      'container',
      'worker',
      'import',
    ]);
    expect(SOURCE_GROUPS.flatMap((g) => g.sources)).toEqual(SOURCES.map((s) => s.id));
    expect(sourceName('git')).toBe('Git repository');
    expect(sourceName(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run src/components/dashboard/new-app-summary.test.ts`
Expected: FAIL with `Failed to resolve import "./new-app-summary"`.

- [ ] **Step 3: Implement**

```ts
// src/components/dashboard/new-app-sources.ts
import type { AppSource } from './new-app-source';

export interface SourceOption {
  id: AppSource;
  name: string;
  desc: string;
}

/** Git deploys immediately; empty/template apps await CLI deployment.
 * Import keeps the existing project scan/apply contract inside this flow. */
export const SOURCES: readonly SourceOption[] = [
  {
    id: 'git',
    name: 'Git repository',
    desc: 'Build and deploy one service from a branch, tag, or commit, right from the console.',
  },
  {
    id: 'template',
    name: 'Template',
    desc: 'Start with sample code. Create the app here, then deploy it with the CLI.',
  },
  {
    id: 'empty',
    name: 'Empty app',
    desc: 'Create the app without a deployment. Add code from the CLI or CI later.',
  },
  {
    id: 'container',
    name: 'Container image',
    desc: 'Deploy an immutable HTTP image by digest. No GitHub connection required.',
  },
  {
    id: 'worker',
    name: 'Long-lived worker',
    desc: 'Deploy a pinned OCI worker without an HTTP listener. Hobby or above.',
  },
  {
    id: 'import',
    name: 'Import',
    desc: 'A repository with several services (Compose, Procfile, k8s, Render, Fly, or serverless), scanned and created together as a project.',
  },
];

/** The common path first: most people arrive with code, not an image or a
 * multi-service repository. The order inside a group is the order shown. */
export const SOURCE_GROUPS: readonly { title: string; sources: readonly AppSource[] }[] = [
  { title: 'From code', sources: ['git', 'template', 'empty'] },
  { title: 'From an image', sources: ['container', 'worker'] },
  { title: 'Bring an existing project', sources: ['import'] },
];

export function sourceName(id?: AppSource): string {
  return SOURCES.find((s) => s.id === id)?.name ?? '';
}
```

```ts
// src/components/dashboard/new-app-summary.ts
import type { AppSource } from './new-app-source';
import { sourceName } from './new-app-sources';

export interface SummaryRow {
  key: string;
  label: string;
  value: string;
  /** Identifiers (names, refs, URLs) read better in the mono face. */
  mono?: boolean;
}

export interface SummaryInput {
  /** 0 Source, 1 Configure, 2 Review: rows appear once their step is reached. */
  step: 0 | 1 | 2;
  source?: AppSource;
  repo: string;
  ref: string;
  templateName?: string;
  name: string;
  workspaceLabel: string;
  workspaceIsOrg: boolean;
  appType: 'function' | 'app';
  runtimeLabel?: string;
  memoryMb: number;
  scaleToZero: boolean;
  visibility: 'public' | 'internal';
  predictedUrl?: string;
}

/**
 * What the app will be, as far as the person has told us. One list feeds the
 * rail (as it fills in) and Review (in full), so the two cannot drift. A row
 * appears only once its value is known: nothing here is a guessed default.
 */
export function summaryRows(i: SummaryInput): SummaryRow[] {
  if (!i.source) return [];
  const repoRef = `${i.repo.trim()}@${i.ref.trim() || 'main'}`;
  const rows: SummaryRow[] = [{ key: 'source', label: 'Source', value: sourceName(i.source) }];
  if (i.source === 'git' && i.repo.trim())
    rows.push({ key: 'repository', label: 'Repository', value: repoRef, mono: true });
  if (i.source === 'template' && i.templateName)
    rows.push({ key: 'template', label: 'Template', value: i.templateName, mono: true });
  if (i.name) rows.push({ key: 'name', label: 'Name', value: i.name, mono: true });
  if (i.workspaceIsOrg || i.step >= 2)
    rows.push({ key: 'workspace', label: 'Workspace', value: i.workspaceLabel });
  if (i.step >= 1) {
    rows.push({ key: 'type', label: 'Type', value: i.appType === 'app' ? 'App' : 'Function' });
    if (i.appType === 'function' && i.runtimeLabel)
      rows.push({ key: 'runtime', label: 'Runtime', value: i.runtimeLabel });
    rows.push({ key: 'memory', label: 'Memory', value: `${i.memoryMb} MB`, mono: true });
    rows.push({
      key: 'scale',
      label: 'Scale to zero',
      value: i.scaleToZero ? 'Parks when idle' : 'One instance kept resident',
    });
    rows.push({
      key: 'visibility',
      label: 'Visibility',
      value: i.visibility === 'internal' ? 'Internal service only' : 'Public edge',
    });
  }
  if (i.step >= 2) {
    rows.push(
      i.source === 'git'
        ? {
            key: 'first-deploy',
            label: 'First deploy',
            value: `${repoRef}, right after create`,
            mono: true,
          }
        : { key: 'first-deploy', label: 'First deploy', value: 'Later, from the CLI' }
    );
    rows.push(
      i.visibility === 'internal'
        ? { key: 'url', label: 'Public URL', value: 'None (internal service only)' }
        : i.predictedUrl
          ? { key: 'url', label: 'Public URL', value: i.predictedUrl, mono: true }
          : { key: 'url', label: 'Public URL', value: 'Assigned on create' }
    );
  }
  return rows;
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run src/components/dashboard/new-app-summary.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/dashboard/new-app-sources.ts src/components/dashboard/new-app-summary.ts src/components/dashboard/new-app-summary.test.ts
git add src/components/dashboard/new-app-sources.ts src/components/dashboard/new-app-summary.ts src/components/dashboard/new-app-summary.test.ts
git commit -m "feat(new-app): one summary of the app being created, for the rail and review"
```

---

### Task 2: Source previews and their stylesheet

**Files:**

- Create: `src/components/dashboard/new-app-previews.tsx`
- Create: `src/components/dashboard/new-app-bento.css`
- Test: `src/components/dashboard/new-app-previews.test.tsx`

**Interfaces:**

- Consumes: `AppSource` from `./new-app-source`.
- Produces: `function SourcePreview({ id }: { id: AppSource }): JSX.Element`. It renders `<div aria-hidden="true" class="nab-preview" data-preview={id}>`. The stylesheet exports the classes `nab-*` that Task 3 uses: `nab-grid`, `nab-cell`, `nab-mark`, `nab-preview`.

The mechanic differs slightly from the spec's "paused at rest" wording, with the same outcome. At rest, each scene is styled in its finished frame, with no animation. Hover, focus or selection _applies_ the animation, which replays the scene and ends on that same frame. This avoids a frozen keyframe-0 frame at rest.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/new-app-previews.test.tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourcePreview } from './new-app-previews';
import type { AppSource } from './new-app-source';

const ALL: AppSource[] = ['git', 'template', 'empty', 'container', 'worker', 'import'];
const css = readFileSync(resolve('src/components/dashboard/new-app-bento.css'), 'utf8');

describe('SourcePreview', () => {
  it.each(ALL)('draws a %s scene that assistive technology skips', (id) => {
    const { container } = render(<SourcePreview id={id} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveAttribute('data-preview', id);
    expect(root.childElementCount).toBeGreaterThan(0);
  });

  it('shows a real-looking deploy rail for Git', () => {
    const { container } = render(<SourcePreview id="git" />);
    expect(container.querySelectorAll('.nab-seg')).toHaveLength(4);
    expect(container.textContent).toContain('storefront.gregale.app');
  });
});

describe('new-app-bento.css', () => {
  it('uses tokens only', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\bdark\b/);
  });

  it('plays previews on hover, focus and selection, and never under reduced motion', () => {
    expect(css).toMatch(/\.nab-cell:hover/);
    expect(css).toMatch(/\.nab-cell:focus-visible/);
    expect(css).toMatch(/\.nab-cell\[aria-pressed='true'\]/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run src/components/dashboard/new-app-previews.test.tsx`
Expected: FAIL, because neither the module nor the stylesheet exists (`ENOENT … new-app-bento.css`).

- [ ] **Step 3: Implement the previews**

```tsx
// src/components/dashboard/new-app-previews.tsx
import type { CSSProperties } from 'react';
import type { AppSource } from './new-app-source';
import './new-app-bento.css';

/** `--i` staggers a scene's parts in CSS; React types do not know custom properties. */
const at = (i: number) => ({ '--i': i }) as CSSProperties;

function GitScene() {
  return (
    <div className="nab-scene nab-git">
      <div className="nab-row">
        <span className="nab-chip nab-mono">acme/storefront</span>
        <span className="nab-chip nab-mono nab-dim">main</span>
      </div>
      <div className="nab-rail">
        {['Queued', 'Building', 'Deploying', 'Live'].map((label, i) => (
          <span key={label} className="nab-seg" style={at(i)}>
            <span className="nab-seg-bar" />
            <span className="nab-seg-label">{label}</span>
          </span>
        ))}
      </div>
      <span className="nab-url nab-mono">storefront.gregale.app</span>
    </div>
  );
}

function TemplateScene() {
  const files = ['src/', '  index.ts', '  handler.ts', 'gregale.yaml'];
  return (
    <div className="nab-scene nab-template">
      <div className="nab-tree nab-mono">
        {files.map((f, i) => (
          <span key={f} className="nab-line" style={at(i)}>
            {f}
          </span>
        ))}
      </div>
      <div className="nab-row">
        {['Node', 'Python', 'Go'].map((r) => (
          <span key={r} className="nab-chip nab-dim">
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyScene() {
  return (
    <div className="nab-scene nab-empty">
      <div className="nab-box" />
      <div className="nab-prompt nab-mono">
        <span className="nab-dim">$</span> <span className="nab-type">gregale deploy</span>
        <span className="nab-caret" />
      </div>
    </div>
  );
}

function ContainerScene() {
  return (
    <div className="nab-scene nab-container">
      <span className="nab-chip nab-mono">sha256:7f3a…c91e</span>
      <div className="nab-layers">
        {[0, 1, 2].map((i) => (
          <span key={i} className="nab-layer" style={at(2 - i)} />
        ))}
      </div>
    </div>
  );
}

function WorkerScene() {
  return (
    <div className="nab-scene nab-worker">
      <svg viewBox="0 0 160 40" className="nab-beat" preserveAspectRatio="none">
        <path d="M0 22 H50 L58 8 L66 34 L74 22 H160" />
      </svg>
      <span className="nab-chip nab-dim nab-struck">HTTP</span>
    </div>
  );
}

function ImportScene() {
  return (
    <div className="nab-scene nab-import">
      <span className="nab-chip nab-mono">compose.yaml</span>
      <svg viewBox="0 0 120 40" className="nab-fan" preserveAspectRatio="none">
        <path d="M60 0 C60 20 20 20 20 40" />
        <path d="M60 0 V40" />
        <path d="M60 0 C60 20 100 20 100 40" />
      </svg>
      <div className="nab-row nab-services">
        {['web', 'worker', 'db'].map((s, i) => (
          <span key={s} className="nab-chip nab-mono" style={at(i)}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

const SCENES: Record<AppSource, () => React.JSX.Element> = {
  git: GitScene,
  template: TemplateScene,
  empty: EmptyScene,
  container: ContainerScene,
  worker: WorkerScene,
  import: ImportScene,
};

/**
 * Each source shown, not described: a small still scene that replays a short
 * loop while its cell is hovered, focused or chosen. CSS only (no timers, no
 * per-frame JavaScript); reduced motion leaves the still frame.
 */
export function SourcePreview({ id }: { id: AppSource }) {
  const Scene = SCENES[id];
  return (
    <div aria-hidden="true" className="nab-preview" data-preview={id}>
      <Scene />
    </div>
  );
}
```

- [ ] **Step 4: Implement the stylesheet**

```css
/* src/components/dashboard/new-app-bento.css
   The New app bento: a hairline grid of source cells with corner marks, and
   the previews inside them. Tokens only; both polarities. Scenes rest on their
   finished frame; hover, focus and selection apply the animation, which replays
   and ends on that same frame. */

.nab-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
}

@media (min-width: 640px) {
  .nab-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .nab-cell[data-source='git'],
  .nab-cell[data-source='import'] {
    grid-column: 1 / -1;
  }
}

@media (min-width: 1024px) {
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
}

/* Onboarding: Git alone, across the grid. */
.nab-grid[data-single] {
  grid-template-columns: minmax(0, 1fr);
}
.nab-grid[data-single] .nab-cell {
  grid-column: auto;
  grid-row: auto;
}

.nab-cell {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.875rem;
  padding: 1rem;
  text-align: left;
  background: var(--card);
  color: var(--card-foreground);
  transition: background-color var(--motion-fast) var(--motion-ease);
}
.nab-cell:hover {
  background: color-mix(in srgb, var(--foreground) 2.5%, var(--card));
}
.nab-cell:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1.5px var(--brand);
}
.nab-cell[aria-pressed='true'] {
  box-shadow: inset 0 0 0 1.5px var(--brand);
}

/* Corner marks: four 5px squares at the cell's corners, over the hairline. */
.nab-mark {
  position: absolute;
  z-index: 1;
  width: 5px;
  height: 5px;
  background: var(--border-secondary);
  pointer-events: none;
}
.nab-mark[data-corner='tl'] {
  top: -3px;
  left: -3px;
}
.nab-mark[data-corner='tr'] {
  top: -3px;
  right: -3px;
}
.nab-mark[data-corner='bl'] {
  bottom: -3px;
  left: -3px;
}
.nab-mark[data-corner='br'] {
  bottom: -3px;
  right: -3px;
}
.nab-cell[aria-pressed='true'] .nab-mark {
  z-index: 2;
  background: var(--brand);
}

.nab-preview {
  display: grid;
  height: 9.5rem;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--console-surface-radius);
  background: color-mix(in srgb, var(--foreground) 4%, var(--card));
}
@media (min-width: 1024px) {
  .nab-grid:not([data-single]) .nab-cell[data-source='git'] .nab-preview {
    height: auto;
    min-height: 12rem;
    flex: 1;
  }
}

/* --- Scene parts -------------------------------------------------------- */

.nab-scene {
  display: flex;
  width: min(100%, 22rem);
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
}
.nab-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.nab-mono {
  font-family: var(--font-mono);
}
.nab-chip {
  border: 1px solid var(--border-secondary);
  border-radius: 0.375rem;
  background: var(--card);
  padding: 0.125rem 0.5rem;
  font-size: 11px;
  line-height: 1.5;
  color: var(--foreground);
}
.nab-dim {
  color: var(--muted-foreground);
}

/* Git: four-segment rail, URL pill. Rest = live. */
.nab-rail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.375rem;
}
.nab-seg {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.nab-seg-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--brand);
}
.nab-seg-label {
  font-size: 9.5px;
  color: var(--muted-foreground);
}
.nab-url {
  width: fit-content;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--brand) 45%, transparent);
  background: color-mix(in srgb, var(--brand) 12%, transparent);
  padding: 0.125rem 0.625rem;
  font-size: 11px;
  color: var(--brand);
}

/* Template: file tree. */
.nab-tree {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  font-size: 11px;
  white-space: pre;
  color: var(--foreground);
}

/* Empty: dashed box and a prompt. */
.nab-box {
  height: 3.5rem;
  border: 1px dashed var(--border-secondary);
  border-radius: 0.5rem;
}
.nab-prompt {
  display: flex;
  align-items: center;
  font-size: 11px;
  color: var(--foreground);
}
.nab-type {
  display: inline-block;
  overflow: hidden;
  white-space: nowrap;
}
.nab-caret {
  display: inline-block;
  width: 6px;
  height: 12px;
  margin-left: 2px;
  background: var(--brand);
}

/* Container: digest and three layers. */
.nab-layers {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.nab-layer {
  height: 0.625rem;
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--brand) calc(20% + var(--i) * 15%), transparent);
}

/* Worker: heartbeat, no HTTP. */
.nab-beat {
  width: 100%;
  height: 2.5rem;
  fill: none;
  stroke: var(--brand);
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.nab-struck {
  width: fit-content;
  text-decoration: line-through;
}

/* Import: one manifest fanning out to services. */
.nab-fan {
  width: 100%;
  height: 2rem;
  fill: none;
  stroke: var(--border-secondary);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.nab-services {
  justify-content: space-between;
}

/* --- Motion: applied on hover, focus, and once on selection ------------ */

@keyframes nab-fill {
  from {
    background: color-mix(in srgb, var(--foreground) 12%, transparent);
  }
}
@keyframes nab-url {
  0%,
  70% {
    color: var(--muted-foreground);
    border-color: var(--border-secondary);
    background: transparent;
  }
}
@keyframes nab-in {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
}
@keyframes nab-typing {
  from {
    max-width: 0;
  }
  to {
    max-width: 14ch;
  }
}
@keyframes nab-blink {
  50% {
    opacity: 0;
  }
}
@keyframes nab-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
@keyframes nab-draw {
  from {
    stroke-dashoffset: 260;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes nab-march {
  to {
    stroke-dashoffset: -12;
  }
}

.nab-cell:hover .nab-seg-bar,
.nab-cell:focus-visible .nab-seg-bar,
.nab-cell[aria-pressed='true'] .nab-seg-bar {
  animation: nab-fill 0.4s var(--motion-ease) both;
  animation-delay: calc(var(--i) * 0.45s);
}
.nab-cell:hover .nab-url,
.nab-cell:focus-visible .nab-url,
.nab-cell[aria-pressed='true'] .nab-url {
  animation: nab-url 2.2s linear both;
}
.nab-cell:hover .nab-line,
.nab-cell:focus-visible .nab-line,
.nab-cell[aria-pressed='true'] .nab-line,
.nab-cell:hover .nab-services .nab-chip,
.nab-cell:focus-visible .nab-services .nab-chip,
.nab-cell[aria-pressed='true'] .nab-services .nab-chip {
  animation: nab-in 0.35s var(--motion-ease) both;
  animation-delay: calc(var(--i) * 0.12s + 0.15s);
}
.nab-cell:hover .nab-type,
.nab-cell:focus-visible .nab-type,
.nab-cell[aria-pressed='true'] .nab-type {
  animation: nab-typing 0.9s steps(14) both;
}
.nab-cell:hover .nab-caret,
.nab-cell:focus-visible .nab-caret {
  animation: nab-blink 1s steps(1) infinite;
}
.nab-cell:hover .nab-layer,
.nab-cell:focus-visible .nab-layer,
.nab-cell[aria-pressed='true'] .nab-layer {
  animation: nab-rise 0.35s var(--motion-ease) both;
  animation-delay: calc((2 - var(--i)) * 0.14s);
}
.nab-cell:hover .nab-beat path,
.nab-cell:focus-visible .nab-beat path,
.nab-cell[aria-pressed='true'] .nab-beat path {
  stroke-dasharray: 260;
  animation: nab-draw 1.2s var(--motion-ease) both;
}
.nab-cell:hover .nab-fan path,
.nab-cell:focus-visible .nab-fan path {
  animation: nab-march 0.8s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .nab-cell,
  .nab-cell * {
    animation: none !important;
    transition: none !important;
  }
}
```

Note that the selected (`aria-pressed`) rules use only finite animations, so a chosen cell plays once and settles. The infinite ones (caret blink, import march) run only while hovered or focused.

- [ ] **Step 5: Run the test and see it pass**

Run: `npx vitest run src/components/dashboard/new-app-previews.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/components/dashboard/new-app-previews.tsx src/components/dashboard/new-app-previews.test.tsx src/components/dashboard/new-app-bento.css
git add src/components/dashboard/new-app-previews.tsx src/components/dashboard/new-app-previews.test.tsx src/components/dashboard/new-app-bento.css
git commit -m "feat(new-app): a small scene for each source, replayed on hover"
```

---

### Task 3: The bento grid

**Files:**

- Create: `src/components/dashboard/new-app-bento.tsx`
- Test: `src/components/dashboard/new-app-bento.test.tsx`

**Interfaces:**

- Consumes: `SOURCES`, `SOURCE_GROUPS` from Task 1, `SourcePreview` from Task 2, `AppSource` from `./new-app-source`.
- Produces:

  ```ts
  function NewAppBento(props: {
    uid: string; // the wizard's useId(); ids are `${uid}-${id}-name|desc`
    formId: string; // the source form's id; each cell joins it via `form`
    selected?: AppSource;
    onSelect: (id: AppSource) => void;
    /** The source-level error's element id, appended to every cell's description. */
    errorId?: string;
    /** Onboarding: Git alone, no groups. */
    single?: boolean;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/new-app-bento.test.tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewAppBento } from './new-app-bento';

const setup = (props: Partial<Parameters<typeof NewAppBento>[0]> = {}) => {
  const onSelect = vi.fn();
  const view = render(
    <>
      <form id="f" />
      <NewAppBento uid="u" formId="f" onSelect={onSelect} {...props} />
    </>
  );
  return { onSelect, ...view };
};

describe('NewAppBento', () => {
  it('keeps the three labelled groups and every cell named by its title, in source order', () => {
    setup();
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveAccessibleName('From code');
    expect(groups[1]).toHaveAccessibleName('From an image');
    expect(groups[2]).toHaveAccessibleName('Bring an existing project');
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('data-source'));
    expect(names).toEqual(['git', 'template', 'empty', 'container', 'worker', 'import']);
    expect(
      within(groups[0]).getByRole('button', { name: 'Git repository' })
    ).toHaveAccessibleDescription(/one service from a branch, tag, or commit/);
  });

  it('numbers the cells and names their group in an eyebrow', () => {
    setup();
    const git = screen.getByRole('button', { name: 'Git repository' });
    expect(git).toHaveTextContent('01');
    expect(git).toHaveTextContent('From code');
    expect(screen.getByRole('button', { name: 'Import' })).toHaveTextContent('06');
  });

  it('joins the source form by name, so focus-first-error can find a cell', () => {
    const { container } = setup();
    const form = container.querySelector('form') as HTMLFormElement;
    expect(form.elements.namedItem('source-git')).toBe(
      screen.getByRole('button', { name: 'Git repository' })
    );
  });

  it('marks only the selected cell pressed and reports a choice', async () => {
    const { onSelect } = setup({ selected: 'git' });
    expect(screen.getByRole('button', { name: 'Git repository' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: 'Template' }));
    expect(onSelect).toHaveBeenCalledWith('template');
  });

  it('adds the source error to every description when one is shown', () => {
    render(
      <>
        <form id="f" />
        <p id="err">Choose where the code comes from to continue.</p>
        <NewAppBento uid="u" formId="f" onSelect={vi.fn()} errorId="err" />
      </>
    );
    expect(screen.getByRole('button', { name: 'Empty app' })).toHaveAccessibleDescription(
      /Choose where the code comes from to continue\./
    );
  });

  it('hides every preview and draws four corner marks per cell', () => {
    const { container } = setup();
    const previews = container.querySelectorAll('[data-preview]');
    expect(previews).toHaveLength(6);
    previews.forEach((p) => expect(p).toHaveAttribute('aria-hidden', 'true'));
    expect(container.querySelectorAll('.nab-mark')).toHaveLength(24);
  });

  it('shows Git alone in onboarding, without groups', () => {
    const { container } = setup({ single: true, selected: 'git' });
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(container.querySelector('.nab-grid')).toHaveAttribute('data-single');
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run src/components/dashboard/new-app-bento.test.tsx`
Expected: FAIL with `Failed to resolve import "./new-app-bento"`.

- [ ] **Step 3: Implement**

```tsx
// src/components/dashboard/new-app-bento.tsx
import { cn } from '@/lib/utils';
import type { AppSource } from './new-app-source';
import { SOURCES, SOURCE_GROUPS } from './new-app-sources';
import { SourcePreview } from './new-app-previews';
import './new-app-bento.css';

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

/**
 * The New app sources as a bento: one hairline grid, Git as the hero cell.
 * Groups stay in the accessibility tree (`role="group"`) but are laid out with
 * `display: contents`, so every cell sits directly in the grid. DOM order is
 * source order, so Tab walks Git → Template → … → Import whatever the layout.
 */
export function NewAppBento({
  uid,
  formId,
  selected,
  onSelect,
  errorId,
  single = false,
}: {
  uid: string;
  formId: string;
  selected?: AppSource;
  onSelect: (id: AppSource) => void;
  errorId?: string;
  single?: boolean;
}) {
  let index = 0;
  const cell = (id: AppSource, group: string) => {
    const s = SOURCES.find((option) => option.id === id)!;
    index += 1;
    return (
      <button
        key={id}
        type="button"
        name={`source-${id}`}
        form={formId}
        data-source={id}
        onClick={() => onSelect(id)}
        aria-pressed={selected === id}
        aria-labelledby={`${uid}-${id}-name`}
        aria-describedby={cn(`${uid}-${id}-desc`, errorId)}
        className="nab-cell"
      >
        {CORNERS.map((c) => (
          <span key={c} aria-hidden="true" className="nab-mark" data-corner={c} />
        ))}
        <SourcePreview id={id} />
        <span className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          <span>{group}</span>
          <span>{String(index).padStart(2, '0')}</span>
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span id={`${uid}-${id}-name`} className="text-sm font-medium text-foreground">
            {s.name}
          </span>
          <span id={`${uid}-${id}-desc`} className="text-xs leading-5 text-muted-foreground">
            {s.desc}
          </span>
        </span>
      </button>
    );
  };

  if (single) {
    return (
      <div className="nab-grid" data-single="">
        {cell('git', SOURCE_GROUPS[0].title)}
      </div>
    );
  }

  return (
    <div className="nab-grid">
      {SOURCE_GROUPS.map((group, g) => (
        <div
          key={group.title}
          role="group"
          aria-labelledby={`${uid}-group-${g}`}
          className="contents"
        >
          <h2 id={`${uid}-group-${g}`} className="sr-only">
            {group.title}
          </h2>
          {group.sources.map((id) => cell(id, group.title))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run src/components/dashboard/new-app-bento.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/dashboard/new-app-bento.tsx src/components/dashboard/new-app-bento.test.tsx
git add src/components/dashboard/new-app-bento.tsx src/components/dashboard/new-app-bento.test.tsx
git commit -m "feat(new-app): sources as a hairline bento, Git as the hero cell"
```

---

### Task 4: The rail and the review grid

**Files:**

- Create: `src/components/dashboard/new-app-rail.tsx`
- Test: `src/components/dashboard/new-app-rail.test.tsx`

**Interfaces:**

- Consumes: `SummaryRow` from Task 1.
- Produces:

  ```ts
  function NewAppRail(props: {
    title: string;
    description: string;
    /** "← All apps"; off in onboarding. */
    back: boolean;
    /** 0 | 1 | 2; the steps are hidden when undefined (Import). */
    step?: 0 | 1 | 2;
    /** Empty hides the summary; the wizard passes [] on Review. */
    rows: SummaryRow[];
  }): JSX.Element;

  function NewAppReviewGrid(props: { rows: SummaryRow[] }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/new-app-rail.test.tsx
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewAppRail, NewAppReviewGrid } from './new-app-rail';
import type { SummaryRow } from './new-app-summary';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const rows: SummaryRow[] = [
  { key: 'source', label: 'Source', value: 'Git repository' },
  { key: 'name', label: 'Name', value: 'a-forty-character-app-name-that-is-long', mono: true },
];

describe('NewAppRail', () => {
  it('heads the page and links back to the apps', () => {
    render(<NewAppRail title="New app" description="Choose a source." back step={0} rows={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'New app' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All apps/ })).toHaveAttribute(
      'href',
      '/dashboard/apps'
    );
  });

  it('marks the current step and the ones done', () => {
    render(<NewAppRail title="New app" description="" back={false} step={1} rows={[]} />);
    const steps = within(screen.getByRole('list', { name: 'App creation steps' })).getAllByRole(
      'listitem'
    );
    expect(steps.map((s) => s.textContent?.replace(/\d+/g, '').trim())).toEqual([
      'Source',
      'Configure',
      'Review',
    ]);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveAttribute('data-state', 'done');
    expect(steps[2]).toHaveAttribute('data-state', 'upcoming');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('hides the steps when there is no step (Import)', () => {
    render(<NewAppRail title="New app" description="" back step={undefined} rows={[]} />);
    expect(screen.queryByRole('list', { name: 'App creation steps' })).not.toBeInTheDocument();
  });

  it('lists only what is known, and nothing at all when the list is empty', () => {
    const { rerender } = render(
      <NewAppRail title="New app" description="" back step={0} rows={rows} />
    );
    // "Source" is also a step label, so read the row from its value.
    expect(screen.getByText('Git repository').previousElementSibling).toHaveTextContent('Source');
    expect(screen.getByText("What you'll get")).toBeInTheDocument();
    rerender(<NewAppRail title="New app" description="" back step={2} rows={[]} />);
    expect(screen.queryByText("What you'll get")).not.toBeInTheDocument();
  });

  it('wraps long values instead of overflowing', () => {
    render(<NewAppRail title="New app" description="" back step={0} rows={rows} />);
    expect(screen.getByText('a-forty-character-app-name-that-is-long')).toHaveClass('break-words');
  });
});

describe('NewAppReviewGrid', () => {
  const all: SummaryRow[] = [
    ...rows,
    { key: 'memory', label: 'Memory', value: '256 MB', mono: true },
    { key: 'url', label: 'Public URL', value: 'https://api.gregale.app', mono: true },
  ];

  it('pairs every label with its value, Name and URL first', () => {
    render(<NewAppReviewGrid rows={all} />);
    expect(screen.getByText('Public URL').nextElementSibling).toHaveTextContent(
      'https://api.gregale.app'
    );
    const labels = screen.getAllByRole('term').map((t) => t.textContent);
    expect(labels.slice(0, 2)).toEqual(['Name', 'Public URL']);
    expect(labels).toContain('Memory');
  });

  it('wraps long values', () => {
    render(<NewAppReviewGrid rows={all} />);
    screen.getAllByRole('definition').forEach((d) => expect(d).toHaveClass('break-words'));
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run src/components/dashboard/new-app-rail.test.tsx`
Expected: FAIL with `Failed to resolve import "./new-app-rail"`.

- [ ] **Step 3: Implement**

```tsx
// src/components/dashboard/new-app-rail.tsx
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Check } from 'iconoir-react';
import { cn } from '@/lib/utils';
import type { SummaryRow } from './new-app-summary';

const STEPS = ['Source', 'Configure', 'Review'] as const;

function Item({ row }: { row: SummaryRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
      <dd className={cn('break-words text-[13px] text-foreground', row.mono && 'font-mono')}>
        {row.value}
      </dd>
    </div>
  );
}

/**
 * The New app rail: where you are and what you are making. Sticky beside the
 * step on wide screens, stacked above it on narrow ones. Its summary fills in
 * as the person goes; Review shows the same rows in full, so the wizard passes
 * an empty list there and the rail shows only the steps.
 */
export function NewAppRail({
  title,
  description,
  back,
  step,
  rows,
}: {
  title: string;
  description: string;
  back: boolean;
  step?: 0 | 1 | 2;
  rows: SummaryRow[];
}) {
  return (
    <aside className="flex flex-col gap-6 lg:sticky lg:top-20">
      <div className="flex flex-col gap-3">
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
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {step !== undefined && (
        <ol aria-label="App creation steps" className="flex flex-col gap-1 border-l border-border">
          {STEPS.map((label, i) => {
            const state = i < step ? 'done' : i === step ? 'current' : 'upcoming';
            return (
              <li
                key={label}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
                className={cn(
                  '-ml-px flex items-center gap-3 border-l py-1.5 pl-4 text-sm transition-colors',
                  state === 'current'
                    ? 'border-brand text-foreground'
                    : 'border-transparent text-muted-foreground'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-5 font-mono text-[11px]',
                    state === 'current' ? 'text-brand' : 'text-muted-foreground'
                  )}
                >
                  {state === 'done' ? (
                    <Check className="h-3.5 w-3.5 text-[color:var(--status-good)]" />
                  ) : (
                    String(i + 1).padStart(2, '0')
                  )}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
            What you'll get
          </p>
          <dl className="flex flex-col gap-3">
            {rows.map((row) => (
              <Item key={row.key} row={row} />
            ))}
          </dl>
        </div>
      )}
    </aside>
  );
}

/**
 * Review: the summary at full size, on the bento's hairline grid. Name and
 * the public URL lead as the hero cell; the rest follow two to a row.
 */
export function NewAppReviewGrid({ rows }: { rows: SummaryRow[] }) {
  const hero = rows.filter((r) => r.key === 'name' || r.key === 'url');
  const rest = rows.filter((r) => r.key !== 'name' && r.key !== 'url');
  const cell = (row: SummaryRow, wide: boolean) => (
    <div
      key={row.key}
      className={cn('flex min-w-0 flex-col gap-1 bg-card p-4', wide && 'sm:col-span-2')}
    >
      <dt className="text-xs text-muted-foreground">{row.label}</dt>
      <dd className={cn('break-words text-sm text-foreground', row.mono && 'font-mono')}>
        {row.value}
      </dd>
    </div>
  );
  return (
    <dl className="grid gap-px border border-border bg-border sm:grid-cols-2">
      {hero.length > 0 && (
        <div className="grid gap-px bg-border sm:col-span-2 sm:grid-cols-2">
          {hero.map((row) => (
            <div key={row.key} className="flex min-w-0 flex-col gap-1 bg-card p-5">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd
                className={cn(
                  'break-words text-base font-medium text-foreground',
                  row.mono && 'font-mono'
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </div>
      )}
      {rest.map((row, i) => cell(row, i === rest.length - 1 && rest.length % 2 === 1))}
    </dl>
  );
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run src/components/dashboard/new-app-rail.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/dashboard/new-app-rail.tsx src/components/dashboard/new-app-rail.test.tsx
git add src/components/dashboard/new-app-rail.tsx src/components/dashboard/new-app-rail.test.tsx
git commit -m "feat(new-app): a sticky rail of steps and what you'll get, and review as its full summary"
```

---

### Task 5: Wire the new pieces into the wizard

**Files:**

- Modify: `src/components/dashboard/new-app-wizard.tsx`
- Test: `src/components/dashboard/new-app-wizard.test.tsx` (one new test appended; existing tests unchanged)

**Interfaces:**

- Consumes: `SOURCES`, `sourceName` (Task 1); `summaryRows` (Task 1); `NewAppBento` (Task 3); `NewAppRail`, `NewAppReviewGrid` (Task 4).

- [ ] **Step 1: Write the failing test.** Append it inside `describe('NewAppWizard source picker', …)`. It reuses the file's existing `render`, `screen`, `userEvent` and `mocks`.

```tsx
it("fills the rail's summary as you go and hands it to review", async () => {
  const user = userEvent.setup();
  render(<NewAppWizard />);
  const rail = screen.getByRole('complementary');
  // "Source" is also a step label in the rail, so read the row from its value.
  expect(within(rail).getByText('Git repository').previousElementSibling).toHaveTextContent(
    'Source'
  );
  await user.type(screen.getByLabelText('Repository'), 'gregale/demo');
  expect(within(rail).getByText('Repository').nextElementSibling).toHaveTextContent(
    'gregale/demo@main'
  );
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByLabelText('App name');
  expect(within(rail).getByText('Memory').nextElementSibling).toHaveTextContent('128 MB');
  await user.click(screen.getByRole('button', { name: 'Review' }));
  await screen.findByRole('button', { name: 'Deploy app' });
  expect(within(rail).queryByText("What you'll get")).not.toBeInTheDocument();
  expect(screen.getByText('Memory').nextElementSibling).toHaveTextContent('128 MB');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/components/dashboard/new-app-wizard.test.tsx -t "fills the rail"`
Expected: FAIL. `getByRole('complementary')` finds nothing, because there is no `<aside>` yet.

- [ ] **Step 3: Replace the source list with the shared one.** In `new-app-wizard.tsx`:

  1. Delete the local `SOURCES` array and the `SOURCE_GROUPS` constant (lines 63–111 on main at 7376e5f), keeping `STEPS` until step 5 below removes its last use.
  2. Add imports next to the other `./` imports:

```ts
import { SOURCES, sourceName } from './new-app-sources';
import { summaryRows } from './new-app-summary';
import { NewAppBento } from './new-app-bento';
import { NewAppRail, NewAppReviewGrid } from './new-app-rail';
```

`SOURCES` stays in use only if the file still references it after step 6; if `npx tsc --noEmit` reports it unused, drop it from the import.

- [ ] **Step 4: Compute the rows.** Directly after the `blockedReason` declaration (the block that begins `const blockedReason = limitsLoading`), add:

```ts
// What the app will be, as far as the person has said: the rail shows it as
// it fills in, Review shows it whole, from one list.
const rows = summaryRows({
  step: step as 0 | 1 | 2,
  source,
  repo,
  ref,
  templateName: template?.name ?? catalogTemplate?.name,
  name,
  workspaceLabel: workspace.label,
  workspaceIsOrg: Boolean(workspace.org),
  appType,
  runtimeLabel: RUNTIMES.find((r) => r.id === runtime)?.label,
  memoryMb: selectedMemoryMb,
  scaleToZero: effectiveScaleToZero,
  visibility,
  predictedUrl,
});
```

- [ ] **Step 5: Replace the frame and the header.** In the `const form = (` block:

  1. Change the outer `<div className={cn('mx-auto flex w-full flex-col gap-6 …', source === 'template' || source === 'import' ? 'max-w-5xl' : 'max-w-2xl')}>` to:

```tsx
    <div className="mx-auto grid w-full max-w-5xl gap-8 text-[length:var(--console-body-size,0.875rem)] leading-[var(--console-body-leading,1.5714)] lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:items-start">
```

2. Delete, inside it, the `{!onboarding && (<Link to="/dashboard/apps" …>All apps</Link>)}` block, the `<PageHeader title={onboarding ? … } description={…} />` and the whole `{/* Step rail */} {source !== 'import' && (<ol aria-label="App creation steps"> … </ol>)}` block. Put in their place:

```tsx
      <NewAppRail
        title={onboarding ? 'Deploy your first app' : 'New app'}
        description={
          onboarding
            ? 'Choose a Git repository, configure its runtime, and watch the real build go live.'
            : template
              ? `Starting from the ${template.name} template — source, runtime, and memory are prefilled; the scaffold arrives once the app exists.`
              : 'Choose a source to create your app.'
        }
        back={!onboarding}
        step={source === 'import' ? undefined : (step as 0 | 1 | 2)}
        rows={step === 2 ? [] : rows}
      />
      <div className="flex min-w-0 flex-col gap-6">
```

3. Close that new `<div>` right after the closing `</AnimatePresence>`, before the outer `</div>` of `form`.
4. Delete the now-unused `STEPS` constant, and remove `Check` from the `iconoir-react` import if `npx tsc --noEmit` and `npm run lint` report it unused. Keep `PageHeader`, since `containerForm` and the completion screen still use it.

- [ ] **Step 6: Replace the source cards.** Inside the `step === 0` motion block, replace the whole

```tsx
            {onboarding ? (
              <div className="flex flex-col gap-2">{renderSourceCard('git')}</div>
            ) : (
              <div className="flex flex-col gap-5">
                {SOURCE_GROUPS.map((group, index) => ( … ))}
              </div>
            )}
```

with:

```tsx
<NewAppBento
  uid={uid}
  formId={`${uid}-source-form`}
  selected={source}
  onSelect={setSource}
  errorId={sourceLevelError ? `${uid}-source-error` : undefined}
  single={onboarding}
/>
```

Then delete the `renderSourceCard` function and the comment block above it ("A card is named by its title alone…"). Remove `Github`, `Package`, `Page` and `Upload` from the `iconoir-react` import if they are now unused.

- [ ] **Step 7: Give the Git fields and Configure the cell surface.**

  1. In the source step, the Git fields container `<div className="grid gap-4 sm:grid-cols-[1fr_auto]">` becomes:

```tsx
              <div className="grid gap-4 border border-border bg-card p-5 sm:grid-cols-[1fr_auto]">
```

2. In the Configure step, change `<Panel className={SURFACE}>` to `<Panel className="rounded-none border-border">`. If `SURFACE` then has no remaining uses, delete the `SURFACE` constant.

- [ ] **Step 8: Replace Review's table.** In the `step === 2` block, change `<Panel title="Review" className={SURFACE}>` to `<Panel className="rounded-none border-border">`, and replace the whole `<dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2"> … </dl>` (the inline `[['Name', name], …].map(…)` table) with:

```tsx
<NewAppReviewGrid rows={rows} />
```

Keep every paragraph after it, unchanged: the URL or internal note, the workspace note, and the quota box.

- [ ] **Step 9: Run the wizard tests and see them all pass**

Run: `npx vitest run src/components/dashboard/new-app-wizard.test.tsx`
Expected: PASS, with every existing test unchanged plus the new one. If one fails, read it before touching anything:

- A "found multiple elements" error means a value now appears twice. Check that the rail gets `[]` on Review (step 5.2).
- A name or description mismatch means a cell attribute differs from Task 3's contract.

Fix the wizard, never the test.

- [ ] **Step 10: Run the whole check**

Run: `npx tsc --noEmit && npx vitest run src/components/dashboard src/routes src/lib/conventions.test.ts && npm run lint`
Expected: tsc clean; all tests pass (Vitest exit code 0, no "Errors" line); lint 0 errors and 4 warnings.

- [ ] **Step 11: Commit**

```bash
npx prettier --write src/components/dashboard/new-app-wizard.tsx src/components/dashboard/new-app-wizard.test.tsx
git add src/components/dashboard/new-app-wizard.tsx src/components/dashboard/new-app-wizard.test.tsx
git commit -m "feat(new-app): the wizard as a rail and a bento, review as the full summary"
```

---

### Task 6: See it in the browser, both polarities, three widths

**Files:**

- Modify: only what this check finds broken. Each fix gets a failing test first where one can be written, as in Tasks 1–5.
- Create (scratch, not committed): `pw/bento-check.mjs` in the session scratchpad.

- [ ] **Step 1: Start the mock and a browser harness**

```bash
(nohup npm run dev:mock -- --port 3010 --strictPort > /tmp/bento-dev.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" http://localhost:3010/ | grep -q 200 && break; sleep 1; done
```

In the scratchpad's `pw/` directory (with `playwright-core` installed), find the headless shell with `ls ~/.cache/ms-playwright/` and write `bento-check.mjs`:

```js
import { chromium } from 'playwright-core';
const exe = process.env.EXE;
const BASE = 'http://localhost:3010';
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
for (const [w, h] of [
  [1440, 1000],
  [1024, 900],
  [390, 844],
]) {
  for (const light of [false, true]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => {
      localStorage.setItem('gregale.session', JSON.stringify({ email: 'd@g.dev' }));
      localStorage.setItem('gregale.onboarded', 'true');
      localStorage.setItem('gregale.dev-bypass', 'true');
    });
    await p.goto(BASE + '/dashboard/apps/new', { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    if (light) await p.evaluate(() => document.documentElement.classList.remove('console'));
    const tag = `${w}${light ? ' light' : ' dark'}`;
    check(
      `${tag}: no sideways scroll`,
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    );
    const cols = await p.evaluate(
      () =>
        getComputedStyle(document.querySelector('.nab-grid')).gridTemplateColumns.split(' ').length
    );
    check(`${tag}: grid columns`, cols === (w >= 1024 ? 3 : w >= 640 ? 2 : 1), String(cols));
    const sticky = await p.evaluate(
      () => getComputedStyle(document.querySelector('aside')).position
    );
    check(`${tag}: rail sticky only on wide screens`, (sticky === 'sticky') === w >= 1024, sticky);
    await p.locator('.nab-cell[data-source="template"]').hover();
    await p.waitForTimeout(300);
    await p.screenshot({
      path: `bento-${w}-${light ? 'light' : 'dark'}-source.png`,
      fullPage: true,
    });
    await p.close();
  }
}
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(BASE + '/dashboard/apps/new?source=git', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.locator('select').first().selectOption({ index: 1 });
await p.getByRole('button', { name: 'Continue' }).click();
await p.waitForTimeout(700);
await p.screenshot({ path: 'bento-configure.png', fullPage: true });
await p.getByRole('button', { name: 'Review' }).click();
await p.waitForTimeout(700);
await p.screenshot({ path: 'bento-review.png', fullPage: true });
await p.evaluate(() => localStorage.removeItem('gregale.onboarded'));
await p.goto(BASE + '/onboarding', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.screenshot({ path: 'bento-onboarding.png', fullPage: true });
check('onboarding shows Git alone', (await p.locator('.nab-cell').count()) === 1);
const order = await p
  .goto(BASE + '/dashboard/apps/new', { waitUntil: 'networkidle' })
  .then(async () => {
    const ids = [];
    await p.locator('.nab-cell').first().focus();
    for (let i = 0; i < 6; i++) {
      ids.push(await p.evaluate(() => document.activeElement?.getAttribute('data-source')));
      await p.keyboard.press('Tab');
    }
    return ids;
  });
check(
  'Tab walks cells in source order',
  order.join(',') === 'git,template,empty,container,worker,import',
  order.join(',')
);
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
await b.close();
```

- [ ] **Step 2: Run it**

Run: `EXE=<path to chrome-headless-shell> node bento-check.mjs`
Expected: `ALL PASS`. Then read every screenshot. Look at:

- the hairline and corner marks lining up;
- Git spanning two rows at 1440;
- the selected cell's mint ring and marks;
- previews legible in both polarities;
- the rail sticky beside the content at 1440 and stacked at 390;
- Review leading with Name and URL;
- onboarding light with one wide cell.

- [ ] **Step 3: Fix what the screenshots show.** For each problem, write the smallest failing unit test that can express it (a class, an attribute, a rule in the stylesheet), make it pass, and re-run `bento-check.mjs`. Record each fix in the commit message body.

- [ ] **Step 4: Tour, full gates**

```bash
BASE_URL=http://localhost:3010 npm run tour
npm run check
npm run build
```

Expected: the tour reports no new failures against `main`, so compare against a tour run on `main` if anything is red. `check` and `build` pass, with lint at 4 warnings.

- [ ] **Step 5: Commit fixes, if any**

```bash
git add -A src
git commit -m "fix(new-app): polish from the browser pass" -m "<one line per fix>"
```

Skip this step if nothing changed.
